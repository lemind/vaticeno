// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface ITransfer {
    function transfer(address to, uint256 value) external returns (bool);
}

/// Throwaway, Nile only (spec 007 T703): what the TVM shows a contract, before EscrowV2 relies on it. Deleted once its
/// answers are in docs/decisions/010-usdt-tron.md.
contract TronProbe {
    /// What `block.chainid` is inside a contract on this network; the EIP-712 domain carries it.
    function chainId() external view returns (uint256) {
        return block.chainid;
    }

    /// Who signed `digest`, as EscrowV2's open checks it: the worker's EIP-712 signature must recover to its oracle.
    function recover(bytes32 digest, uint8 v, bytes32 r, bytes32 s) external pure returns (address) {
        // The raw precompile on purpose: the probe shows exactly what EscrowV2's own ecrecover call sees.
        // forge-lint: disable-next-line(ecrecover)
        return ecrecover(digest, v, r, s);
    }

    /// What `transfer` hands back, raw, for a token this probe holds: Tether's test USDT is sent here first.
    function transferAnswer(address token, address to, uint256 value)
        external
        returns (bool ok, bytes memory returned)
    {
        require(token != address(0) && to != address(0), "zero address");
        (ok, returned) = token.call(abi.encodeCall(ITransfer.transfer, (to, value)));
    }
}
