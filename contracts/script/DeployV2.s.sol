// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {EscrowV2} from "../src/EscrowV2.sol";
import {TestUsdc} from "../src/TestUsdc.sol";

/// Deploys escrow v2 with docs/decisions/007-escrow-v2.md's numbers (003 T379, T383).
///
///   scripts/deploy-v2.sh 84532|421614 [end-to-end]   a testnet, with a test USDC that can block an address
///   scripts/deploy-v2.sh 8453|42161                  a mainnet, in Circle's native USDC
///   scripts/deploy-v2.sh 42161-usdt                  Arbitrum One in Tether's USDT0, its own contract
///
/// Keys arrive as DEPLOYER_PRIVATE_KEY, never on the command line, where `ps` would show it.
contract DeployV2 is Script {
    uint128 private constant USDC = 1e6;
    address private constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address private constant ARBITRUM_USDC = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;
    address private constant ARBITRUM_USDT0 = 0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9;

    function run() external returns (EscrowV2 escrow) {
        return _deploy(_testToken(), 72 hours, 14 days, 24 hours, 7 days);
    }

    /// T373's throwaway deployment: the same rules in minutes.
    function runEndToEnd() external returns (EscrowV2 escrow) {
        return _deploy(_testToken(), 10 minutes, 30 minutes, 2 minutes, 5 minutes);
    }

    /// Real money. The contract itself also refuses any token but native USDC on these chains.
    function runMainnet() external returns (EscrowV2 escrow) {
        address usdc = block.chainid == 8453 ? BASE_USDC : block.chainid == 42_161 ? ARBITRUM_USDC : address(0);
        require(usdc != address(0), "Base or Arbitrum One only");
        return _deploy(usdc, 72 hours, 14 days, 24 hours, 7 days);
    }

    /// Real money in Tether's USDT0, Arbitrum One only: its own contract and its own offers, apart from USDC's.
    function runMainnetUsdt0() external returns (EscrowV2 escrow) {
        require(block.chainid == 42_161, "Arbitrum One only");
        return _deploy(ARBITRUM_USDT0, 72 hours, 14 days, 24 hours, 7 days);
    }

    function _testToken() private returns (address) {
        require(block.chainid == 84_532 || block.chainid == 421_614, "Base Sepolia or Arbitrum Sepolia only");
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        TestUsdc token = new TestUsdc();
        vm.stopBroadcast();
        return address(token);
    }

    function _deploy(address token, uint64 window, uint64 timeout, uint64 acceptanceCloses, uint64 offerLifetime)
        private
        returns (EscrowV2 escrow)
    {
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        escrow = new EscrowV2(
            EscrowV2.Config({
                token: token,
                oracle: vm.envAddress("ORACLE_ADDRESS"),
                guardian: vm.envAddress("GUARDIAN_ADDRESS"),
                feeRecipient: vm.envAddress("FEE_RECIPIENT_ADDRESS"),
                feeBps: 0,
                settlementWindow: window,
                timeout: timeout,
                acceptanceCloses: acceptanceCloses,
                offerLifetime: offerLifetime,
                minStake: USDC / 100, // 0.01 USDC (owner, 2026-11-01): gas on Base costs far less (007-escrow-v2)
                maxStake: 1_000 * USDC,
                maxPerClaim: 10_000 * USDC,
                maxTotal: 50_000 * USDC
            })
        );
        vm.stopBroadcast();

        console.log("WAGER_NETWORKS entry: %s:2:%s:%s", block.chainid, address(escrow), token);
    }
}
