// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Escrow} from "../src/Escrow.sol";
import {TestToken} from "../src/TestToken.sol";

/// Deploys the test token and the escrow (003 T330). The numbers are docs/decisions/002-escrow-v1.md's;
/// `runEndToEnd` is the throwaway deployment for T337, with the same rules in minutes.
///
///   forge script script/Deploy.s.sol --rpc-url base_sepolia --account <keystore> --broadcast --verify
///
/// The deployer key lives in Foundry's encrypted keystore (`cast wallet import`), never in an env var.
contract Deploy is Script {
    function run() external returns (TestToken token, Escrow escrow) {
        return _deploy(72 hours, 14 days, 24 hours, 7 days);
    }

    function runEndToEnd() external returns (TestToken token, Escrow escrow) {
        return _deploy(10 minutes, 30 minutes, 2 minutes, 5 minutes);
    }

    function _deploy(uint64 window, uint64 timeout, uint64 acceptanceCloses, uint64 offerLifetime)
        private
        returns (TestToken token, Escrow escrow)
    {
        require(block.chainid == 84_532, "Base Sepolia only (002-escrow-v1)");
        address oracle = vm.envAddress("ORACLE_ADDRESS");
        address guardian = vm.envAddress("GUARDIAN_ADDRESS");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT_ADDRESS");

        vm.startBroadcast();
        token = new TestToken();
        escrow = new Escrow(
            Escrow.Config({
                token: address(token),
                oracle: oracle,
                guardian: guardian,
                feeRecipient: feeRecipient,
                feeBps: 0,
                settlementWindow: window,
                timeout: timeout,
                acceptanceCloses: acceptanceCloses,
                offerLifetime: offerLifetime,
                maxStake: 100e18
            })
        );
        vm.stopBroadcast();

        console.log("STAKE_TOKEN_ADDRESS=%s", address(token));
        console.log("ESCROW_ADDRESS=%s", address(escrow));
    }
}
