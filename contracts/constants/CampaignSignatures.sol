pragma solidity ^0.8.28;

library CampaignSignatures {
    string internal constant NAME = "Crowdfunding";
    string internal constant VERSION = "1";
    bytes32 internal constant CREATE_TYPEHASH = keccak256("CreateCampaign(address creator,bytes32 titleHash,uint256 goal,uint64 deadline,uint256 nonce,uint256 expiresAt)");
}
