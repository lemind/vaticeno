// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {Escrow} from "../src/Escrow.sol";
import {TestToken} from "../src/TestToken.sol";

/// Every branch of every transition (003 SC-014), and the operator trying to move funds (SC-013).
contract EscrowTest is Test {
    uint64 constant WINDOW = 72 hours;
    uint64 constant TIMEOUT = 14 days;
    uint64 constant ACCEPT_CLOSES = 24 hours;
    uint64 constant OFFER_LIFETIME = 7 days;
    uint128 constant MAX_STAKE = 100e18;
    uint128 constant AMOUNT = 10e18;
    bytes32 constant CLAIM = keccak256("claim-1");
    bytes32 constant EVIDENCE = keccak256("evidence-1");

    uint256 oracleKey = 0xA11CE;
    address oracle;
    address guardian = makeAddr("guardian");
    address feeRecipient = makeAddr("fees");
    address maker = makeAddr("maker");
    address taker = makeAddr("taker");
    address stranger = makeAddr("stranger");

    TestToken token;
    Escrow escrow;
    uint64 deadline;

    function setUp() public {
        vm.warp(1_800_000_000);
        oracle = vm.addr(oracleKey);
        token = new TestToken();
        escrow = _deploy(0);
        deadline = uint64(vm.getBlockTimestamp() + 30 days);
        for (uint256 i = 0; i < 3; i++) {
            address who = [maker, taker, stranger][i];
            token.mint(who, 1_000e18);
            vm.prank(who);
            token.approve(address(escrow), type(uint256).max);
        }
    }

    // ---- helpers ----

    function _config(uint16 feeBps) internal view returns (Escrow.Config memory) {
        return Escrow.Config({
            token: address(token),
            oracle: oracle,
            guardian: guardian,
            feeRecipient: feeRecipient,
            feeBps: feeBps,
            settlementWindow: WINDOW,
            timeout: TIMEOUT,
            acceptanceCloses: ACCEPT_CLOSES,
            offerLifetime: OFFER_LIFETIME,
            maxStake: MAX_STAKE
        });
    }

    function _deploy(uint16 feeBps) internal returns (Escrow) {
        return new Escrow(_config(feeBps));
    }

    function _sign(uint256 key, bytes32 claimHash, uint64 claimDeadline, uint64 validUntil)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, escrow.openDigest(claimHash, claimDeadline, validUntil));
        return abi.encodePacked(r, s, v);
    }

    function _open(bool makerSaysHit) internal returns (uint256) {
        uint64 validUntil = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory auth = _sign(oracleKey, CLAIM, deadline, validUntil);
        vm.prank(maker);
        return escrow.open(CLAIM, deadline, validUntil, auth, makerSaysHit, AMOUNT);
    }

    function _matched(bool makerSaysHit) internal returns (uint256 id) {
        id = _open(makerSaysHit);
        vm.prank(taker);
        escrow.accept(id);
    }

    function _settled(bool makerSaysHit, Escrow.Outcome outcome) internal returns (uint256 id) {
        id = _matched(makerSaysHit);
        vm.warp(deadline);
        vm.prank(oracle);
        escrow.settle(id, outcome, EVIDENCE);
    }

    function _state(uint256 id) internal view returns (Escrow.State state) {
        (,,,,,,,, state,) = escrow.stakes(id);
    }

    function _offerExpiry(uint256 id) internal view returns (uint64 expiry) {
        (,,,,, expiry,,,,) = escrow.stakes(id);
    }

    // ---- construction ----

    function test_constructor_refuses_each_bad_setting() public {
        Escrow.Config memory c = _config(0);

        c.feeBps = escrow.FEE_CEILING_BPS() + 1;
        vm.expectRevert(Escrow.BadConfig.selector);
        new Escrow(c);

        c = _config(0);
        c.guardian = oracle;
        vm.expectRevert(Escrow.BadConfig.selector);
        new Escrow(c);

        c = _config(0);
        c.token = makeAddr("not-a-contract");
        vm.expectRevert(Escrow.BadConfig.selector);
        new Escrow(c);

        c = _config(0);
        c.oracle = address(0);
        vm.expectRevert(Escrow.BadConfig.selector);
        new Escrow(c);

        c = _config(0);
        c.feeRecipient = address(0);
        vm.expectRevert(Escrow.BadConfig.selector);
        new Escrow(c);

        c = _config(0);
        c.settlementWindow = 0;
        vm.expectRevert(Escrow.BadConfig.selector);
        new Escrow(c);

        c = _config(0);
        c.timeout = 0;
        vm.expectRevert(Escrow.BadConfig.selector);
        new Escrow(c);

        c = _config(0);
        c.maxStake = 0;
        vm.expectRevert(Escrow.BadConfig.selector);
        new Escrow(c);
    }

    function test_the_fee_ceiling_itself_is_allowed() public {
        assertEq(_deploy(escrow.FEE_CEILING_BPS()).feeBps(), 500);
    }

    // ---- open ----

    function test_open_takes_the_stake_and_records_the_side() public {
        uint256 id = _open(true);
        assertEq(uint8(_state(id)), uint8(Escrow.State.Open));
        assertEq(token.balanceOf(address(escrow)), AMOUNT);
    }

    function test_every_stake_on_a_claim_is_found_from_the_claim() public {
        uint256 first = _open(true);
        uint256 second = _open(false);
        uint256[] memory found = escrow.stakesOf(CLAIM);
        assertEq(found.length, 2);
        assertEq(found[0], first);
        assertEq(found[1], second);
        assertEq(escrow.stakesOf(keccak256("another claim")).length, 0);
    }

    function test_an_offer_expires_seven_days_after_opening_when_that_comes_first() public {
        assertEq(_offerExpiry(_open(true)), vm.getBlockTimestamp() + OFFER_LIFETIME);
    }

    function test_an_offer_expires_when_acceptance_closes_when_that_comes_first() public {
        deadline = uint64(vm.getBlockTimestamp() + 3 days);
        assertEq(_offerExpiry(_open(true)), deadline - ACCEPT_CLOSES);
    }

    function test_open_refuses_when_paused() public {
        vm.prank(guardian);
        escrow.pause();
        uint64 validUntil = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory auth = _sign(oracleKey, CLAIM, deadline, validUntil);
        vm.prank(maker);
        vm.expectRevert(Escrow.StakingPaused.selector);
        escrow.open(CLAIM, deadline, validUntil, auth, true, AMOUNT);
    }

    function test_open_refuses_zero_and_over_the_maximum() public {
        uint64 validUntil = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory auth = _sign(oracleKey, CLAIM, deadline, validUntil);
        vm.startPrank(maker);
        vm.expectRevert(Escrow.BadAmount.selector);
        escrow.open(CLAIM, deadline, validUntil, auth, true, 0);
        vm.expectRevert(Escrow.BadAmount.selector);
        escrow.open(CLAIM, deadline, validUntil, auth, true, MAX_STAKE + 1);
        escrow.open(CLAIM, deadline, validUntil, auth, true, MAX_STAKE);
        vm.stopPrank();
    }

    function test_open_refuses_an_expired_authorization() public {
        uint64 validUntil = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory auth = _sign(oracleKey, CLAIM, deadline, validUntil);
        vm.warp(validUntil + 1);
        vm.prank(maker);
        vm.expectRevert(Escrow.BadAuthorization.selector);
        escrow.open(CLAIM, deadline, validUntil, auth, true, AMOUNT);
    }

    function test_open_refuses_a_signature_from_anyone_but_the_oracle() public {
        uint64 validUntil = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory auth = _sign(0xBAD, CLAIM, deadline, validUntil);
        vm.prank(maker);
        vm.expectRevert(Escrow.BadAuthorization.selector);
        escrow.open(CLAIM, deadline, validUntil, auth, true, AMOUNT);
    }

    function test_an_authorization_holds_only_for_the_claim_and_deadline_it_names() public {
        uint64 validUntil = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory auth = _sign(oracleKey, CLAIM, deadline, validUntil);
        vm.startPrank(maker);
        vm.expectRevert(Escrow.BadAuthorization.selector);
        escrow.open(keccak256("a model-judged claim"), deadline, validUntil, auth, true, AMOUNT);
        vm.expectRevert(Escrow.BadAuthorization.selector);
        escrow.open(CLAIM, deadline + 1, validUntil, auth, true, AMOUNT);
        vm.expectRevert(Escrow.BadAuthorization.selector);
        escrow.open(CLAIM, deadline, validUntil + 1, auth, true, AMOUNT);
        vm.stopPrank();
    }

    function test_open_refuses_a_malformed_or_malleable_signature() public {
        uint64 validUntil = uint64(vm.getBlockTimestamp() + 1 hours);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oracleKey, escrow.openDigest(CLAIM, deadline, validUntil));
        uint256 order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141;
        bytes32 highS = bytes32(order - uint256(s));
        uint8 flippedV = v == 27 ? 28 : 27;

        vm.startPrank(maker);
        vm.expectRevert(Escrow.BadAuthorization.selector);
        escrow.open(CLAIM, deadline, validUntil, abi.encodePacked(r, s), true, AMOUNT);
        vm.expectRevert(Escrow.BadAuthorization.selector);
        escrow.open(CLAIM, deadline, validUntil, abi.encodePacked(r, highS, flippedV), true, AMOUNT);
        vm.expectRevert(Escrow.BadAuthorization.selector);
        escrow.open(CLAIM, deadline, validUntil, abi.encodePacked(r, s, uint8(29)), true, AMOUNT);
        vm.stopPrank();
    }

    function test_an_authorization_signed_for_another_chain_is_refused() public {
        uint64 validUntil = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory auth = _sign(oracleKey, CLAIM, deadline, validUntil);
        vm.chainId(1);
        vm.prank(maker);
        vm.expectRevert(Escrow.BadAuthorization.selector);
        escrow.open(CLAIM, deadline, validUntil, auth, true, AMOUNT);
    }

    function test_open_refuses_once_acceptance_has_closed() public {
        uint64 validUntil = uint64(vm.getBlockTimestamp() + 1 hours);
        uint64 soon = uint64(vm.getBlockTimestamp() + ACCEPT_CLOSES);
        bytes memory auth = _sign(oracleKey, CLAIM, soon, validUntil);
        vm.prank(maker);
        vm.expectRevert(Escrow.TooLate.selector);
        escrow.open(CLAIM, soon, validUntil, auth, true, AMOUNT);

        auth = _sign(oracleKey, CLAIM, ACCEPT_CLOSES, validUntil);
        vm.prank(maker);
        vm.expectRevert(Escrow.TooLate.selector);
        escrow.open(CLAIM, ACCEPT_CLOSES, validUntil, auth, true, AMOUNT);
    }

    // ---- accept ----

    function test_accept_matches_the_same_amount() public {
        uint256 id = _matched(true);
        assertEq(uint8(_state(id)), uint8(Escrow.State.Matched));
        assertEq(token.balanceOf(address(escrow)), uint256(AMOUNT) * 2);
    }

    function test_accept_refuses_when_paused_twice_or_by_the_maker() public {
        uint256 id = _open(true);
        vm.prank(maker);
        vm.expectRevert(Escrow.SameParty.selector);
        escrow.accept(id);

        vm.prank(guardian);
        escrow.pause();
        vm.prank(taker);
        vm.expectRevert(Escrow.StakingPaused.selector);
        escrow.accept(id);

        vm.prank(guardian);
        escrow.unpause();
        vm.prank(taker);
        escrow.accept(id);
        vm.prank(stranger);
        vm.expectRevert(Escrow.BadState.selector);
        escrow.accept(id);
    }

    function test_accept_refuses_an_expired_offer() public {
        uint256 id = _open(true);
        vm.warp(_offerExpiry(id));
        vm.prank(taker);
        vm.expectRevert(Escrow.TooLate.selector);
        escrow.accept(id);
    }

    // ---- expire ----

    function test_an_unmatched_offer_returns_to_its_maker_called_by_anyone() public {
        uint256 id = _open(true);
        uint256 before = token.balanceOf(maker);
        vm.prank(stranger);
        vm.expectRevert(Escrow.TooEarly.selector);
        escrow.expire(id);

        vm.warp(_offerExpiry(id));
        vm.prank(stranger);
        escrow.expire(id);
        assertEq(token.balanceOf(maker), before + AMOUNT);
        assertEq(uint8(_state(id)), uint8(Escrow.State.Expired));
    }

    function test_a_matched_stake_cannot_expire() public {
        uint256 id = _matched(true);
        vm.warp(_offerExpiry(id));
        vm.expectRevert(Escrow.BadState.selector);
        escrow.expire(id);
    }

    // ---- settle ----

    function test_settle_is_the_oracles_alone() public {
        uint256 id = _matched(true);
        vm.warp(deadline);
        for (uint256 i = 0; i < 3; i++) {
            vm.prank([guardian, maker, stranger][i]);
            vm.expectRevert(Escrow.NotOracle.selector);
            escrow.settle(id, Escrow.Outcome.Hit, EVIDENCE);
        }
    }

    function test_settle_refuses_no_outcome_and_no_evidence() public {
        uint256 id = _matched(true);
        vm.warp(deadline);
        vm.startPrank(oracle);
        vm.expectRevert(Escrow.BadOutcome.selector);
        escrow.settle(id, Escrow.Outcome.None, EVIDENCE);
        vm.expectRevert(Escrow.MissingReference.selector);
        escrow.settle(id, Escrow.Outcome.Hit, bytes32(0));
        vm.stopPrank();
    }

    function test_settle_refuses_before_the_deadline_and_from_the_timeout_on() public {
        uint256 id = _matched(true);
        vm.warp(deadline - 1);
        vm.prank(oracle);
        vm.expectRevert(Escrow.TooEarly.selector);
        escrow.settle(id, Escrow.Outcome.Hit, EVIDENCE);

        vm.warp(uint256(deadline) + TIMEOUT);
        vm.prank(oracle);
        vm.expectRevert(Escrow.TooLate.selector);
        escrow.settle(id, Escrow.Outcome.Hit, EVIDENCE);
    }

    function test_settle_refuses_an_unmatched_offer_and_a_second_settlement() public {
        uint256 open = _open(true);
        uint256 id = _settled(true, Escrow.Outcome.Hit);
        vm.prank(oracle);
        vm.expectRevert(Escrow.BadState.selector);
        escrow.settle(open, Escrow.Outcome.Hit, EVIDENCE);
        vm.prank(oracle);
        vm.expectRevert(Escrow.BadState.selector);
        escrow.settle(id, Escrow.Outcome.Miss, EVIDENCE);
    }

    function test_a_hit_or_miss_verdict_pays_nobody_yet() public {
        uint256 id = _settled(true, Escrow.Outcome.Hit);
        assertEq(uint8(_state(id)), uint8(Escrow.State.Settled));
        assertEq(token.balanceOf(address(escrow)), uint256(AMOUNT) * 2);
    }

    function test_a_void_verdict_refunds_both_at_once() public {
        uint256 makerBefore = token.balanceOf(maker);
        uint256 takerBefore = token.balanceOf(taker);
        uint256 id = _settled(true, Escrow.Outcome.Void);
        assertEq(uint8(_state(id)), uint8(Escrow.State.Refunded));
        assertEq(token.balanceOf(maker), makerBefore);
        assertEq(token.balanceOf(taker), takerBefore);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    // ---- payout ----

    function test_payout_cannot_be_pulled_early_and_can_be_pulled_by_a_third_address() public {
        uint256 id = _settled(true, Escrow.Outcome.Hit);
        vm.warp(vm.getBlockTimestamp() + WINDOW - 1);
        vm.prank(stranger);
        vm.expectRevert(Escrow.TooEarly.selector);
        escrow.payout(id);

        vm.warp(vm.getBlockTimestamp() + 1);
        uint256 before = token.balanceOf(maker);
        vm.prank(stranger);
        escrow.payout(id);
        assertEq(token.balanceOf(maker), before + uint256(AMOUNT) * 2);
        assertEq(uint8(_state(id)), uint8(Escrow.State.Paid));
    }

    function test_the_winner_is_whoever_took_the_side_the_verdict_names() public {
        bool[2] memory sides = [true, false];
        Escrow.Outcome[2] memory outcomes = [Escrow.Outcome.Hit, Escrow.Outcome.Miss];
        for (uint256 i = 0; i < 2; i++) {
            for (uint256 j = 0; j < 2; j++) {
                setUp();
                uint256 id = _settled(sides[i], outcomes[j]);
                vm.warp(vm.getBlockTimestamp() + WINDOW);
                bool makerWins = (outcomes[j] == Escrow.Outcome.Hit) == sides[i];
                address winner = makerWins ? maker : taker;
                uint256 before = token.balanceOf(winner);
                escrow.payout(id);
                assertEq(token.balanceOf(winner), before + uint256(AMOUNT) * 2);
            }
        }
    }

    function test_payout_takes_the_fee_fixed_at_deployment_and_pays_once() public {
        escrow = _deploy(escrow.FEE_CEILING_BPS());
        vm.prank(maker);
        token.approve(address(escrow), type(uint256).max);
        vm.prank(taker);
        token.approve(address(escrow), type(uint256).max);

        uint256 id = _settled(true, Escrow.Outcome.Hit);
        vm.warp(vm.getBlockTimestamp() + WINDOW);
        uint256 makerBefore = token.balanceOf(maker);
        escrow.payout(id);
        uint256 pot = uint256(AMOUNT) * 2;
        assertEq(token.balanceOf(feeRecipient), pot / 20);
        assertEq(token.balanceOf(maker), makerBefore + pot - pot / 20);

        vm.expectRevert(Escrow.BadState.selector);
        escrow.payout(id);
    }

    function test_payout_refuses_anything_not_settled() public {
        uint256 id = _matched(true);
        vm.expectRevert(Escrow.BadState.selector);
        escrow.payout(id);
    }

    // ---- void ----

    function test_a_void_inside_the_window_refunds_both_and_pays_nobody() public {
        address[2] memory referees = [oracle, guardian];
        for (uint256 i = 0; i < 2; i++) {
            setUp();
            uint256 makerBefore = token.balanceOf(maker);
            uint256 takerBefore = token.balanceOf(taker);
            uint256 id = _settled(true, Escrow.Outcome.Hit);
            vm.prank(referees[i]);
            escrow.voidStake(id, 1, EVIDENCE);
            assertEq(token.balanceOf(maker), makerBefore);
            assertEq(token.balanceOf(taker), takerBefore);
            assertEq(token.balanceOf(feeRecipient), 0);
            assertEq(uint8(_state(id)), uint8(Escrow.State.Voided));

            vm.warp(vm.getBlockTimestamp() + WINDOW);
            vm.expectRevert(Escrow.BadState.selector);
            escrow.payout(id);
        }
    }

    function test_a_void_after_the_window_is_refused() public {
        uint256 id = _settled(true, Escrow.Outcome.Hit);
        vm.warp(vm.getBlockTimestamp() + WINDOW);
        vm.prank(oracle);
        vm.expectRevert(Escrow.TooLate.selector);
        escrow.voidStake(id, 1, EVIDENCE);
    }

    function test_void_refuses_strangers_unknown_reasons_and_missing_evidence() public {
        uint256 id = _settled(true, Escrow.Outcome.Hit);
        vm.prank(maker);
        vm.expectRevert(Escrow.NotReferee.selector);
        escrow.voidStake(id, 1, EVIDENCE);

        vm.startPrank(oracle);
        vm.expectRevert(Escrow.BadReason.selector);
        escrow.voidStake(id, 0, EVIDENCE);
        vm.expectRevert(Escrow.BadReason.selector);
        escrow.voidStake(id, 4, EVIDENCE);
        vm.expectRevert(Escrow.MissingReference.selector);
        escrow.voidStake(id, 3, bytes32(0));
        vm.stopPrank();
    }

    function test_void_refuses_a_stake_with_no_verdict() public {
        uint256 id = _matched(true);
        vm.prank(oracle);
        vm.expectRevert(Escrow.BadState.selector);
        escrow.voidStake(id, 1, EVIDENCE);
    }

    // ---- refund ----

    function test_the_timeout_refund_needs_nobody_from_our_side() public {
        uint256 id = _matched(true);
        uint256 makerBefore = token.balanceOf(maker);
        vm.warp(uint256(deadline) + TIMEOUT - 1);
        vm.prank(stranger);
        vm.expectRevert(Escrow.TooEarly.selector);
        escrow.refund(id);

        vm.warp(uint256(deadline) + TIMEOUT);
        vm.prank(stranger);
        escrow.refund(id);
        assertEq(token.balanceOf(maker), makerBefore + AMOUNT);
        assertEq(uint8(_state(id)), uint8(Escrow.State.Refunded));
    }

    function test_a_settled_stake_cannot_also_be_refunded() public {
        uint256 id = _settled(true, Escrow.Outcome.Hit);
        vm.warp(uint256(deadline) + TIMEOUT);
        vm.expectRevert(Escrow.BadState.selector);
        escrow.refund(id);
    }

    function test_an_unmatched_offer_is_expired_not_refunded() public {
        uint256 id = _open(true);
        vm.warp(uint256(deadline) + TIMEOUT);
        vm.expectRevert(Escrow.BadState.selector);
        escrow.refund(id);
    }

    // ---- token behaviour ----

    function test_a_failed_transfer_reverts_the_whole_move() public {
        address broke = makeAddr("broke");
        uint64 validUntil = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory auth = _sign(oracleKey, CLAIM, deadline, validUntil);
        vm.prank(broke);
        vm.expectRevert(Escrow.TransferFailed.selector);
        escrow.open(CLAIM, deadline, validUntil, auth, true, AMOUNT);
    }

    function test_a_token_that_answers_false_is_refused() public {
        escrow = new Escrow(_configFor(address(new FalseToken())));
        uint64 validUntil = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory auth = _sign(oracleKey, CLAIM, deadline, validUntil);
        vm.prank(maker);
        vm.expectRevert(Escrow.TransferFailed.selector);
        escrow.open(CLAIM, deadline, validUntil, auth, true, AMOUNT);
    }

    function test_a_token_that_returns_nothing_still_works() public {
        NoReturnToken quiet = new NoReturnToken();
        escrow = new Escrow(_configFor(address(quiet)));
        quiet.mint(maker, AMOUNT);
        uint256 id = _open(true);
        vm.warp(_offerExpiry(id));
        escrow.expire(id);
        assertEq(quiet.balanceOf(maker), AMOUNT);
    }

    function test_the_signing_domain_follows_the_chain() public {
        bytes32 here = escrow.domainSeparator();
        vm.chainId(1);
        assertTrue(escrow.domainSeparator() != here);
    }

    function _configFor(address stakeToken) internal view returns (Escrow.Config memory c) {
        c = _config(0);
        c.token = stakeToken;
    }

    // ---- the guardian ----

    function test_only_the_guardian_pauses() public {
        vm.prank(oracle);
        vm.expectRevert(Escrow.NotGuardian.selector);
        escrow.pause();
        vm.prank(maker);
        vm.expectRevert(Escrow.NotGuardian.selector);
        escrow.unpause();
    }

    function test_a_pause_never_blocks_money_already_owed() public {
        uint256 offered = _open(true);
        uint256 toPay = _matched(true);
        uint256 toRefund = _matched(false);
        vm.prank(guardian);
        escrow.pause();

        vm.warp(deadline);
        vm.prank(oracle);
        escrow.settle(toPay, Escrow.Outcome.Hit, EVIDENCE);
        vm.warp(vm.getBlockTimestamp() + WINDOW);
        escrow.payout(toPay);
        escrow.expire(offered);
        vm.warp(uint256(deadline) + TIMEOUT);
        escrow.refund(toRefund);
        assertEq(token.balanceOf(address(escrow)), 0);
    }
}

