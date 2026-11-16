pragma solidity ^0.8.28;

interface ICreatorRegistry {
    /// @notice Checks whether an account may create new campaigns.
    /// @param account Account to check.
    /// @return True when the creator role is currently granted.
    function isCreator(address account) external view returns (bool);
    /// @notice Checks whether an account may manage creators and pause campaigns.
    /// @param account Account to check.
    /// @return True when the moderator role is currently granted.
    function isModerator(address account) external view returns (bool);
}
