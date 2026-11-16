import { AbstractProvider, Contract } from "ethers";
import type { Page } from "../../../../../shared/interfaces/page";
import type { Creator } from "../../../../../shared/interfaces/creator";
import type { EventIndexer } from "../events/event-indexer";
import { contractArtifacts } from "../../shared/contract-artifacts";

export class CreatorService {
  private readonly registry: Contract;
  constructor(private readonly indexer: EventIndexer, registryAddress: string, provider: AbstractProvider) {
    this.registry = new Contract(registryAddress, contractArtifacts.registry.abi, provider);
  }
  async list(offset: number, limit: number): Promise<Page<Creator>> {
    await this.indexer.sync();
    return this.indexer.creatorPage(offset, limit);
  }
  async get(address: string) {
    return { address, canCreate: Boolean(await this.registry.isCreator(address)) };
  }
}
