// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// One escrow for every stake on a price-feed claim (003 US4, FR-023). Its rules are answered in
/// docs/decisions/002-escrow-v1.md. It stores no text and has no function that moves staked funds otherwise.
contract Escrow {
    enum State {
        None,
        Open,
        Matched,
        Settled,
        Paid,
        Voided,
        Refunded,
        Expired
    }

    enum Outcome {
        None,
        Hit,
        Miss,
        Void
    }

    struct Stake {
        bytes32 claimHash;
        address maker;
        address taker;
        uint128 amount;
        uint64 deadline;
        uint64 offerExpiry;
        uint64 settledAt;
        bool makerSaysHit;
        State state;
        Outcome outcome;
    }

    struct Config {
        address token;
        address oracle;
        address guardian;
        address feeRecipient;
        uint16 feeBps;
        uint64 settlementWindow;
        uint64 timeout;
        uint64 acceptanceCloses;
        uint64 offerLifetime;
        uint128 maxStake;
    }

    /// 5%: a constant, so no deployment can set a higher fee (002-escrow-v1).
    uint16 public constant FEE_CEILING_BPS = 500;

    bytes32 private constant OPEN_TYPEHASH =
        keccak256("OpenAuthorization(bytes32 claimHash,uint64 deadline,uint64 validUntil)");
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    // secp256k1n / 2: a signature with a larger s is the malleable twin of a valid one (EIP-2).
    uint256 private constant HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
    // A signature is r (32 bytes), then s (32), then v (1): 65 bytes, s at byte 32, v at byte 64.
    uint256 private constant SIGNATURE_LENGTH = 65;
    uint256 private constant S_OFFSET = 32;
    uint256 private constant V_OFFSET = 64;
    // Ethereum's two valid recovery ids; any other v is not a signature.
    uint8 private constant V_EVEN = 27;
    uint8 private constant V_ODD = 28;

    IERC20 public immutable token;
    address public immutable oracle;
    address public immutable guardian;
    address public immutable feeRecipient;
    uint16 public immutable feeBps;
    uint64 public immutable settlementWindow;
    uint64 public immutable timeout;
    uint64 public immutable acceptanceCloses;
    uint64 public immutable offerLifetime;
    uint128 public immutable maxStake;

    uint256 private immutable deployChainId;
    bytes32 private immutable deployDomainSeparator;

    bool public paused;
    uint256 public nextId = 1;
    mapping(uint256 => Stake) public stakes;
    // Every stake on a claim, so the worker settles all of them from the claim alone (data-model, outbox).
    mapping(bytes32 => uint256[]) private claimStakes;

    event Opened(
        uint256 indexed id,
        bytes32 indexed claimHash,
        address indexed maker,
        bool makerSaysHit,
        uint128 amount,
        uint64 deadline,
        uint64 offerExpiry
    );
    event Accepted(uint256 indexed id, address indexed taker);
    event Settled(uint256 indexed id, Outcome outcome, bytes32 evidenceRef);
    event Paid(uint256 indexed id, address indexed winner, uint256 amount, uint256 fee);
    event Voided(uint256 indexed id, uint8 reasonCode, bytes32 evidenceRef);
    event Refunded(uint256 indexed id);
    event Expired(uint256 indexed id);
    event PausedBy(address indexed guardian);
    event UnpausedBy(address indexed guardian);

    error BadConfig();
    error StakingPaused();
    error BadAmount();
    error BadAuthorization();
    error BadState();
    error TooEarly();
    error TooLate();
    error SameParty();
    error NotOracle();
    error NotReferee();
    error NotGuardian();
    error BadOutcome();
    error BadReason();
    error MissingReference();
    error TransferFailed();

    constructor(Config memory config) {
        if (
            config.token.code.length == 0 || config.oracle == address(0) || config.guardian == address(0)
                || config.oracle == config.guardian || config.feeRecipient == address(0)
                || config.feeBps > FEE_CEILING_BPS || config.settlementWindow == 0 || config.timeout == 0
                || config.offerLifetime == 0 || config.maxStake == 0
        ) revert BadConfig();

        token = IERC20(config.token);
        oracle = config.oracle;
        guardian = config.guardian;
        feeRecipient = config.feeRecipient;
        feeBps = config.feeBps;
        settlementWindow = config.settlementWindow;
        timeout = config.timeout;
        acceptanceCloses = config.acceptanceCloses;
        offerLifetime = config.offerLifetime;
        maxStake = config.maxStake;

        deployChainId = block.chainid;
        deployDomainSeparator = _buildDomainSeparator();
    }

    // ---- the seven transitions ----

    /// The maker takes a side on a claim the oracle authorised: price-feed claims only (FR-031a).
    function open(
        bytes32 claimHash,
        uint64 deadline,
        uint64 validUntil,
        bytes calldata authorization,
        bool makerSaysHit,
        uint128 amount
    ) external returns (uint256 id) {
        if (paused) revert StakingPaused();
        if (amount == 0 || amount > maxStake) revert BadAmount();
        if (block.timestamp > validUntil) revert BadAuthorization();
        _checkAuthorization(claimHash, deadline, validUntil, authorization);

        uint64 offerExpiry = _offerExpiry(deadline);

        id = nextId++;
        stakes[id] = Stake({
            claimHash: claimHash,
            maker: msg.sender,
            taker: address(0),
            amount: amount,
            deadline: deadline,
            offerExpiry: offerExpiry,
            settledAt: 0,
            makerSaysHit: makerSaysHit,
            state: State.Open,
            outcome: Outcome.None
        });
        claimStakes[claimHash].push(id);
        // The only call before this is ecrecover, a precompile: nothing can re-enter.
        // forge-lint: disable-next-line(reentrancy-events)
        emit Opened(id, claimHash, msg.sender, makerSaysHit, amount, deadline, offerExpiry);
        _pull(msg.sender, amount);
    }

    /// The taker matches the same amount on the other side, before acceptance closes.
    function accept(uint256 id) external {
        if (paused) revert StakingPaused();
        Stake storage stake = stakes[id];
        if (stake.state != State.Open) revert BadState();
        if (block.timestamp >= stake.offerExpiry) revert TooLate();
        if (msg.sender == stake.maker) revert SameParty();

        stake.taker = msg.sender;
        stake.state = State.Matched;
        emit Accepted(id, msg.sender);
        _pull(msg.sender, stake.amount);
    }

    /// An offer nobody matched returns to its maker. Anyone may call it once the offer has expired.
    function expire(uint256 id) external {
        Stake storage stake = stakes[id];
        if (stake.state != State.Open) revert BadState();
        if (block.timestamp < stake.offerExpiry) revert TooEarly();

        stake.state = State.Expired;
        emit Expired(id);
        _push(stake.maker, stake.amount);
    }

    /// The oracle records a final verdict. HIT or MISS starts the window and pays nobody (FR-031b); VOID refunds.
    function settle(uint256 id, Outcome outcome, bytes32 evidenceRef) external {
        if (msg.sender != oracle) revert NotOracle();
        if (outcome == Outcome.None) revert BadOutcome();
        if (evidenceRef == bytes32(0)) revert MissingReference();
        Stake storage stake = stakes[id];
        if (stake.state != State.Matched) revert BadState();
        if (block.timestamp < stake.deadline) revert TooEarly();
        // Past the timeout the refund owns the stake: settling and refunding never compete (FR-031d).
        if (block.timestamp >= uint256(stake.deadline) + timeout) revert TooLate();

        stake.outcome = outcome;
        // uint64 seconds last past the year 500 billion.
        // forge-lint: disable-next-line(unsafe-typecast)
        stake.settledAt = uint64(block.timestamp);
        emit Settled(id, outcome, evidenceRef);
        if (outcome == Outcome.Void) {
            stake.state = State.Refunded;
            emit Refunded(id);
            _refundBoth(stake);
        } else {
            stake.state = State.Settled;
        }
    }

    /// After the window, anyone may pay the winner, so finality never waits on the operator (FR-031b).
    function payout(uint256 id) external {
        Stake storage stake = stakes[id];
        if (stake.state != State.Settled) revert BadState();
        if (block.timestamp < uint256(stake.settledAt) + settlementWindow) revert TooEarly();

        bool makerWins = (stake.outcome == Outcome.Hit) == stake.makerSaysHit;
        address winner = makerWins ? stake.maker : stake.taker;
        uint256 pot = uint256(stake.amount) * 2;
        uint256 fee = (pot * feeBps) / 10_000;

        stake.state = State.Paid;
        emit Paid(id, winner, pot - fee, fee);
        _push(winner, pot - fee);
        if (fee > 0) _push(feeRecipient, fee);
    }

    /// Inside the window only: each side gets its own stake back, and nothing else can happen here (FR-031c).
    function voidStake(uint256 id, uint8 reasonCode, bytes32 evidenceRef) external {
        if (msg.sender != oracle && msg.sender != guardian) revert NotReferee();
        // 1 wrong source value, 2 resolver defect, 3 evidence fails the locked contract (FR-031e).
        if (reasonCode == 0 || reasonCode > 3) revert BadReason();
        if (evidenceRef == bytes32(0)) revert MissingReference();
        Stake storage stake = stakes[id];
        if (stake.state != State.Settled) revert BadState();
        if (block.timestamp >= uint256(stake.settledAt) + settlementWindow) revert TooLate();

        stake.state = State.Voided;
        emit Voided(id, reasonCode, evidenceRef);
        _refundBoth(stake);
    }

    /// No verdict by the timeout: anyone may refund both sides, with no operator alive at all (FR-030).
    function refund(uint256 id) external {
        Stake storage stake = stakes[id];
        if (stake.state != State.Matched) revert BadState();
        if (block.timestamp < uint256(stake.deadline) + timeout) revert TooEarly();

        stake.state = State.Refunded;
        emit Refunded(id);
        _refundBoth(stake);
    }

    function stakesOf(bytes32 claimHash) external view returns (uint256[] memory) {
        return claimStakes[claimHash];
    }

    // ---- the guardian: stops new stakes, never blocks a refund ----

    function pause() external {
        if (msg.sender != guardian) revert NotGuardian();
        paused = true;
        emit PausedBy(msg.sender);
    }

    function unpause() external {
        if (msg.sender != guardian) revert NotGuardian();
        paused = false;
        emit UnpausedBy(msg.sender);
    }

    /// Seven days after opening or when acceptance closes, whichever is first (002-escrow-v1).
    function _offerExpiry(uint64 deadline) private view returns (uint64) {
        if (deadline <= acceptanceCloses || block.timestamp >= deadline - acceptanceCloses) revert TooLate();
        uint64 closes = deadline - acceptanceCloses;
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 lifetimeEnds = uint64(block.timestamp) + offerLifetime;
        return lifetimeEnds < closes ? lifetimeEnds : closes;
    }

    // ---- authorization ----

    function domainSeparator() public view returns (bytes32) {
        return block.chainid == deployChainId ? deployDomainSeparator : _buildDomainSeparator();
    }

    function openDigest(bytes32 claimHash, uint64 deadline, uint64 validUntil) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(OPEN_TYPEHASH, claimHash, deadline, validUntil));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function _checkAuthorization(bytes32 claimHash, uint64 deadline, uint64 validUntil, bytes calldata signature)
        private
        view
    {
        if (signature.length != SIGNATURE_LENGTH) revert BadAuthorization();
        bytes32 r;
        bytes32 s;
        uint8 v;
        // Slices r, s and v out of the 65 bytes; byte(0, …) keeps only the first byte of the last word.
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, S_OFFSET))
            v := byte(0, calldataload(add(signature.offset, V_OFFSET)))
        }
        if (uint256(s) > HALF_ORDER || (v != V_EVEN && v != V_ODD)) revert BadAuthorization();
        address signer = ecrecover(openDigest(claimHash, deadline, validUntil), v, r, s);
        if (signer == address(0) || signer != oracle) revert BadAuthorization();
    }

    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("Vaticeno Escrow"), keccak256("1"), block.chainid, address(this))
        );
    }

    // ---- token movement: state is always written before a transfer ----

    function _refundBoth(Stake storage stake) private {
        _push(stake.maker, stake.amount);
        _push(stake.taker, stake.amount);
    }

    function _pull(address from, uint256 value) private {
        _call(abi.encodeCall(IERC20.transferFrom, (from, address(this), value)));
    }

    function _push(address to, uint256 value) private {
        _call(abi.encodeCall(IERC20.transfer, (to, value)));
    }

    // Accepts a token that returns nothing as well as one that returns true, as stablecoins differ.
    function _call(bytes memory data) private {
        (bool ok, bytes memory returned) = address(token).call(data);
        if (!ok || (returned.length != 0 && !abi.decode(returned, (bool)))) revert TransferFailed();
    }
}
