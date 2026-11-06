// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// A USDC stand-in for v2's testnets (003 T379, docs/decisions/007-escrow-v2.md): 6 decimals, mintable by its
/// deployer, and able to block an address the way Circle's USDC can, so the tests prove one blocked side never
/// freezes the other (SC-025). Worth nothing: anyone the deployer mints for gets it for free.
contract TestUsdc {
    string public constant name = "Vaticeno Test USDC";
    string public constant symbol = "tUSDC";
    uint8 public constant decimals = 6;

    address public immutable minter;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public isBlocked;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Blocked(address indexed account, bool blocked);

    constructor() {
        minter = msg.sender;
    }

    function mint(address to, uint256 value) external {
        require(msg.sender == minter, "not minter");
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    /// Like USDC's blocklist: a blocked address can neither send nor receive.
    function setBlocked(address account, bool blocked) external {
        require(msg.sender == minter, "not minter");
        isBlocked[account] = blocked;
        emit Blocked(account, blocked);
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _move(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= value, "allowance");
            allowance[from][msg.sender] = allowed - value;
        }
        _move(from, to, value);
        return true;
    }

    function _move(address from, address to, uint256 value) private {
        require(to != address(0), "zero address");
        require(!isBlocked[from] && !isBlocked[to], "blocked");
        require(balanceOf[from] >= value, "balance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
