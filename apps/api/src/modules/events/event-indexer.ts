import { Interface, AbstractProvider } from "ethers";
import type { Pool } from "pg";
import type { Deployment } from "../../../../../shared/interfaces/deployment";
import type { IndexedEvent } from "../../../../../shared/interfaces/indexed-event";
import { contractArtifacts } from "../../shared/contract-artifacts";
import { EventRepository } from "./event-repository";
import { INDEX_BLOCK_BATCH_SIZE, INDEX_TIMESTAMP_CONCURRENCY } from "../../../../../shared/constants/indexing-limits";

export class EventIndexer {
  readonly repository: EventRepository;
  private pending?: Promise<void>;
  private readonly interfaces = Object.values(contractArtifacts).map(item => new Interface(item.abi));
  constructor(private readonly provider: AbstractProvider, private readonly deployment: Deployment, pool: Pool) {
    this.repository = new EventRepository(pool, deployment);
  }
  async initialize() { await this.sync(); }
  sync(): Promise<void> {
    if (!this.pending) this.pending = this.update().finally(() => { this.pending = undefined; });
    return this.pending;
  }
  private async update() {
    const head = await this.provider.getBlock("latest");
    if (!head) throw new Error("RPC не повернув останній блок");
    let more = true;
    while (more) more = await this.repository.transaction(async client => {
      let checkpoint = await this.repository.checkpoint(client);
      if (checkpoint.blockHash && (await this.provider.getBlock(checkpoint.indexedBlock))?.hash !== checkpoint.blockHash) {
        await this.repository.reset(client);
        checkpoint = await this.repository.checkpoint(client);
      }
      const from = checkpoint.indexedBlock + 1;
      if (from > head.number) return false;
      const to = Math.min(from + INDEX_BLOCK_BATCH_SIZE - 1, head.number);
      const end = await this.provider.getBlock(to);
      if (!end?.hash) throw new Error("RPC не повернув блок індексації");
      const logs = await this.provider.getLogs({ address: Object.values(this.deployment.contracts), fromBlock: from, toBlock: to });
      const timestamps = new Map<number, number>([[to, end.timestamp]]);
      const blocks = [...new Set(logs.map(log => log.blockNumber))].filter(block => block !== to);
      for (let offset = 0; offset < blocks.length; offset += INDEX_TIMESTAMP_CONCURRENCY) {
        await Promise.all(blocks.slice(offset, offset + INDEX_TIMESTAMP_CONCURRENCY).map(async number => {
          const block = await this.provider.getBlock(number);
          if (!block) throw new Error("RPC не повернув блок події");
          timestamps.set(number, block.timestamp);
        }));
      }
      for (const log of logs) {
        for (const abi of this.interfaces) {
          let parsed;
          try { parsed = abi.parseLog(log); } catch { continue; }
          if (!parsed) continue;
          const args: Record<string, string> = {};
          parsed.fragment.inputs.forEach((input, i) => { args[input.name] = String(parsed.args[i]); });
          const event: IndexedEvent = { timestamp: timestamps.get(log.blockNumber), id: `${log.transactionHash}:${log.index}`, name: parsed.name, address: log.address, blockNumber: log.blockNumber, transactionHash: log.transactionHash, logIndex: log.index, args };
          await this.repository.append(client, event);
          break;
        }
      }
      if ((await this.provider.getBlock(to))?.hash !== end.hash) throw new Error("Мережа реорганізувалася; індексацію буде повторено");
      await this.repository.setCheckpoint(client, to, end.hash);
      return to < head.number;
    });
  }
  page(offset: number, limit: number) { return this.repository.eventPage(offset, limit); }
  activityPage(offset: number, limit: number) { return this.repository.activityPage(offset, limit); }
  creatorPage(offset: number, limit: number) { return this.repository.creatorPage(offset, limit); }
  campaignPage(offset: number, limit: number) { return this.repository.campaignPage(offset, limit); }
  checkpoint() { return this.repository.checkpoint(); }
}
