export const ACTIVITY_EVENTS = {
  CampaignCreated: { title: "Відкрито новий збір", kind: "launch" },
  ContributionReceived: { title: "Збір підтримали", kind: "support" },
  CampaignFinalized: { title: "Збір завершено", kind: "closed" },
  FundsWithdrawn: { title: "Кошти передано автору", kind: "success" },
  Refunded: { title: "Внесок повернено", kind: "refund" },
  RewardClaimed: { title: "Винагороду отримано", kind: "reward" }
} as const;
