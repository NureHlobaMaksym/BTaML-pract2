export interface IndexedEvent {
  id: string;
  name: string;
  address: string;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
  timestamp?: number;
  args: Record<string, string>;
}