/// Answers false instead of reverting, as some tokens do.
contract FalseToken {
    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }
}

/// Returns nothing at all, as some stablecoins do; moves balances and never checks an allowance.
contract NoReturnToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 value) external {
        balanceOf[to] += value;
    }

    function transfer(address to, uint256 value) external {
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
    }

    function transferFrom(address from, address to, uint256 value) external {
        balanceOf[from] -= value;
        balanceOf[to] += value;
    }
}

/// Random calls by every actor, the operator's keys included. The escrow must always hold exactly what its
/// live stakes are owed, and the oracle and the guardian must never end up with a token (SC-013).
contract EscrowOperatorInvariant is Test {
    EscrowHandler handler;

    function setUp() public {
        handler = new EscrowHandler();
        targetContract(address(handler));
    }

    function invariant_the_escrow_holds_exactly_what_live_stakes_are_owed() public view {
        assertEq(handler.token().balanceOf(address(handler.escrow())), handler.owed());
    }

    function invariant_the_operator_never_receives_a_token() public view {
        assertEq(handler.token().balanceOf(handler.oracle()), 0);
        assertEq(handler.token().balanceOf(handler.guardian()), 0);
    }

    function afterInvariant() external view {
        bytes4[6] memory moves = [
            handler.accept.selector,
            handler.settle.selector,
            handler.payout.selector,
            handler.voidStake.selector,
            handler.refund.selector,
            handler.expire.selector
        ];
        string[6] memory names = ["accept", "settle", "payout", "void", "refund", "expire"];
        for (uint256 i = 0; i < 6; i++) {
            console.log(names[i], handler.succeeded(moves[i]));
        }
    }
}

