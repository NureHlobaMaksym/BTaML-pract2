export const CREATE_CAMPAIGN_TYPES = {
  CreateCampaign: [
    { name: "creator", type: "address" },
    { name: "titleHash", type: "bytes32" },
    { name: "goal", type: "uint256" },
    { name: "deadline", type: "uint64" },
    { name: "nonce", type: "uint256" },
    { name: "expiresAt", type: "uint256" }
  ]
};
