export interface IndexedEventRow {
  id: string;
  name: string;
  address: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: number;
  timestamp: string | null;
  args: Record<string, string>;
  campaignTitle?: string;
}
