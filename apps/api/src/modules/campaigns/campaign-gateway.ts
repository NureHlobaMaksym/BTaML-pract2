import type { Page } from "../../../../../shared/interfaces/page";
import type { Campaign } from "../../../../../shared/interfaces/campaign";

export interface CampaignGateway {
  count(): Promise<number>;
  page(offset: number, limit: number): Promise<Page<Campaign>>;
  get(id: number): Promise<Campaign>;
  account(id: number, address: string): Promise<{ contribution: string; rewardClaimed: boolean }>;
}
