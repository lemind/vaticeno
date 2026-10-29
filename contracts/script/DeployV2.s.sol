// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {EscrowV2} from "../src/EscrowV2.sol";
import {TestUsdc} from "../src/TestUsdc.sol";

/// Deploys escrow v2 with a test USDC that can block an address, on a testnet only (003 T379). The numbers are
/// docs/decisions/007-escrow-v2.md's; `runEndToEnd` is the throwaway deployment for T373, the rules in minutes.
///
///   scripts/deploy-v2-testnet.sh 84532|421614 [end-to-end]
///
/// The deployer key arrives as DEPLOYER_PRIVATE_KEY, never on the command line, where `ps` would show it.
contract DeployV2 is Script {
    uint128 private constant USDC = 1e6;

    function run() external returns (TestUsdc token, EscrowV2 escrow) {
        return _deploy(72 hours, 14 days, 24 hours, 7 days);
    }

    function runEndToEnd() external returns (TestUsdc token, EscrowV2 escrow) {
        return _deploy(10 minutes, 30 minutes, 2 minutes, 5 minutes);
    }

    function _deploy(uint64 window, uint64 timeout, uint64 acceptanceCloses, uint64 offerLifetime)
        private
        returns (TestUsdc token, EscrowV2 escrow)
    {
        // Mainnets get the reviewed commit and real USDC (T383), never this script.
        require(block.chainid == 84_532 || block.chainid == 421_614, "Base Sepolia or Arbitrum Sepolia only");
        address oracle = vm.envAddress("ORACLE_ADDRESS");
        address guardian = vm.envAddress("GUARDIAN_ADDRESS");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT_ADDRESS");

        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        token = new TestUsdc();
        escrow = new EscrowV2(
            EscrowV2.Config({
                token: address(token),
                oracle: oracle,
                guardian: guardian,
                feeRecipient: feeRecipient,
                feeBps: 0,
                settlementWindow: window,
                timeout: timeout,
                acceptanceCloses: acceptanceCloses,
                offerLifetime: offerLifetime,
                minStake: 1 * USDC,
                maxStake: 1_000 * USDC,
                maxPerClaim: 10_000 * USDC,
                maxTotal: 50_000 * USDC
            })
        );
        vm.stopBroadcast();

        console.log("WAGER_NETWORKS entry: %s:2:%s:%s", block.chainid, address(escrow), address(token));
    }
}
