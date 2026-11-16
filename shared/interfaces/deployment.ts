export interface Deployment {
  chainId: number;
  blockNumber: number;
  blockHash: string;
  contracts: { registry: string; token: string; crowdfunding: string };
}
