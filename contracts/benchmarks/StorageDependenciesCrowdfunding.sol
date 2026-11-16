pragma solidity ^0.8.28;

import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {CampaignLimits} from "../constants/CampaignLimits.sol";
import {CampaignSignatures} from "../constants/CampaignSignatures.sol";
import {ICreatorRegistry} from "../interfaces/ICreatorRegistry.sol";
import {IRewardToken} from "../interfaces/IRewardToken.sol";

contract StorageDependenciesCrowdfunding is Pausable, ReentrancyGuard, EIP712 {
    enum State { Active, Successful, Failed, Paid }

    struct Campaign {
        address creator;
        uint64 deadline;
        State state;
        uint256 goal;
        uint256 raised;
        string title;
    }

    uint256 public constant MAX_PAGE_SIZE = CampaignLimits.MAX_PAGE_SIZE;
    uint256 public constant MAX_DURATION = CampaignLimits.MAX_DURATION;
    bytes32 public constant CREATE_TYPEHASH = CampaignSignatures.CREATE_TYPEHASH;
    ICreatorRegistry public registry;
    IRewardToken public rewardToken;
    uint256 public campaignCount;
    mapping(uint256 => Campaign) private campaigns;
    mapping(uint256 => mapping(address => uint256)) public contributions;
    mapping(uint256 => mapping(address => bool)) public rewardClaimed;
    mapping(address => uint256) public nonces;

    error InvalidAddress();
    error CreatorRequired();
    error ModeratorRequired();
    error InvalidGoal();
    error InvalidTitle();
    error InvalidDeadline();
    error CampaignNotFound();
    error InvalidPage();
    error CampaignClosed();
    error DeadlineNotReached();
    error WrongState();
    error ZeroContribution();
    error NothingToClaim();
    error NotCampaignCreator();
    error TransferFailed();
    error SignatureExpired();
    error InvalidSignature();

    event CampaignCreated(uint256 indexed id, address indexed creator, uint256 goal, uint64 deadline, string title);
    event ContributionReceived(uint256 indexed id, address indexed contributor, uint256 amount);
    event CampaignFinalized(uint256 indexed id, State state);
    event FundsWithdrawn(uint256 indexed id, address indexed creator, uint256 amount);
    event Refunded(uint256 indexed id, address indexed contributor, uint256 amount);
    event RewardClaimed(uint256 indexed id, address indexed contributor, uint256 amount);
    event NonceUsed(address indexed creator, uint256 nonce);

    constructor(address registryAddress, address tokenAddress) EIP712(CampaignSignatures.NAME, CampaignSignatures.VERSION) {
        if (registryAddress.code.length == 0 || tokenAddress.code.length == 0) revert InvalidAddress();
        registry = ICreatorRegistry(registryAddress);
        rewardToken = IRewardToken(tokenAddress);
    }

    function createCampaign(string calldata title, uint256 goal, uint64 deadline) external whenNotPaused returns (uint256) {
        return _create(msg.sender, title, goal, deadline);
    }

    function createCampaignBySignature(address creator, string calldata title, uint256 goal, uint64 deadline, uint256 expiresAt, bytes calldata signature) external whenNotPaused returns (uint256) {
        if (block.timestamp > expiresAt) revert SignatureExpired();
        uint256 nonce = nonces[creator];
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CREATE_TYPEHASH, creator, keccak256(bytes(title)), goal, deadline, nonce, expiresAt)));
        if (!SignatureChecker.isValidSignatureNow(creator, digest, signature)) revert InvalidSignature();
        nonces[creator] = nonce + 1;
        emit NonceUsed(creator, nonce);
        return _create(creator, title, goal, deadline);
    }

    function contribute(uint256 id) external payable nonReentrant whenNotPaused {
        Campaign storage campaign = _campaign(id);
        if (campaign.state != State.Active || block.timestamp >= campaign.deadline) revert CampaignClosed();
        if (msg.value == 0) revert ZeroContribution();
        contributions[id][msg.sender] += msg.value;
        campaign.raised += msg.value;
        emit ContributionReceived(id, msg.sender, msg.value);
    }

    function finalize(uint256 id) external {
        Campaign storage campaign = _campaign(id);
        if (campaign.state != State.Active) revert WrongState();
        if (block.timestamp < campaign.deadline) revert DeadlineNotReached();
        campaign.state = campaign.raised >= campaign.goal ? State.Successful : State.Failed;
        emit CampaignFinalized(id, campaign.state);
    }

    function withdrawFunds(uint256 id) external nonReentrant {
        Campaign storage campaign = _campaign(id);
        if (msg.sender != campaign.creator) revert NotCampaignCreator();
        if (campaign.state != State.Successful) revert WrongState();
        campaign.state = State.Paid;
        uint256 amount = campaign.raised;
        emit FundsWithdrawn(id, msg.sender, amount);
        (bool sent,) = payable(msg.sender).call{value: amount}("");
        if (!sent) revert TransferFailed();
    }

    function refund(uint256 id) external nonReentrant {
        Campaign storage campaign = _campaign(id);
        if (campaign.state != State.Failed) revert WrongState();
        uint256 amount = contributions[id][msg.sender];
        if (amount == 0) revert NothingToClaim();
        contributions[id][msg.sender] = 0;
        emit Refunded(id, msg.sender, amount);
        (bool sent,) = payable(msg.sender).call{value: amount}("");
        if (!sent) revert TransferFailed();
    }

    function claimReward(uint256 id) external nonReentrant {
        Campaign storage campaign = _campaign(id);
        if (campaign.state != State.Successful && campaign.state != State.Paid) revert WrongState();
        uint256 amount = contributions[id][msg.sender];
        if (amount == 0 || rewardClaimed[id][msg.sender]) revert NothingToClaim();
        rewardClaimed[id][msg.sender] = true;
        emit RewardClaimed(id, msg.sender, amount);
        rewardToken.mint(msg.sender, amount);
    }

    function getCampaign(uint256 id) external view returns (Campaign memory) {
        return _campaign(id);
    }

    function getCampaigns(uint256 offset, uint256 limit) external view returns (Campaign[] memory page) {
        if (limit == 0 || limit > MAX_PAGE_SIZE || offset > campaignCount) revert InvalidPage();
        uint256 size = campaignCount - offset;
        if (size > limit) size = limit;
        page = new Campaign[](size);
        for (uint256 i; i < size; ++i) page[i] = campaigns[offset + i];
    }

    function pause() external {
        if (!registry.isModerator(msg.sender)) revert ModeratorRequired();
        _pause();
    }

    function unpause() external {
        if (!registry.isModerator(msg.sender)) revert ModeratorRequired();
        _unpause();
    }

    function _create(address creator, string calldata title, uint256 goal, uint64 deadline) private returns (uint256 id) {
        if (!registry.isCreator(creator)) revert CreatorRequired();
        if (goal == 0) revert InvalidGoal();
        if (bytes(title).length == 0 || bytes(title).length > CampaignLimits.MAX_TITLE_BYTES) revert InvalidTitle();
        if (deadline <= block.timestamp || deadline > block.timestamp + MAX_DURATION) revert InvalidDeadline();
        id = campaignCount++;
        campaigns[id] = Campaign(creator, deadline, State.Active, goal, 0, title);
        emit CampaignCreated(id, creator, goal, deadline, title);
    }

    function _campaign(uint256 id) private view returns (Campaign storage) {
        if (id >= campaignCount) revert CampaignNotFound();
        return campaigns[id];
    }
}
