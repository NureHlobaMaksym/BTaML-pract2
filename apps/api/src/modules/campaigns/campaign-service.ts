import { Contract, AbstractProvider } from "ethers";
import type { Campaign } from "../../../../../shared/interfaces/campaign";
import type { CampaignGateway } from "./campaign-gateway";
import type { EventIndexer } from "../events/event-indexer";
import { contractArtifacts } from "../../shared/contract-artifacts";

export class CampaignService implements CampaignGateway {
  readonly contract: Contract;
  constructor(address: string, provider: AbstractProvider, private readonly indexer: EventIndexer) {
    this.contract = new Contract(address, contractArtifacts.crowdfunding.abi, provider);
  }
  async count() { return Number(await this.contract.campaignCount()); }
  private serialize(id: number, value: { creator: string; deadline: bigint; state: bigint; goal: bigint; raised: bigint; title: string }): Campaign {
    return { id, creator: value.creator, deadline: Number(value.deadline), state: Number(value.state), goal: value.goal.toString(), raised: value.raised.toString(), title: value.title };
  }
  async page(offset: number, limit: number) {
    await this.indexer.sync();
    return this.indexer.campaignPage(offset, limit);
  }
  async get(id: number) { return this.serialize(id, await this.contract.getCampaign(id)); }
  async account(id: number, address: string) {
    const [contribution, rewardClaimed] = await Promise.all([this.contract.contributions(id, address), this.contract.rewardClaimed(id, address)]);
    return { contribution: contribution.toString(), rewardClaimed: Boolean(rewardClaimed) };
  }
}
