pragma solidity ^0.8.28;

interface IRewardToken {
    /// @notice Mints reward units; callable only by an authorized minter.
    /// @param recipient Account receiving the reward.
    /// @param amount Token base units to mint; one unit corresponds to one contributed wei.
    function mint(address recipient, uint256 amount) external;
}