contract EscrowHandler is Test {
    uint256 constant ORACLE_KEY = 0xA11CE;
    uint128 constant AMOUNT = 10e18;

    TestToken public token;
    Escrow public escrow;
    address public oracle;
    address public guardian = makeAddr("guardian");
    address[4] actors;
    uint256[] ids;
    mapping(uint256 => address) makers;
    mapping(bytes4 => uint256) public succeeded;

    constructor() {
        vm.warp(1_800_000_000);
        oracle = vm.addr(ORACLE_KEY);
        token = new TestToken();
        escrow = new Escrow(
            Escrow.Config({
                token: address(token),
                oracle: oracle,
                guardian: guardian,
                feeRecipient: makeAddr("fees"),
                feeBps: 0,
                settlementWindow: 72 hours,
                timeout: 14 days,
                acceptanceCloses: 24 hours,
                offerLifetime: 7 days,
                maxStake: 100e18
            })
        );
        actors = [makeAddr("a"), makeAddr("b"), oracle, guardian];
        for (uint256 i = 0; i < 2; i++) {
            token.mint(actors[i], 1_000_000e18);
            vm.prank(actors[i]);
            token.approve(address(escrow), type(uint256).max);
        }
    }

    function owed() external view returns (uint256 total) {
        for (uint256 i = 0; i < ids.length; i++) {
            (,,, uint128 amount,,,,, Escrow.State state,) = escrow.stakes(ids[i]);
            if (state == Escrow.State.Open) total += amount;
            if (state == Escrow.State.Matched || state == Escrow.State.Settled) total += uint256(amount) * 2;
        }
    }

    function open(uint256 actor, bool side, uint32 inDays) external {
        uint64 deadline = uint64(vm.getBlockTimestamp() + 2 days + (uint256(inDays) % 14) * 1 days);
        uint64 validUntil = uint64(vm.getBlockTimestamp() + 1 hours);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ORACLE_KEY, escrow.openDigest(keccak256("c"), deadline, validUntil));
        vm.prank(actors[actor % 2]);
        try escrow.open(keccak256("c"), deadline, validUntil, abi.encodePacked(r, s, v), side, AMOUNT) returns (
            uint256 id
        ) {
            ids.push(id);
            makers[id] = actors[actor % 2];
        } catch {}
    }

    // Offers live days, not weeks, so a random old id is nearly always dead: aim at the newest, as the other side.
    function accept(uint256 pick) external {
        if (ids.length == 0) return;
        uint256 recent = ids.length < 3 ? ids.length : 3;
        uint256 id = ids[ids.length - 1 - (pick % recent)];
        vm.prank(makers[id] == actors[0] ? actors[1] : actors[0]);
        try escrow.accept(id) {
            succeeded[this.accept.selector]++;
        } catch {}
    }

    // The oracle waits for the deadline before it settles, as the worker does. Three calls in four come from it,
    // the fourth from anyone else, who must be refused.
    function settle(uint256 actor, uint256 pick, uint8 outcome) external {
        if (ids.length == 0) return;
        uint256 id = _recent(pick);
        (,,,, uint64 deadline,,,,,) = escrow.stakes(id);
        if (vm.getBlockTimestamp() < deadline) vm.warp(deadline);
        vm.prank(actor % 4 == 0 ? actors[actor % 3] : oracle);
        try escrow.settle(id, Escrow.Outcome(1 + (outcome % 3)), keccak256("e")) {
            succeeded[this.settle.selector]++;
        } catch {}
    }

    function payout(uint256 actor, uint256 pick) external {
        if (ids.length == 0) return;
        vm.prank(actors[actor % 4]);
        try escrow.payout(ids[pick % ids.length]) {
            succeeded[this.payout.selector]++;
        } catch {}
    }

    function voidStake(uint256 actor, uint256 pick, uint8 reason) external {
        if (ids.length == 0) return;
        vm.prank(actor % 4 == 0 ? actors[actor % 2] : actors[2 + (actor % 2)]);
        try escrow.voidStake(_recent(pick), reason % 4, keccak256("e")) {
            succeeded[this.voidStake.selector]++;
        } catch {}
    }

    function refund(uint256 actor, uint256 pick) external {
        if (ids.length == 0) return;
        vm.prank(actors[actor % 4]);
        try escrow.refund(ids[pick % ids.length]) {
            succeeded[this.refund.selector]++;
        } catch {}
    }

    function expire(uint256 actor, uint256 pick) external {
        if (ids.length == 0) return;
        vm.prank(actors[actor % 4]);
        try escrow.expire(ids[pick % ids.length]) {
            succeeded[this.expire.selector]++;
        } catch {}
    }

    function pause(uint256 actor, bool on) external {
        vm.prank(actors[actor % 4]);
        if (on) {
            try escrow.pause() {} catch {}
        } else {
            try escrow.unpause() {} catch {}
        }
    }

    function _recent(uint256 pick) private view returns (uint256) {
        uint256 recent = ids.length < 4 ? ids.length : 4;
        return ids[ids.length - 1 - (pick % recent)];
    }

    function passTime(uint32 hoursAhead) external {
        vm.warp(vm.getBlockTimestamp() + 1 hours + (uint256(hoursAhead) % (3 * 24)) * 1 hours);
    }
}
