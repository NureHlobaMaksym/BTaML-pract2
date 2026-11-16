pragma solidity ^0.8.28;

library CampaignLimits {
    uint256 internal constant MAX_PAGE_SIZE = 100;
    uint256 internal constant MAX_DURATION = 365 days;
    uint256 internal constant MAX_TITLE_BYTES = 120;
}
