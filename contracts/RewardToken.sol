pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {RoleIds} from "./constants/RoleIds.sol";
import {IRewardToken} from "./interfaces/IRewardToken.sol";

contract RewardToken is ERC20, AccessControl, IRewardToken {
    bytes32 public constant MINTER_ROLE = RoleIds.MINTER;
    error InvalidAddress();

    /// @notice Creates the CFR reward token with 18 decimals.
    /// @param admin Account allowed to manage minter permissions.
    constructor(address admin) ERC20("Crowdfund Reward", "CFR") {
        if (admin == address(0)) revert InvalidAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Mints reward units; callable only by an authorized minter.
    /// @param recipient Account receiving the reward.
    /// @param amount Token base units to mint; one unit corresponds to one contributed wei.
    function mint(address recipient, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(recipient, amount);
    }
}
