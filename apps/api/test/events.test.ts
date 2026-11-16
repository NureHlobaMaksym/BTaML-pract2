import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./database";
import { fixture, as } from "../../../test/helpers";
import { EventIndexer } from "../src/modules/events/event-indexer";
import { CampaignService } from "../src/modules/campaigns/campaign-service";
import type { Deployment } from "../../../shared/interfaces/deployment";

let f: Awaited<ReturnType<typeof fixture>>;
let database: Awaited<ReturnType<typeof testDatabase>>;
let deployment: Deployment;
before(async () => {
  f = await fixture();
  database = await testDatabase();
  const block = (await f.provider.getBlock("latest"))!;
  deployment = { chainId: 31337, blockNumber: block.number, blockHash: block.hash!, contracts: { registry: await f.registry.getAddress(), token: await f.token.getAddress(), crowdfunding: await f.fund.getAddress() } };
});
beforeEach(async () => { await database.reset(); });
after(async () => { f.provider.destroy(); await f.connection.close(); await database.close(); });

describe("Індексатор та читання блокчейну", () => {
  it("індексує події та зберігає їх після перезапуску без дублікатів", async () => {
    const index = new EventIndexer(f.provider, deployment, database.pool);
    await index.initialize();
    await f.create();
    await (await as(f.fund, f.alice).contribute(0, { value: 10n })).wait();
    await Promise.all([index.sync(), index.sync()]);
    const page = await index.page(0, 100);
    assert.ok(page.items.some(event => event.name === "CampaignCreated"));
    assert.ok(page.items.some(event => event.name === "ContributionReceived" && event.args.amount === "10"));
    const restarted = new EventIndexer(f.provider, deployment, database.pool);
    await restarted.initialize();
    assert.deepEqual(await restarted.page(0, 100), page);
    assert.equal(new Set(page.items.map(event => event.id)).size, page.total);
  });
  it("прибирає осиротілі події після реорганізації", async () => {
    const index = new EventIndexer(f.provider, deployment, database.pool);
    const snapshot = await f.connection.provider.request({ method: "evm_snapshot" });
    await f.create(100n, 1000, "Стара гілка");
    await index.initialize();
    assert.ok((await index.page(0, 100)).items.some(event => event.args.title === "Стара гілка"));
    await f.connection.provider.request({ method: "evm_revert", params: [snapshot] });
    await f.create(100n, 2000, "Нова гілка");
    await index.sync();
    assert.equal((await index.page(0, 100)).items.some(event => event.args.title === "Стара гілка"), false);
    assert.ok((await index.page(0, 100)).items.some(event => event.args.title === "Нова гілка"));
  });
  it("серіалізує реальні дані контракту без перетворення wei на number", async () => {
    const index = new EventIndexer(f.provider, deployment, database.pool);
    await index.initialize();
    const service = new CampaignService(await f.fund.getAddress(), f.provider, index);
    assert.equal(await service.count(), 2);
    const campaign = await service.get(0);
    assert.equal(campaign.goal, "100");
    assert.equal((await service.page(0, 1)).items.length, 1);
    assert.equal((await service.account(0, f.alice.address)).contribution, "10");
  });
});

describe("Історія для користувача", () => {
  it("приховує службові події та віддає послідовні сторінки по 20 без загального обмеження 100", async () => {
    for (let i = 0; i < 105; i++) await (await as(f.fund, f.alice).contribute(0, { value: 1n })).wait();
    const index = new EventIndexer(f.provider, deployment, database.pool);
    await index.initialize();
    const first = await index.activityPage(0, 20);
    assert.equal(first.items.length, 20);
    assert.ok(first.total > 100);
    assert.ok(first.items.every(item => item.title === "Збір підтримали" && item.campaignTitle === "Спільна ідея" && item.amount === "1"));
    const collected = [];
    for (let offset = 0; offset < first.total; offset += 20) {
      const page = await index.activityPage(offset, 20);
      assert.equal(page.total, first.total);
      assert.equal(page.offset, offset);
      collected.push(...page.items);
    }
    assert.equal(collected.length, first.total);
    assert.equal(new Set(collected.map(item => item.id)).size, collected.length);
    assert.ok(collected.every(item => !("blockNumber" in item) && !("transactionHash" in item) && !("args" in item)));
    assert.equal((await index.activityPage(first.total, 20)).items.length, 0);
  });
});

describe("Транзакційність PostgreSQL", () => {
  it("повторне застосування міграцій не видаляє дані", async () => {
    const index = new EventIndexer(f.provider, deployment, database.pool);
    await index.initialize();
    const before = await index.page(0, 100);
    const { migrateDatabase } = await import("../src/database/migrate");
    await Promise.all([migrateDatabase(database.pool), migrateDatabase(database.pool)]);
    assert.deepEqual(await index.page(0, 100), before);
  });
  it("два індексатори не дублюють події та суми внесків", async () => {
    const first = new EventIndexer(f.provider, deployment, database.pool);
    const second = new EventIndexer(f.provider, deployment, database.pool);
    await Promise.all([first.initialize(), second.initialize()]);
    const page = await first.page(0, 1000);
    assert.equal(new Set(page.items.map(event => event.id)).size, page.total);
    const campaign = (await first.campaignPage(0, 1)).items[0];
    assert.equal(campaign.raised, (await f.fund.getCampaign(0)).raised.toString());
  });
  it("відкатує події, проєкції та checkpoint при помилці запису", async () => {
    const index = new EventIndexer(f.provider, deployment, database.pool);
    await index.initialize();
    const before = await index.page(0, 1000);
    await f.create(100n, 1000, "Атомарний запис");
    await database.pool.query("CREATE FUNCTION reject_campaign() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$");
    await database.pool.query("CREATE TRIGGER reject_campaign BEFORE INSERT ON campaigns FOR EACH ROW EXECUTE FUNCTION reject_campaign()");
    await assert.rejects(index.sync(), /test failure/);
    assert.deepEqual(await index.page(0, 1000), before);
    await database.pool.query("DROP TRIGGER reject_campaign ON campaigns");
    await index.sync();
    assert.ok((await index.campaignPage(0, 100)).items.some(item => item.title === "Атомарний запис"));
  });
  it("ізолює різні розгортання в одній БД", async () => {
    const first = new EventIndexer(f.provider, deployment, database.pool);
    const other = new EventIndexer(f.provider, { ...deployment, chainId: 11155111 }, database.pool);
    await Promise.all([first.initialize(), other.initialize()]);
    await first.repository.transaction(client => first.repository.reset(client));
    assert.equal((await first.page(0, 20)).total, 0);
    assert.ok((await other.page(0, 20)).total > 0);
  });
  it("повертає порожню SQL-сторінку з правильним total за межами списку", async () => {
    const index = new EventIndexer(f.provider, deployment, database.pool);
    await index.initialize();
    const campaigns = await index.campaignPage(0, 100);
    const beyond = await index.campaignPage(campaigns.total + 10, 20);
    assert.deepEqual(beyond.items, []);
    assert.equal(beyond.total, campaigns.total);
  });
});
