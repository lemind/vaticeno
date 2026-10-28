// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {EscrowV2} from "../src/EscrowV2.sol";
import {TestUsdc} from "../src/TestUsdc.sol";

/// Every branch of every transition (003 SC-014) for v2, plus what v2 adds: credits and withdrawals (FR-036b),
/// one blocked address never freezing another (SC-025), the caps (SC-026) and the USDC pin (FR-036c).
contract EscrowV2Test is Test {
    uint64 constant WINDOW = 72 hours;
    uint64 constant TIMEOUT = 14 days;
    uint64 constant ACCEPT_CLOSES = 24 hours;
    uint64 constant OFFER_LIFETIME = 7 days;
    // 007-escrow-v2's numbers, in 6-decimal base units.
    uint128 constant MIN_STAKE = 1e6;
    uint128 constant MAX_STAKE = 1_000e6;
    uint128 constant MAX_PER_CLAIM = 10_000e6;
    uint128 constant MAX_TOTAL = 50_000e6;
    uint128 constant AMOUNT = 10e6;
    bytes32 constant CLAIM = keccak256("claim-1");
    bytes32 constant EVIDENCE = keccak256("evidence-1");

    uint256 oracleKey = 0xA11CE;
    address oracle;
    address guardian = makeAddr("guardian");
    address feeRecipient = makeAddr("fees");
    address maker = makeAddr("maker");
    address taker = makeAddr("taker");
    address stranger = makeAddr("stranger");

    TestUsdc token;
    EscrowV2 escrow;
    uint64 deadline;

    function setUp() public {
        vm.warp(1_800_000_000);
        oracle = vm.addr(oracleKey);
        token = new TestUsdc();
        escrow = _deploy(0);
        deadline = uint64(vm.getBlockTimestamp() + 30 days);
        for (uint256 i = 0; i < 3; i++) {
            address who = [maker, taker, stranger][i];
            token.mint(who, 1_000_000e6);
            vm.prank(who);
            token.approve(address(escrow), type(uint256).max);
        }
    }

    // ---- helpers ----

    function _config(uint16 feeBps) internal view returns (EscrowV2.Config memory) {
        return EscrowV2.Config({
            token: address(token),
            oracle: oracle,
            guardian: guardian,
            feeRecipient: feeRecipient,
            feeBps: feeBps,
            settlementWindow: WINDOW,
            timeout: TIMEOUT,
            acceptanceCloses: ACCEPT_CLOSES,
            offerLifetime: OFFER_LIFETIME,
            minStake: MIN_STAKE,
            maxStake: MAX_STAKE,
            maxPerClaim: MAX_PER_CLAIM,
            maxTotal: MAX_TOTAL
        });
    }

    function _deploy(uint16 feeBps) internal returns (EscrowV2) {
        return new EscrowV2(_config(feeBps));
    }

    function _sign(uint256 key, bytes32 claimHash, uint64 claimDeadline, uint64 validUntil)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, escrow.openDigest(claimHash, claimDeadline, validUntil));
        return abi.encodePacked(r, s, v);
    }

    function _openOn(bytes32 claimHash, address who, uint128 amount) internal returns (uint256) {
        uint64 validUntil = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory auth = _sign(oracleKey, claimHash, deadline, validUntil);
        vm.prank(who);
        return escrow.open(claimHash, deadline, validUntil, auth, true, amount);
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

    function _settled(bool makerSaysHit, EscrowV2.Outcome outcome) internal returns (uint256 id) {
        id = _matched(makerSaysHit);
        vm.warp(deadline);
        vm.prank(oracle);
        escrow.settle(id, outcome, EVIDENCE);
    }

    function _state(uint256 id) internal view returns (EscrowV2.State state) {
        (,,,,,,,, state,) = escrow.stakes(id);
    }

    function _offerExpiry(uint256 id) internal view returns (uint64 expiry) {
        (,,,,, expiry,,,,) = escrow.stakes(id);
    }

    function _withdraw(address who) internal returns (uint256 got) {
        uint256 before = token.balanceOf(who);
        vm.prank(who);
        escrow.withdraw();
        got = token.balanceOf(who) - before;
    }

    // ---- construction ----

    function test_constructor_refuses_each_bad_setting() public {
        EscrowV2.Config memory c;

        c = _config(0);
        c.feeBps = escrow.FEE_CEILING_BPS() + 1;
        vm.expectRevert(EscrowV2.BadConfig.selector);
        new EscrowV2(c);

        c = _config(0);
        c.guardian = oracle;
        vm.expectRevert(EscrowV2.BadConfig.selector);
        new EscrowV2(c);

        c = _config(0);
        c.token = makeAddr("not-a-contract");
        vm.expectRevert(EscrowV2.BadConfig.selector);
        new EscrowV2(c);

        c = _config(0);
        c.oracle = address(0);
        vm.expectRevert(EscrowV2.BadConfig.selector);
        new EscrowV2(c);

        c = _config(0);
        c.guardian = address(0);
        vm.expectRevert(EscrowV2.BadConfig.selector);
        new EscrowV2(c);

        c = _config(0);
        c.feeRecipient = address(0);
        vm.expectRevert(EscrowV2.BadConfig.selector);
        new EscrowV2(c);

        c = _config(0);
        c.settlementWindow = 0;
        vm.expectRevert(EscrowV2.BadConfig.selector);
        new EscrowV2(c);

        c = _config(0);
        c.timeout = 0;
        vm.expectRevert(EscrowV2.BadConfig.selector);
        new EscrowV2(c);

        c = _config(0);
        c.offerLifetime = 0;
        vm.expectRevert(EscrowV2.BadConfig.selector);
        new EscrowV2(c);
    }

    function test_constructor_refuses_caps_that_do_not_nest() public {
        EscrowV2.Config memory c;

        c = _config(0);
        c.minStake = 0;
        vm.expectRevert(EscrowV2.BadConfig.selector);
        new EscrowV2(c);

        c = _config(0);
        c.minStake = MAX_STAKE + 1;
        vm.expectRevert(EscrowV2.BadConfig.selector);
        new EscrowV2(c);

        // One matched stake at the per-side cap is twice it: it must fit on one claim.
        c = _config(0);
        c.maxPerClaim = MAX_STAKE * 2 - 1;
        vm.expectRevert(EscrowV2.BadConfig.selector);
        new EscrowV2(c);

        c = _config(0);
        c.maxTotal = MAX_PER_CLAIM - 1;
        vm.expectRevert(EscrowV2.BadConfig.selector);
        new EscrowV2(c);

        c = _config(0);
        c.maxPerClaim = MAX_STAKE * 2;
        c.maxTotal = MAX_STAKE * 2;
        assertEq(new EscrowV2(c).maxTotal(), MAX_STAKE * 2);
    }

    function test_the_fee_ceiling_itself_is_allowed() public {
        assertEq(_deploy(escrow.FEE_CEILING_BPS()).feeBps(), 500);
    }

    // ---- the token: native USDC only, where it exists (FR-036c) ----

    function test_on_base_and_arbitrum_only_native_usdc_is_accepted() public {
        address[2] memory usdc =
            [0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913, 0xaf88d065e77c8cC2239327C5EDb3A432268e5831];
        uint256[2] memory chains = [uint256(8453), 42161];
        for (uint256 i = 0; i < 2; i++) {
            vm.chainId(chains[i]);
            vm.etch(usdc[i], address(token).code);
            vm.etch(usdc[1 - i], address(token).code);

            // Any other token, the other network's USDC included, is refused.
            vm.expectRevert(EscrowV2.BadConfig.selector);
            new EscrowV2(_config(0));
            EscrowV2.Config memory c = _config(0);
            c.token = usdc[1 - i];
            vm.expectRevert(EscrowV2.BadConfig.selector);
            new EscrowV2(c);

            c.token = usdc[i];
            assertEq(address(new EscrowV2(c).token()), usdc[i]);
        }
    }

    function test_a_testnet_takes_the_test_token() public view {
        assertEq(address(escrow.token()), address(token));
    }

    // ---- open ----

    function test_open_takes_the_stake_and_records_the_side() public {
        uint256 id = _open(true);
        assertEq(uint8(_state(id)), uint8(EscrowV2.State.Open));
        assertEq(token.balanceOf(address(escrow)), AMOUNT);
        assertEq(escrow.lockedOnClaim(CLAIM), AMOUNT);
        assertEq(escrow.lockedTotal(), AMOUNT);
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
        vm.expectRevert(EscrowV2.StakingPaused.selector);
        escrow.open(CLAIM, deadline, validUntil, auth, true, AMOUNT);
    }

    function test_open_refuses_below_the_minimum_and_over_the_maximum() public {
        uint64 validUntil = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory auth = _sign(oracleKey, CLAIM, deadline, validUntil);
        vm.startPrank(maker);
        vm.expectRevert(EscrowV2.BadAmount.selector);
        escrow.open(CLAIM, deadline, validUntil, auth, true, 0);
        vm.expectRevert(EscrowV2.BadAmount.selector);
        escrow.open(CLAIM, deadline, validUntil, auth, true, MIN_STAKE - 1);
        vm.expectRevert(EscrowV2.BadAmount.selector);
        escrow.open(CLAIM, deadline, validUntil, auth, true, MAX_STAKE + 1);
        escrow.open(CLAIM, deadline, validUntil, auth, true, MIN_STAKE);
        escrow.open(CLAIM, deadline, validUntil, auth, true, MAX_STAKE);
        vm.stopPrank();
    }

    function test_open_refuses_an_expired_authorization() public {
        uint64 validUntil = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory auth = _sign(oracleKey, CLAIM, deadline, validUntil);
        vm.warp(validUntil + 1);
        vm.prank(maker);
        vm.expectRevert(EscrowV2.BadAuthorization.selector);
        escrow.open(CLAIM, deadline, validUntil, auth, true, AMOUNT);
    }

    function test_open_refuses_a_signature_from_anyone_but_the_oracle() public {
        uint64 validUntil = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory auth = _sign(0xBAD, CLAIM, deadline, validUntil);
        vm.prank(maker);
        vm.expectRevert(EscrowV2.BadAuthorization.selector);
        escrow.open(CLAIM, deadline, validUntil, auth, true, AMOUNT);
    }

    function test_an_authorization_holds_only_for_the_claim_and_deadline_it_names() public {
        uint64 validUntil = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory auth = _sign(oracleKey, CLAIM, deadline, validUntil);
        vm.startPrank(maker);
        vm.expectRevert(EscrowV2.BadAuthorization.selector);
        escrow.open(keccak256("a model-judged claim"), deadline, validUntil, auth, true, AMOUNT);
        vm.expectRevert(EscrowV2.BadAuthorization.selector);
        escrow.open(CLAIM, deadline + 1, validUntil, auth, true, AMOUNT);
        vm.expectRevert(EscrowV2.BadAuthorization.selector);
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
        vm.expectRevert(EscrowV2.BadAuthorization.selector);
        escrow.open(CLAIM, deadline, validUntil, abi.encodePacked(r, s), true, AMOUNT);
        vm.expectRevert(EscrowV2.BadAuthorization.selector);
        escrow.open(CLAIM, deadline, validUntil, abi.encodePacked(r, highS, flippedV), true, AMOUNT);
        vm.expectRevert(EscrowV2.BadAuthorization.selector);
        escrow.open(CLAIM, deadline, validUntil, abi.encodePacked(r, s, uint8(29)), true, AMOUNT);
        vm.stopPrank();
    }

    function test_an_authorization_signed_for_another_chain_is_refused() public {
        uint64 validUntil = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory auth = _sign(oracleKey, CLAIM, deadline, validUntil);
        vm.chainId(1);
        vm.prank(maker);
        vm.expectRevert(EscrowV2.BadAuthorization.selector);
        escrow.open(CLAIM, deadline, validUntil, auth, true, AMOUNT);
    }

    function test_an_authorization_for_one_deployment_is_refused_by_another() public {
        // Two networks are two deployments: the address is in the signed domain, so one network's never opens on the other.
        EscrowV2 other = _deploy(0);
        uint64 validUntil = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory auth = _sign(oracleKey, CLAIM, deadline, validUntil);
        vm.prank(maker);
        vm.expectRevert(EscrowV2.BadAuthorization.selector);
        other.open(CLAIM, deadline, validUntil, auth, true, AMOUNT);
    }

    function test_open_refuses_once_acceptance_has_closed() public {
        uint64 validUntil = uint64(vm.getBlockTimestamp() + 1 hours);
        uint64 soon = uint64(vm.getBlockTimestamp() + ACCEPT_CLOSES);
        bytes memory auth = _sign(oracleKey, CLAIM, soon, validUntil);
        vm.prank(maker);
        vm.expectRevert(EscrowV2.TooLate.selector);
        escrow.open(CLAIM, soon, validUntil, auth, true, AMOUNT);

        auth = _sign(oracleKey, CLAIM, ACCEPT_CLOSES, validUntil);
        vm.prank(maker);
        vm.expectRevert(EscrowV2.TooLate.selector);
        escrow.open(CLAIM, ACCEPT_CLOSES, validUntil, auth, true, AMOUNT);
    }

    // ---- the caps (FR-022a, SC-026) ----

    function test_the_claim_cap_counts_an_offer_once_and_a_match_twice() public {
        // Ten offers at the per-side cap fill the claim exactly; the eleventh is refused.
        for (uint256 i = 0; i < 10; i++) {
            _openOn(CLAIM, maker, MAX_STAKE);
        }
        assertEq(escrow.lockedOnClaim(CLAIM), MAX_PER_CLAIM);
        uint64 validUntil = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory auth = _sign(oracleKey, CLAIM, deadline, validUntil);
        vm.prank(maker);
        vm.expectRevert(EscrowV2.ClaimCapReached.selector);
        escrow.open(CLAIM, deadline, validUntil, auth, true, MIN_STAKE);
    }

    function test_accept_is_refused_when_matching_would_pass_the_claim_cap() public {
        // Nine full offers and two half ones: 10,000 locked; matching any of them would need more.
        for (uint256 i = 0; i < 9; i++) {
            _openOn(CLAIM, maker, MAX_STAKE);
        }
        uint256 half = _openOn(CLAIM, maker, MAX_STAKE / 2);
        _openOn(CLAIM, maker, MAX_STAKE / 2);
        vm.prank(taker);
        vm.expectRevert(EscrowV2.ClaimCapReached.selector);
        escrow.accept(half);
    }

    function test_the_network_cap_holds_across_claims() public {
        // Five claims at their cap fill the network; a sixth claim cannot take a single dollar.
        for (uint256 c = 0; c < 5; c++) {
            for (uint256 i = 0; i < 10; i++) {
                _openOn(keccak256(abi.encode("claim", c)), maker, MAX_STAKE);
            }
        }
        assertEq(escrow.lockedTotal(), MAX_TOTAL);
        uint64 validUntil = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes32 sixth = keccak256("claim six");
        bytes memory auth = _sign(oracleKey, sixth, deadline, validUntil);
        vm.prank(maker);
        vm.expectRevert(EscrowV2.TotalCapReached.selector);
        escrow.open(sixth, deadline, validUntil, auth, true, MIN_STAKE);
    }

    function test_money_leaving_a_stake_frees_its_cap_and_credits_do_not_count() public {
        uint256 id = _settled(true, EscrowV2.Outcome.Hit);
        assertEq(escrow.lockedOnClaim(CLAIM), uint256(AMOUNT) * 2);
        vm.warp(vm.getBlockTimestamp() + WINDOW);
        escrow.payout(id);
        // Credited to the winner, not withdrawn: owed, no longer at stake.
        assertEq(escrow.creditOf(maker), uint256(AMOUNT) * 2);
        assertEq(escrow.lockedOnClaim(CLAIM), 0);
        assertEq(escrow.lockedTotal(), 0);
    }

    function test_every_exit_frees_exactly_what_its_stake_held() public {
        uint256 offered = _open(true);
        uint256 voidVerdict = _matched(true);
        uint256 toVoid = _matched(true);
        uint256 toRefund = _matched(false);
        assertEq(escrow.lockedTotal(), uint256(AMOUNT) * 7);

        vm.warp(deadline);
        vm.startPrank(oracle);
        escrow.settle(voidVerdict, EscrowV2.Outcome.Void, EVIDENCE);
        escrow.settle(toVoid, EscrowV2.Outcome.Miss, EVIDENCE);
        escrow.voidStake(toVoid, 2, EVIDENCE);
        vm.stopPrank();
        escrow.expire(offered);
        assertEq(escrow.lockedTotal(), uint256(AMOUNT) * 2);

        vm.warp(uint256(deadline) + TIMEOUT);
        escrow.refund(toRefund);
        assertEq(escrow.lockedTotal(), 0);
        assertEq(escrow.lockedOnClaim(CLAIM), 0);
    }

    // ---- accept ----

    function test_accept_matches_the_same_amount() public {
        uint256 id = _matched(true);
        assertEq(uint8(_state(id)), uint8(EscrowV2.State.Matched));
        assertEq(token.balanceOf(address(escrow)), uint256(AMOUNT) * 2);
    }

    function test_accept_refuses_when_paused_twice_or_by_the_maker() public {
        uint256 id = _open(true);
        vm.prank(maker);
        vm.expectRevert(EscrowV2.SameParty.selector);
        escrow.accept(id);

        vm.prank(guardian);
        escrow.pause();
        vm.prank(taker);
        vm.expectRevert(EscrowV2.StakingPaused.selector);
        escrow.accept(id);

        vm.prank(guardian);
        escrow.unpause();
        vm.prank(taker);
        escrow.accept(id);
        vm.prank(stranger);
        vm.expectRevert(EscrowV2.BadState.selector);
        escrow.accept(id);
    }

    function test_accept_refuses_an_expired_offer() public {
        uint256 id = _open(true);
        vm.warp(_offerExpiry(id));
        vm.prank(taker);
        vm.expectRevert(EscrowV2.TooLate.selector);
        escrow.accept(id);
    }

    // ---- expire ----

    function test_an_unmatched_offer_is_credited_to_its_maker_called_by_anyone() public {
        uint256 id = _open(true);
        vm.prank(stranger);
        vm.expectRevert(EscrowV2.TooEarly.selector);
        escrow.expire(id);

        vm.warp(_offerExpiry(id));
        vm.prank(stranger);
        escrow.expire(id);
        assertEq(escrow.creditOf(maker), AMOUNT);
        assertEq(uint8(_state(id)), uint8(EscrowV2.State.Expired));
        assertEq(_withdraw(maker), AMOUNT);
    }

    function test_a_matched_stake_cannot_expire() public {
        uint256 id = _matched(true);
        vm.warp(_offerExpiry(id));
        vm.expectRevert(EscrowV2.BadState.selector);
        escrow.expire(id);
    }

    // ---- settle ----

    function test_settle_is_the_oracles_alone() public {
        uint256 id = _matched(true);
        vm.warp(deadline);
        for (uint256 i = 0; i < 3; i++) {
            vm.prank([guardian, maker, stranger][i]);
            vm.expectRevert(EscrowV2.NotOracle.selector);
            escrow.settle(id, EscrowV2.Outcome.Hit, EVIDENCE);
        }
    }

    function test_settle_refuses_no_outcome_and_no_evidence() public {
        uint256 id = _matched(true);
        vm.warp(deadline);
        vm.startPrank(oracle);
        vm.expectRevert(EscrowV2.BadOutcome.selector);
        escrow.settle(id, EscrowV2.Outcome.None, EVIDENCE);
        vm.expectRevert(EscrowV2.MissingReference.selector);
        escrow.settle(id, EscrowV2.Outcome.Hit, bytes32(0));
        vm.stopPrank();
    }

    function test_settle_refuses_before_the_deadline_and_from_the_timeout_on() public {
        uint256 id = _matched(true);
        vm.warp(deadline - 1);
        vm.prank(oracle);
        vm.expectRevert(EscrowV2.TooEarly.selector);
        escrow.settle(id, EscrowV2.Outcome.Hit, EVIDENCE);

        vm.warp(uint256(deadline) + TIMEOUT);
        vm.prank(oracle);
        vm.expectRevert(EscrowV2.TooLate.selector);
        escrow.settle(id, EscrowV2.Outcome.Hit, EVIDENCE);
    }

    function test_settle_refuses_an_unmatched_offer_and_a_second_settlement() public {
        uint256 open = _open(true);
        uint256 id = _settled(true, EscrowV2.Outcome.Hit);
        vm.prank(oracle);
        vm.expectRevert(EscrowV2.BadState.selector);
        escrow.settle(open, EscrowV2.Outcome.Hit, EVIDENCE);
        vm.prank(oracle);
        vm.expectRevert(EscrowV2.BadState.selector);
        escrow.settle(id, EscrowV2.Outcome.Miss, EVIDENCE);
    }

    function test_a_hit_or_miss_verdict_credits_nobody_yet() public {
        uint256 id = _settled(true, EscrowV2.Outcome.Hit);
        assertEq(uint8(_state(id)), uint8(EscrowV2.State.Settled));
        assertEq(escrow.creditOf(maker), 0);
        assertEq(escrow.creditOf(taker), 0);
    }

    function test_a_void_verdict_credits_both_their_own_stake() public {
        uint256 id = _settled(true, EscrowV2.Outcome.Void);
        assertEq(uint8(_state(id)), uint8(EscrowV2.State.Refunded));
        assertEq(escrow.creditOf(maker), AMOUNT);
        assertEq(escrow.creditOf(taker), AMOUNT);
        assertEq(_withdraw(maker), AMOUNT);
        assertEq(_withdraw(taker), AMOUNT);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    // ---- payout ----

    function test_payout_cannot_be_called_early_and_can_be_called_by_a_third_address() public {
        uint256 id = _settled(true, EscrowV2.Outcome.Hit);
        vm.warp(vm.getBlockTimestamp() + WINDOW - 1);
        vm.prank(stranger);
        vm.expectRevert(EscrowV2.TooEarly.selector);
        escrow.payout(id);

        vm.warp(vm.getBlockTimestamp() + 1);
        vm.prank(stranger);
        escrow.payout(id);
        assertEq(uint8(_state(id)), uint8(EscrowV2.State.Paid));
        assertEq(_withdraw(maker), uint256(AMOUNT) * 2);
    }

    function test_the_winner_is_whoever_took_the_side_the_verdict_names() public {
        bool[2] memory sides = [true, false];
        EscrowV2.Outcome[2] memory outcomes = [EscrowV2.Outcome.Hit, EscrowV2.Outcome.Miss];
        for (uint256 i = 0; i < 2; i++) {
            for (uint256 j = 0; j < 2; j++) {
                setUp();
                uint256 id = _settled(sides[i], outcomes[j]);
                vm.warp(vm.getBlockTimestamp() + WINDOW);
                escrow.payout(id);
                bool makerWins = (outcomes[j] == EscrowV2.Outcome.Hit) == sides[i];
                (address winner, address loser) = makerWins ? (maker, taker) : (taker, maker);
                assertEq(escrow.creditOf(winner), uint256(AMOUNT) * 2);
                assertEq(escrow.creditOf(loser), 0);
            }
        }
    }

    function test_payout_takes_the_fee_fixed_at_deployment_rounded_down_and_pays_once() public {
        escrow = _deploy(escrow.FEE_CEILING_BPS());
        vm.prank(maker);
        token.approve(address(escrow), type(uint256).max);
        vm.prank(taker);
        token.approve(address(escrow), type(uint256).max);

        // 5% of a 2.000003 USDC pot is 100,000.15 base units: the fee is 100,000 and the remainder the winner's.
        uint64 validUntil = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory auth = _sign(oracleKey, CLAIM, deadline, validUntil);
        uint128 odd = 1_000_001 + 500_000;
        vm.prank(maker);
        uint256 id = escrow.open(CLAIM, deadline, validUntil, auth, true, odd);
        vm.prank(taker);
        escrow.accept(id);
        vm.warp(deadline);
        vm.prank(oracle);
        escrow.settle(id, EscrowV2.Outcome.Hit, EVIDENCE);
        vm.warp(vm.getBlockTimestamp() + WINDOW);
        escrow.payout(id);

        uint256 pot = uint256(odd) * 2;
        uint256 fee = (pot * 500) / 10_000;
        assertEq(escrow.creditOf(feeRecipient), fee);
        assertEq(escrow.creditOf(maker), pot - fee);
        assertEq(fee + (pot - fee), pot);

        vm.expectRevert(EscrowV2.BadState.selector);
        escrow.payout(id);
    }

    function test_no_fee_means_nothing_is_ever_credited_to_the_fee_recipient() public {
        uint256 id = _settled(true, EscrowV2.Outcome.Hit);
        vm.warp(vm.getBlockTimestamp() + WINDOW);
        escrow.payout(id);
        assertEq(escrow.creditOf(feeRecipient), 0);
    }

    function test_payout_refuses_anything_not_settled() public {
        uint256 id = _matched(true);
        vm.expectRevert(EscrowV2.BadState.selector);
        escrow.payout(id);
    }

    // ---- void ----

    function test_a_void_inside_the_window_credits_both_and_pays_nobody() public {
        address[2] memory referees = [oracle, guardian];
        for (uint256 i = 0; i < 2; i++) {
            setUp();
            escrow = _deploy(escrow.FEE_CEILING_BPS());
            vm.prank(maker);
            token.approve(address(escrow), type(uint256).max);
            vm.prank(taker);
            token.approve(address(escrow), type(uint256).max);
            uint256 id = _settled(true, EscrowV2.Outcome.Hit);
            vm.prank(referees[i]);
            escrow.voidStake(id, 1, EVIDENCE);
            assertEq(escrow.creditOf(maker), AMOUNT);
            assertEq(escrow.creditOf(taker), AMOUNT);
            // No refund path ever takes a fee, even where one is set (FR-022b).
            assertEq(escrow.creditOf(feeRecipient), 0);
            assertEq(uint8(_state(id)), uint8(EscrowV2.State.Voided));

            vm.warp(vm.getBlockTimestamp() + WINDOW);
            vm.expectRevert(EscrowV2.BadState.selector);
            escrow.payout(id);
        }
    }

    function test_a_void_after_the_window_is_refused() public {
        uint256 id = _settled(true, EscrowV2.Outcome.Hit);
        vm.warp(vm.getBlockTimestamp() + WINDOW);
        vm.prank(oracle);
        vm.expectRevert(EscrowV2.TooLate.selector);
        escrow.voidStake(id, 1, EVIDENCE);
    }

    function test_void_refuses_strangers_unknown_reasons_and_missing_evidence() public {
        uint256 id = _settled(true, EscrowV2.Outcome.Hit);
        vm.prank(maker);
        vm.expectRevert(EscrowV2.NotReferee.selector);
        escrow.voidStake(id, 1, EVIDENCE);

        vm.startPrank(oracle);
        vm.expectRevert(EscrowV2.BadReason.selector);
        escrow.voidStake(id, 0, EVIDENCE);
        vm.expectRevert(EscrowV2.BadReason.selector);
        escrow.voidStake(id, 4, EVIDENCE);
        vm.expectRevert(EscrowV2.MissingReference.selector);
        escrow.voidStake(id, 3, bytes32(0));
        vm.stopPrank();
    }

    function test_void_refuses_a_stake_with_no_verdict() public {
        uint256 id = _matched(true);
        vm.prank(oracle);
        vm.expectRevert(EscrowV2.BadState.selector);
        escrow.voidStake(id, 1, EVIDENCE);
    }

    // ---- refund ----

    function test_the_timeout_refund_needs_nobody_from_our_side() public {
        uint256 id = _matched(true);
        vm.warp(uint256(deadline) + TIMEOUT - 1);
        vm.prank(stranger);
        vm.expectRevert(EscrowV2.TooEarly.selector);
        escrow.refund(id);

        vm.warp(uint256(deadline) + TIMEOUT);
        vm.prank(stranger);
        escrow.refund(id);
        assertEq(uint8(_state(id)), uint8(EscrowV2.State.Refunded));
        assertEq(_withdraw(maker), AMOUNT);
        assertEq(_withdraw(taker), AMOUNT);
    }

    function test_a_settled_stake_cannot_also_be_refunded() public {
        uint256 id = _settled(true, EscrowV2.Outcome.Hit);
        vm.warp(uint256(deadline) + TIMEOUT);
        vm.expectRevert(EscrowV2.BadState.selector);
        escrow.refund(id);
    }

    function test_an_unmatched_offer_is_expired_not_refunded() public {
        uint256 id = _open(true);
        vm.warp(uint256(deadline) + TIMEOUT);
        vm.expectRevert(EscrowV2.BadState.selector);
        escrow.refund(id);
    }

    // ---- withdraw ----

    function test_withdraw_takes_the_whole_credit_once() public {
        uint256 b = _open(true);
        uint256 a = _settled(true, EscrowV2.Outcome.Void);
        escrow.expire(b);
        assertEq(uint8(_state(a)), uint8(EscrowV2.State.Refunded));
        // Credits from two stakes add up and leave in one withdrawal.
        assertEq(_withdraw(maker), uint256(AMOUNT) * 2);
        assertEq(escrow.creditOf(maker), 0);
        vm.prank(maker);
        vm.expectRevert(EscrowV2.NothingToWithdraw.selector);
        escrow.withdraw();
    }

    function test_withdraw_moves_only_the_callers_own_credit() public {
        _settled(true, EscrowV2.Outcome.Void);
        for (uint256 i = 0; i < 4; i++) {
            address who = [stranger, oracle, guardian, feeRecipient][i];
            vm.prank(who);
            vm.expectRevert(EscrowV2.NothingToWithdraw.selector);
            escrow.withdraw();
        }
        assertEq(escrow.creditOf(maker), AMOUNT);
        assertEq(escrow.creditOf(taker), AMOUNT);
    }

    // ---- one blocked address freezes only itself (SC-025) ----

    /// The token blocks `blocked` after the stake is placed; every other address still withdraws all it is owed.
    function _blockAndCheckOthers(address blocked, address[] memory others, uint256[] memory owed) internal {
        token.setBlocked(blocked, true);
        vm.prank(blocked);
        vm.expectRevert(EscrowV2.TransferFailed.selector);
        escrow.withdraw();
        for (uint256 i = 0; i < others.length; i++) {
            assertEq(_withdraw(others[i]), owed[i]);
        }
        // Unblocked, the blocked side's credit was waiting the whole time.
        token.setBlocked(blocked, false);
        assertGt(_withdraw(blocked), 0);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function _one(address a, uint256 x) internal pure returns (address[] memory who, uint256[] memory amounts) {
        who = new address[](1);
        amounts = new uint256[](1);
        who[0] = a;
        amounts[0] = x;
    }

    function test_a_blocked_maker_or_taker_never_stops_the_other_side_of_a_void_or_timeout() public {
        for (uint256 path = 0; path < 3; path++) {
            for (uint256 side = 0; side < 2; side++) {
                setUp();
                uint256 id = _matched(true);
                if (path == 0) {
                    vm.warp(deadline);
                    vm.prank(oracle);
                    escrow.settle(id, EscrowV2.Outcome.Void, EVIDENCE);
                } else if (path == 1) {
                    vm.warp(deadline);
                    vm.prank(oracle);
                    escrow.settle(id, EscrowV2.Outcome.Hit, EVIDENCE);
                    vm.prank(guardian);
                    escrow.voidStake(id, 1, EVIDENCE);
                } else {
                    vm.warp(uint256(deadline) + TIMEOUT);
                    escrow.refund(id);
                }
                (address blocked, address other) = side == 0 ? (maker, taker) : (taker, maker);
                (address[] memory who, uint256[] memory amounts) = _one(other, AMOUNT);
                _blockAndCheckOthers(blocked, who, amounts);
            }
        }
    }

    function test_a_blocked_loser_or_winner_never_stops_the_other_on_a_payout() public {
        // The loser has nothing to take; a blocked winner still leaves the fee recipient free.
        escrow = _deploy(escrow.FEE_CEILING_BPS());
        vm.prank(maker);
        token.approve(address(escrow), type(uint256).max);
        vm.prank(taker);
        token.approve(address(escrow), type(uint256).max);
        uint256 id = _settled(true, EscrowV2.Outcome.Hit);
        vm.warp(vm.getBlockTimestamp() + WINDOW);
        token.setBlocked(taker, true);
        escrow.payout(id);
        uint256 pot = uint256(AMOUNT) * 2;
        uint256 fee = pot / 20;
        assertEq(_withdraw(maker), pot - fee);
        token.setBlocked(taker, false);

        token.setBlocked(maker, true);
        assertEq(_withdraw(feeRecipient), fee);
    }

    function test_a_blocked_fee_recipient_never_stops_the_winner() public {
        escrow = _deploy(escrow.FEE_CEILING_BPS());
        vm.prank(maker);
        token.approve(address(escrow), type(uint256).max);
        vm.prank(taker);
        token.approve(address(escrow), type(uint256).max);
        uint256 id = _settled(true, EscrowV2.Outcome.Hit);
        vm.warp(vm.getBlockTimestamp() + WINDOW);
        escrow.payout(id);
        uint256 pot = uint256(AMOUNT) * 2;
        (address[] memory who, uint256[] memory amounts) = _one(maker, pot - pot / 20);
        _blockAndCheckOthers(feeRecipient, who, amounts);
    }

    function test_a_blocked_maker_of_an_expired_offer_blocks_nobody_else() public {
        uint256 mine = _open(true);
        uint64 validUntil = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory auth = _sign(oracleKey, CLAIM, deadline, validUntil);
        vm.prank(stranger);
        uint256 theirs = escrow.open(CLAIM, deadline, validUntil, auth, true, AMOUNT);
        vm.warp(_offerExpiry(mine));
        escrow.expire(mine);
        escrow.expire(theirs);
        (address[] memory who, uint256[] memory amounts) = _one(stranger, AMOUNT);
        _blockAndCheckOthers(maker, who, amounts);
    }

    function test_the_escrow_itself_blocked_stops_every_withdrawal() public {
        // Disclosed, not solved (FR-036e): nothing the contract does gets money out past a blocked escrow.
        _settled(true, EscrowV2.Outcome.Void);
        token.setBlocked(address(escrow), true);
        for (uint256 i = 0; i < 2; i++) {
            vm.prank([maker, taker][i]);
            vm.expectRevert(EscrowV2.TransferFailed.selector);
            escrow.withdraw();
        }
        // The credits survive the failed attempts, so unblocking releases everything.
        token.setBlocked(address(escrow), false);
        assertEq(_withdraw(maker), AMOUNT);
        assertEq(_withdraw(taker), AMOUNT);
    }

    // ---- token behaviour ----

    function test_a_failed_transfer_reverts_the_whole_move() public {
        address broke = makeAddr("broke");
        uint64 validUntil = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory auth = _sign(oracleKey, CLAIM, deadline, validUntil);
        vm.prank(broke);
        vm.expectRevert(EscrowV2.TransferFailed.selector);
        escrow.open(CLAIM, deadline, validUntil, auth, true, AMOUNT);
        assertEq(escrow.lockedTotal(), 0);
    }

    function test_a_token_that_answers_false_is_refused() public {
        escrow = new EscrowV2(_configFor(address(new FalseTokenV2())));
        uint64 validUntil = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory auth = _sign(oracleKey, CLAIM, deadline, validUntil);
        vm.prank(maker);
        vm.expectRevert(EscrowV2.TransferFailed.selector);
        escrow.open(CLAIM, deadline, validUntil, auth, true, AMOUNT);
    }

    function test_a_token_that_returns_nothing_still_works() public {
        NoReturnTokenV2 quiet = new NoReturnTokenV2();
        escrow = new EscrowV2(_configFor(address(quiet)));
        quiet.mint(maker, AMOUNT);
        uint256 id = _open(true);
        vm.warp(_offerExpiry(id));
        escrow.expire(id);
        vm.prank(maker);
        escrow.withdraw();
        assertEq(quiet.balanceOf(maker), AMOUNT);
    }

    function test_the_signing_domain_follows_the_chain() public {
        bytes32 here = escrow.domainSeparator();
        vm.chainId(1);
        assertTrue(escrow.domainSeparator() != here);
    }

    function _configFor(address stakeToken) internal view returns (EscrowV2.Config memory c) {
        c = _config(0);
        c.token = stakeToken;
    }

    // ---- the guardian ----

    function test_only_the_guardian_pauses() public {
        vm.prank(oracle);
        vm.expectRevert(EscrowV2.NotGuardian.selector);
        escrow.pause();
        vm.prank(maker);
        vm.expectRevert(EscrowV2.NotGuardian.selector);
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
        escrow.settle(toPay, EscrowV2.Outcome.Hit, EVIDENCE);
        vm.warp(vm.getBlockTimestamp() + WINDOW);
        escrow.payout(toPay);
        escrow.expire(offered);
        vm.warp(uint256(deadline) + TIMEOUT);
        escrow.refund(toRefund);
        _withdraw(maker);
        _withdraw(taker);
        assertEq(token.balanceOf(address(escrow)), 0);
    }
}

/// Answers false instead of reverting, as some tokens do.
contract FalseTokenV2 {
    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }
}

/// Returns nothing at all, as some stablecoins do; moves balances and never checks an allowance.
contract NoReturnTokenV2 {
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

/// Random calls by every actor, the operator's keys included. The escrow must always hold exactly what it owes —
/// live stakes plus credits not yet withdrawn — its caps must count exactly the live stakes, and the oracle and
/// the guardian must never end up with a token or a credit (SC-013).
contract EscrowV2OperatorInvariant is Test {
    EscrowV2Handler handler;

    function setUp() public {
        handler = new EscrowV2Handler();
        targetContract(address(handler));
    }

    function invariant_the_escrow_holds_exactly_what_it_owes() public view {
        assertEq(handler.token().balanceOf(address(handler.escrow())), handler.live() + handler.credited());
    }

    function invariant_the_caps_count_exactly_the_live_stakes() public view {
        assertEq(handler.escrow().lockedTotal(), handler.live());
        assertEq(handler.escrow().lockedOnClaim(keccak256("c")), handler.live());
        assertLe(handler.escrow().lockedTotal(), handler.escrow().maxTotal());
    }

    function invariant_the_operator_never_receives_a_token_or_a_credit() public view {
        assertEq(handler.token().balanceOf(handler.oracle()), 0);
        assertEq(handler.token().balanceOf(handler.guardian()), 0);
        assertEq(handler.escrow().creditOf(handler.oracle()), 0);
        assertEq(handler.escrow().creditOf(handler.guardian()), 0);
    }

    function afterInvariant() external view {
        bytes4[7] memory moves = [
            handler.accept.selector,
            handler.settle.selector,
            handler.payout.selector,
            handler.voidStake.selector,
            handler.refund.selector,
            handler.expire.selector,
            handler.withdraw.selector
        ];
        string[7] memory names = ["accept", "settle", "payout", "void", "refund", "expire", "withdraw"];
        for (uint256 i = 0; i < 7; i++) {
            console.log(names[i], handler.succeeded(moves[i]));
        }
    }
}

contract EscrowV2Handler is Test {
    uint256 constant ORACLE_KEY = 0xA11CE;

    TestUsdc public token;
    EscrowV2 public escrow;
    address public oracle;
    address public guardian = makeAddr("guardian");
    address[4] actors;
    uint256[] ids;
    mapping(uint256 => address) makers;
    mapping(bytes4 => uint256) public succeeded;

    constructor() {
        vm.warp(1_800_000_000);
        oracle = vm.addr(ORACLE_KEY);
        token = new TestUsdc();
        escrow = new EscrowV2(
            EscrowV2.Config({
                token: address(token),
                oracle: oracle,
                guardian: guardian,
                feeRecipient: makeAddr("fees"),
                feeBps: 300,
                settlementWindow: 72 hours,
                timeout: 14 days,
                acceptanceCloses: 24 hours,
                offerLifetime: 7 days,
                minStake: 1e6,
                maxStake: 1_000e6,
                maxPerClaim: 10_000e6,
                maxTotal: 50_000e6
            })
        );
        actors = [makeAddr("a"), makeAddr("b"), oracle, guardian];
        for (uint256 i = 0; i < 2; i++) {
            token.mint(actors[i], 100_000_000e6);
            vm.prank(actors[i]);
            token.approve(address(escrow), type(uint256).max);
        }
    }

    function live() external view returns (uint256 total) {
        for (uint256 i = 0; i < ids.length; i++) {
            (,,, uint128 amount,,,,, EscrowV2.State state,) = escrow.stakes(ids[i]);
            if (state == EscrowV2.State.Open) total += amount;
            if (state == EscrowV2.State.Matched || state == EscrowV2.State.Settled) total += uint256(amount) * 2;
        }
    }

    function credited() external view returns (uint256) {
        return escrow.creditOf(actors[0]) + escrow.creditOf(actors[1]) + escrow.creditOf(escrow.feeRecipient());
    }

    function open(uint256 actor, bool side, uint32 inDays, uint128 amount) external {
        uint64 deadline = uint64(vm.getBlockTimestamp() + 2 days + (uint256(inDays) % 14) * 1 days);
        uint64 validUntil = uint64(vm.getBlockTimestamp() + 1 hours);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ORACLE_KEY, escrow.openDigest(keccak256("c"), deadline, validUntil));
        uint128 stake = uint128(bound(amount, 1e6, 1_000e6));
        vm.prank(actors[actor % 2]);
        try escrow.open(keccak256("c"), deadline, validUntil, abi.encodePacked(r, s, v), side, stake) returns (
            uint256 id
        ) {
            ids.push(id);
            makers[id] = actors[actor % 2];
        } catch {}
    }

    function accept(uint256 pick) external {
        if (ids.length == 0) return;
        uint256 recent = ids.length < 3 ? ids.length : 3;
        uint256 id = ids[ids.length - 1 - (pick % recent)];
        vm.prank(makers[id] == actors[0] ? actors[1] : actors[0]);
        try escrow.accept(id) {
            succeeded[this.accept.selector]++;
        } catch {}
    }

    function settle(uint256 actor, uint256 pick, uint8 outcome) external {
        if (ids.length == 0) return;
        uint256 id = _recent(pick);
        (,,,, uint64 deadline,,,,,) = escrow.stakes(id);
        if (vm.getBlockTimestamp() < deadline) vm.warp(deadline);
        vm.prank(actor % 4 == 0 ? actors[actor % 3] : oracle);
        try escrow.settle(id, EscrowV2.Outcome(1 + (outcome % 3)), keccak256("e")) {
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

    function withdraw(uint256 actor) external {
        address who = actor % 5 == 4 ? escrow.feeRecipient() : actors[actor % 4];
        vm.prank(who);
        try escrow.withdraw() {
            succeeded[this.withdraw.selector]++;
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
