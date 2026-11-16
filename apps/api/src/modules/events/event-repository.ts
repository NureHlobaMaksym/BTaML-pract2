import { createHash } from "node:crypto";
import { getAddress } from "ethers";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { Deployment } from "../../../../../shared/interfaces/deployment";
import type { IndexedEvent } from "../../../../../shared/interfaces/indexed-event";
import type { IndexCheckpoint } from "../../../../../shared/interfaces/index-checkpoint";
import type { Campaign } from "../../../../../shared/interfaces/campaign";
import type { Creator } from "../../../../../shared/interfaces/creator";
import type { IndexedEventRow } from "./indexed-event-row";
import { CREATOR_ROLE_ID } from "../../../../../shared/constants/role-ids";
import { ACTIVITY_EVENTS } from "../../../../../shared/constants/activity-events";
import { presentActivity } from "./activity-presenter";

export class EventRepository {
  readonly id: string;
  constructor(private readonly pool: Pool, private readonly deployment: Deployment) {
    this.id = createHash("sha256").update(JSON.stringify([deployment.chainId, deployment.blockHash.toLowerCase(), ...Object.values(deployment.contracts).map(address => address.toLowerCase())])).digest("hex");
  }
  async transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [this.id]);
      await client.query("INSERT INTO index_deployments (id, chain_id, deployment_hash, start_block, last_block) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING", [this.id, this.deployment.chainId, this.deployment.blockHash, this.deployment.blockNumber, this.deployment.blockNumber - 1]);
      const result = await action(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  async checkpoint(client?: PoolClient): Promise<IndexCheckpoint> {
    const result = await (client || this.pool).query("SELECT last_block, last_hash FROM index_deployments WHERE id = $1", [this.id]);
    return result.rowCount ? { indexedBlock: Number(result.rows[0].last_block), blockHash: result.rows[0].last_hash } : { indexedBlock: this.deployment.blockNumber - 1, blockHash: "" };
  }
  async reset(client: PoolClient) {
    for (const table of ["indexed_events", "campaigns", "creators"]) await client.query(`DELETE FROM ${table} WHERE deployment_id = $1`, [this.id]);
    await this.setCheckpoint(client, this.deployment.blockNumber - 1, "");
  }
  async setCheckpoint(client: PoolClient, block: number, hash: string) {
    await client.query("UPDATE index_deployments SET last_block = $2, last_hash = $3 WHERE id = $1", [this.id, block, hash]);
  }
  async append(client: PoolClient, event: IndexedEvent) {
    const inserted = await client.query("INSERT INTO indexed_events (deployment_id, id, name, contract_address, block_number, transaction_hash, log_index, timestamp, args) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id", [this.id, event.id, event.name, event.address.toLowerCase(), event.blockNumber, event.transactionHash, event.logIndex, event.timestamp ?? null, event.args]);
    if (!inserted.rowCount) return;
    const args = event.args;
    if (event.address.toLowerCase() === this.deployment.contracts.registry.toLowerCase() && args.role === CREATOR_ROLE_ID) {
      if (event.name === "RoleGranted") await client.query("INSERT INTO creators (deployment_id, address) VALUES ($1,$2) ON CONFLICT DO NOTHING", [this.id, getAddress(args.account).toLowerCase()]);
      if (event.name === "RoleRevoked") await client.query("DELETE FROM creators WHERE deployment_id = $1 AND address = $2", [this.id, getAddress(args.account).toLowerCase()]);
    }
    if (event.address.toLowerCase() !== this.deployment.contracts.crowdfunding.toLowerCase()) return;
    if (event.name === "CampaignCreated") await client.query("INSERT INTO campaigns (deployment_id, campaign_id, creator, title, goal, deadline) VALUES ($1,$2,$3,$4,$5,$6)", [this.id, args.id, getAddress(args.creator), args.title, args.goal, args.deadline]);
    if (event.name === "ContributionReceived") await client.query("UPDATE campaigns SET raised = raised + $3::numeric WHERE deployment_id = $1 AND campaign_id = $2", [this.id, args.id, args.amount]);
    if (event.name === "CampaignFinalized") await client.query("UPDATE campaigns SET state = $3 WHERE deployment_id = $1 AND campaign_id = $2", [this.id, args.id, Number(args.state)]);
    if (event.name === "FundsWithdrawn") await client.query("UPDATE campaigns SET state = 3 WHERE deployment_id = $1 AND campaign_id = $2", [this.id, args.id]);
  }
  private event(row: IndexedEventRow): IndexedEvent {
    return { id: row.id, name: row.name, address: getAddress(row.address), blockNumber: Number(row.blockNumber), transactionHash: row.transactionHash, logIndex: row.logIndex, timestamp: row.timestamp === null ? undefined : Number(row.timestamp), args: row.args };
  }
  private async readPage<Row extends QueryResultRow, Item>(offset: number, limit: number, countSql: string, itemsSql: string, map: (row: Row) => Item, filter: unknown[] = []) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const count = await client.query(countSql, [this.id, ...filter]);
      const rows = await client.query<Row>(itemsSql, [this.id, ...filter, limit, offset]);
      const checkpoint = await this.checkpoint(client);
      await client.query("COMMIT");
      return { checkpoint, items: rows.rows.map(map), total: Number(count.rows[0].total), offset, limit };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  async eventPage(offset: number, limit: number) {
    const page = await this.readPage<IndexedEventRow, IndexedEvent>(offset, limit,
      "SELECT count(*) AS total FROM indexed_events WHERE deployment_id = $1",
      'SELECT id, name, contract_address AS address, block_number AS "blockNumber", transaction_hash AS "transactionHash", log_index AS "logIndex", timestamp, args FROM indexed_events WHERE deployment_id = $1 ORDER BY block_number DESC, log_index DESC LIMIT $2 OFFSET $3', row => this.event(row));
    const { checkpoint, ...items } = page;
    return { ...items, ...checkpoint };
  }
  activityPage(offset: number, limit: number) {
    return this.readPage(offset, limit,
      "SELECT count(*) AS total FROM indexed_events WHERE deployment_id = $1 AND name = ANY($2::text[])",
      'SELECT e.id, e.name, e.contract_address AS address, e.block_number AS "blockNumber", e.transaction_hash AS "transactionHash", e.log_index AS "logIndex", e.timestamp, e.args, c.title AS "campaignTitle" FROM indexed_events e LEFT JOIN campaigns c ON c.deployment_id = e.deployment_id AND c.campaign_id = (e.args->>\'id\')::numeric WHERE e.deployment_id = $1 AND e.name = ANY($2::text[]) ORDER BY e.block_number DESC, e.log_index DESC LIMIT $3 OFFSET $4',
      (row: IndexedEventRow) => presentActivity(this.event(row), row.campaignTitle || "Збір"), [Object.keys(ACTIVITY_EVENTS)]).then(({ checkpoint, ...page }) => page);
  }
  creatorPage(offset: number, limit: number) {
    return this.readPage(offset, limit,
      "SELECT count(*) AS total FROM creators WHERE deployment_id = $1",
      "SELECT address FROM creators WHERE deployment_id = $1 ORDER BY address LIMIT $2 OFFSET $3",
      (row: Creator) => ({ address: getAddress(row.address) })).then(({ checkpoint, ...page }) => page);
  }
  campaignPage(offset: number, limit: number) {
    return this.readPage(offset, limit,
      "SELECT count(*) AS total FROM campaigns WHERE deployment_id = $1",
      'SELECT campaign_id::text AS id, creator, title, goal::text, raised::text, deadline, state FROM campaigns WHERE deployment_id = $1 ORDER BY campaign_id LIMIT $2 OFFSET $3',
      (row: Omit<Campaign, "id" | "deadline"> & { id: string; deadline: string }) => ({ ...row, id: Number(row.id), deadline: Number(row.deadline) })).then(({ checkpoint, ...page }) => page);
  }
}
