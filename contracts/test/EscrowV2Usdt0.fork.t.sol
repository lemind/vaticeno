// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {EscrowV2} from "../src/EscrowV2.sol";

interface IErc20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

/// Escrow v2 against Tether's real USDT0 on a fork of Arbitrum One: every way money leaves, paid in that token.
/// Runs only with ARBITRUM_RPC_URL set (forge test --match-contract Usdt0Fork); skipped otherwise, so CI needs no node.
contract EscrowV2Usdt0ForkTest is Test {
    address constant USDT0 = 0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9;
    uint128 constant AMOUNT = 10_000; // 0.01 USDT0, the launch minimum
    bytes32 constant CLAIM = keccak256("claim-usdt0");

    uint256 oracleKey = 0xA11CE;
    address oracle;
    address maker = makeAddr("maker");
    address taker = makeAddr("taker");
    EscrowV2 escrow;
    uint64 deadline;
    bool forked;
    // Foundry's test deployer address holds stray USDT0 on Arbitrum One: the escrow is checked by what changes.
    uint256 escrowBefore;

    function setUp() public {
        string memory rpc = vm.envOr("ARBITRUM_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;
        oracle = vm.addr(oracleKey);
        escrow = new EscrowV2(
            EscrowV2.Config({
                token: USDT0,
                oracle: oracle,
                guardian: makeAddr("guardian"),
                feeRecipient: makeAddr("fees"),
                feeBps: 0,
                settlementWindow: 72 hours,
                timeout: 14 days,
                acceptanceCloses: 24 hours,
                offerLifetime: 7 days,
                minStake: AMOUNT,
                maxStake: 1_000e6,
                maxPerClaim: 10_000e6,
                maxTotal: 50_000e6
            })
        );
        escrowBefore = IErc20(USDT0).balanceOf(address(escrow));
        deadline = uint64(vm.getBlockTimestamp() + 30 days);
        for (uint256 i = 0; i < 2; i++) {
            address who = [maker, taker][i];
            deal(USDT0, who, 1e6);
            vm.prank(who);
            IErc20(USDT0).approve(address(escrow), type(uint256).max);
        }
    }

    function _open() internal returns (uint256) {
        uint64 validUntil = uint64(vm.getBlockTimestamp() + 1 hours);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oracleKey, escrow.openDigest(CLAIM, deadline, validUntil));
        vm.prank(maker);
        return escrow.open(CLAIM, deadline, validUntil, abi.encodePacked(r, s, v), true, AMOUNT);
    }

    function _balance(address who) internal view returns (uint256) {
        return IErc20(USDT0).balanceOf(who);
    }

    function test_a_matched_hit_pays_the_winner_in_usdt0() public {
        if (!forked) return;
        uint256 id = _open();
        vm.prank(taker);
        escrow.accept(id);
        assertEq(_balance(address(escrow)), escrowBefore + 2 * AMOUNT);

        vm.warp(deadline);
        vm.prank(oracle);
        escrow.settle(id, EscrowV2.Outcome.Hit, keccak256("evidence"));
        vm.warp(vm.getBlockTimestamp() + 72 hours);
        escrow.payout(id);

        assertEq(_balance(maker), 1e6 + AMOUNT);
        assertEq(_balance(taker), 1e6 - AMOUNT);
        assertEq(_balance(address(escrow)), escrowBefore);
    }

    function test_a_void_refunds_both_in_usdt0() public {
        if (!forked) return;
        uint256 id = _open();
        vm.prank(taker);
        escrow.accept(id);
        vm.warp(deadline);
        vm.prank(oracle);
        escrow.settle(id, EscrowV2.Outcome.Void, keccak256("evidence"));

        assertEq(_balance(maker), 1e6);
        assertEq(_balance(taker), 1e6);
        assertEq(_balance(address(escrow)), escrowBefore);
    }

    function test_an_untaken_offer_goes_back_in_usdt0() public {
        if (!forked) return;
        uint256 id = _open();
        vm.warp(vm.getBlockTimestamp() + 7 days);
        escrow.expire(id);

        assertEq(_balance(maker), 1e6);
        assertEq(_balance(address(escrow)), escrowBefore);
    }
}
