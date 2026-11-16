pragma solidity ^0.8.28;

interface IRefundTarget {
    /// @notice Requests repayment of the caller's contribution from a failed campaign.
    /// @param id Failed campaign identifier.
    function refund(uint256 id) external;
}
