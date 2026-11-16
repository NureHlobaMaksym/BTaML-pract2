pragma solidity ^0.8.28;

library RoleIds {
    bytes32 internal constant MODERATOR = keccak256("MODERATOR_ROLE");
    bytes32 internal constant CREATOR = keccak256("CREATOR_ROLE");
    bytes32 internal constant MINTER = keccak256("MINTER_ROLE");
}
