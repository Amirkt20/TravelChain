// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title RewardToken (TravelChain)
 * @notice ERC20 token "TravelShareToken" (TRVL) rewarded to travelers for sharing documents.
 *
 * WHAT CHANGED vs the old EduChain version:
 *  - Renamed EduShareToken/EDUSHARE -> TravelShareToken/TRVL
 *  - Added a MAX_SUPPLY cap so a bug or compromised minter can't print unlimited tokens.
 *
 * All the standard ERC20 stuff (transfer, balanceOf, approve...) comes from OpenZeppelin.
 * AccessControl gives us roles: only addresses with MINTER_ROLE (the DataSharing contract)
 * can create new tokens.
 */
contract RewardToken is ERC20, AccessControl {
    // A role is just a bytes32 label. keccak256 makes it a unique id.
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // 1 million tokens (with 18 decimals)
    uint256 public constant MAX_SUPPLY = 1_000_000 * 10 ** 18;

    error MaxSupplyExceeded();

    /// @dev The deployer becomes admin, meaning they can grant MINTER_ROLE to DataSharing.
    constructor() ERC20("TravelShareToken", "TRVL") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /// @notice Create new tokens. Only callable by MINTER_ROLE holders.
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        if (totalSupply() + amount > MAX_SUPPLY) revert MaxSupplyExceeded();
        _mint(to, amount); // OpenZeppelin already emits a Transfer(0x0 -> to) event
    }
}
