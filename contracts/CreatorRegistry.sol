pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {RoleIds} from "./constants/RoleIds.sol";
import {ICreatorRegistry} from "./interfaces/ICreatorRegistry.sol";

contract CreatorRegistry is AccessControl, ICreatorRegistry {
    bytes32 public constant MODERATOR_ROLE = RoleIds.MODERATOR;
    bytes32 public constant CREATOR_ROLE = RoleIds.CREATOR;

    error InvalidAddress();

    /// @notice Initializes the administrator and moderator; neither may be the zero address.
    /// @param admin Account managing administrator and moderator roles.
    /// @param moderator Account managing creator permissions.
    constructor(address admin, address moderator) {
        if (admin == address(0) || moderator == address(0)) revert InvalidAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MODERATOR_ROLE, moderator);
        _setRoleAdmin(CREATOR_ROLE, MODERATOR_ROLE);
    }

    /// @notice Checks whether an account may create new campaigns.
    /// @param account Account to check.
    /// @return True when the creator role is currently granted.
    function isCreator(address account) external view returns (bool) {
        return hasRole(CREATOR_ROLE, account);
    }

    /// @notice Checks whether an account may manage creators and pause campaigns.
    /// @param account Account to check.
    /// @return True when the moderator role is currently granted.
    function isModerator(address account) external view returns (bool) {
        return hasRole(MODERATOR_ROLE, account);
    }
}
