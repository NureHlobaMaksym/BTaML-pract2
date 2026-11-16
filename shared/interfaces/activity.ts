export interface Activity {
  id: string;
  title: string;
  campaignTitle: string;
  kind: "launch" | "support" | "success" | "closed" | "refund" | "reward";
  amount?: string;
  currency?: string;
  amountLabel?: string;
  timestamp?: number;
}
