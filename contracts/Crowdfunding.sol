pragma solidity ^0.8.28;

import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {CampaignLimits} from "./constants/CampaignLimits.sol";
import {CampaignSignatures} from "./constants/CampaignSignatures.sol";
import {ICreatorRegistry} from "./interfaces/ICreatorRegistry.sol";
import {IRefundTarget} from "./interfaces/IRefundTarget.sol";
import {IRewardToken} from "./interfaces/IRewardToken.sol";

contract Crowdfunding is Pausable, ReentrancyGuard, EIP712, IRefundTarget {
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
    ICreatorRegistry public immutable registry;
    IRewardToken public immutable rewardToken;
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

    /// @notice Connects the creator registry and reward token contracts.
    /// @param registryAddress Deployed registry implementing ICreatorRegistry.
    /// @param tokenAddress Deployed reward token implementing IRewardToken.
    constructor(address registryAddress, address tokenAddress) EIP712(CampaignSignatures.NAME, CampaignSignatures.VERSION) {
        if (registryAddress.code.length == 0 || tokenAddress.code.length == 0) revert InvalidAddress();
        registry = ICreatorRegistry(registryAddress);
        rewardToken = IRewardToken(tokenAddress);
    }

    /// @notice Creates an immutable campaign for an authorized creator while unpaused.
    /// @param title Campaign title containing 1 to 120 UTF-8 bytes.
    /// @param goal Funding target in wei, greater than zero.
    /// @param deadline Future Unix timestamp, at most 365 days away.
    /// @return New campaign identifier, starting at zero.
    function createCampaign(string calldata title, uint256 goal, uint64 deadline) external whenNotPaused returns (uint256) {
        return _create(msg.sender, title, goal, deadline);
    }

    /// @notice Creates a campaign from a single-use EIP-712 authorization; caller pays gas.
    /// @param creator Authorized creator signing the request.
    /// @param title Campaign title bound to the signature by its hash.
    /// @param goal Funding target in wei.
    /// @param deadline Campaign end as a Unix timestamp.
    /// @param expiresAt Last timestamp at which the signature may be submitted.
    /// @param signature EOA or ERC-1271 signature for the current creator nonce.
    /// @return New campaign identifier.
    function createCampaignBySignature(address creator, string calldata title, uint256 goal, uint64 deadline, uint256 expiresAt, bytes calldata signature) external whenNotPaused returns (uint256) {
        if (block.timestamp > expiresAt) revert SignatureExpired();
        uint256 nonce = nonces[creator];
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CREATE_TYPEHASH, creator, keccak256(bytes(title)), goal, deadline, nonce, expiresAt)));
        if (!SignatureChecker.isValidSignatureNow(creator, digest, signature)) revert InvalidSignature();
        nonces[creator] = nonce + 1;
        emit NonceUsed(creator, nonce);
        return _create(creator, title, goal, deadline);
    }

    /// @notice Adds the sent ETH to an active campaign before its deadline while unpaused.
    /// @param id Existing campaign identifier.
    function contribute(uint256 id) external payable nonReentrant whenNotPaused {
        Campaign storage campaign = _campaign(id);
        if (campaign.state != State.Active || block.timestamp >= campaign.deadline) revert CampaignClosed();
        if (msg.value == 0) revert ZeroContribution();
        contributions[id][msg.sender] += msg.value;
        campaign.raised += msg.value;
        emit ContributionReceived(id, msg.sender, msg.value);
    }

    /// @notice Fixes the outcome after the deadline; anyone may call, including while paused.
    /// @param id Active campaign identifier.
    function finalize(uint256 id) external {
        Campaign storage campaign = _campaign(id);
        if (campaign.state != State.Active) revert WrongState();
        if (block.timestamp < campaign.deadline) revert DeadlineNotReached();
        campaign.state = campaign.raised >= campaign.goal ? State.Successful : State.Failed;
        emit CampaignFinalized(id, campaign.state);
    }

    /// @notice Pays the entire successful campaign to its creator exactly once, even while paused.
    /// @dev Applies checks-effects-interactions and a reentrancy guard; failed payments revert all changes.
    /// @param id Successful campaign identifier.
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

    /// @notice Returns the caller's contribution to a failed campaign, even while paused.
    /// @dev Clears the contribution before transferring ETH and prevents reentrancy.
    /// @param id Failed campaign identifier.
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

    /// @notice Mints one CFR base unit per contributed wei after success, once per contributor.
    /// @param id Successful or paid campaign identifier.
    function claimReward(uint256 id) external nonReentrant {
        Campaign storage campaign = _campaign(id);
        if (campaign.state != State.Successful && campaign.state != State.Paid) revert WrongState();
        uint256 amount = contributions[id][msg.sender];
        if (amount == 0 || rewardClaimed[id][msg.sender]) revert NothingToClaim();
        rewardClaimed[id][msg.sender] = true;
        emit RewardClaimed(id, msg.sender, amount);
        rewardToken.mint(msg.sender, amount);
    }

    /// @notice Reads a campaign; reverts if the identifier does not exist.
    /// @param id Campaign identifier.
    /// @return Campaign data including its state and total contributed wei.
    function getCampaign(uint256 id) external view returns (Campaign memory) {
        return _campaign(id);
    }

    /// @notice Reads campaigns in creation order with bounded pagination.
    /// @param offset Number of campaigns to skip; may equal campaignCount.
    /// @param limit Requested page size from 1 through MAX_PAGE_SIZE.
    /// @return page Campaigns remaining in the requested page.
    function getCampaigns(uint256 offset, uint256 limit) external view returns (Campaign[] memory page) {
        if (limit == 0 || limit > MAX_PAGE_SIZE || offset > campaignCount) revert InvalidPage();
        uint256 size = campaignCount - offset;
        if (size > limit) size = limit;
        page = new Campaign[](size);
        for (uint256 i; i < size; ++i) page[i] = campaigns[offset + i];
    }

    /// @notice Allows a moderator to stop campaign creation and contributions; exits remain available.
    function pause() external {
        if (!registry.isModerator(msg.sender)) revert ModeratorRequired();
        _pause();
    }

    /// @notice Allows a moderator to resume campaign creation and contributions.
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
