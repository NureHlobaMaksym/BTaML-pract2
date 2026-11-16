import { before, beforeEach, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./database";
import { Router } from "express";
import { ZeroAddress } from "ethers";
import { fixture, as } from "../../../test/helpers";
import { EventIndexer } from "../src/modules/events/event-indexer";
import { CreatorService } from "../src/modules/creators/creator-service";
import { creatorRouter } from "../src/modules/creators/creator-router";
import { createApp } from "../src/app";
import { request } from "./http";

let f: Awaited<ReturnType<typeof fixture>>;
let database: Awaited<ReturnType<typeof testDatabase>>;
let service: CreatorService;
let app: ReturnType<typeof createApp>;
let snapshot: string;
before(async () => {
  f = await fixture();
  database = await testDatabase();
  snapshot = await f.connection.provider.request({ method: "evm_snapshot" }) as string;
});
beforeEach(async () => {
  await database.reset();
  await f.connection.provider.request({ method: "evm_revert", params: [snapshot] });
  snapshot = await f.connection.provider.request({ method: "evm_snapshot" }) as string;
  const block = (await f.provider.getBlock(1))!;
  const registry = await f.registry.getAddress();
  const deployment = { chainId: 31337, blockNumber: 1, blockHash: block.hash!, contracts: { registry, token: await f.token.getAddress(), crowdfunding: await f.fund.getAddress() } };
  const indexer = new EventIndexer(f.provider, deployment, database.pool);
  await indexer.initialize();
  service = new CreatorService(indexer, registry, f.provider);
  app = createApp("http://localhost:5173", Router(), undefined, undefined, undefined, creatorRouter(service));
});
after(async () => { f.provider.destroy(); await f.connection.close(); await database.close(); });

describe("Доступ авторів", () => {
  it("показує вже наданий доступ після повторного читання", async () => {
    const response = await request(app, `/api/creators/${f.creator.address}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.canCreate, true);
    assert.equal((await request(app, `/api/creators/${f.creator.address}`)).body.canCreate, true);
    assert.equal((await request(app, `/api/creators/${f.bob.address}`)).body.canCreate, false);
  });
  it("зберігає декількох авторів та повертає сторінки без службових ролей", async () => {
    await (await as(f.registry, f.moderator).grantRole(await f.registry.CREATOR_ROLE(), f.bob.address)).wait();
    const first = await service.list(0, 1);
    const second = await service.list(1, 1);
    assert.equal(first.total, 2);
    assert.equal(second.total, 2);
    assert.equal(first.items.length, 1);
    assert.equal(second.items.length, 1);
    assert.deepEqual(new Set([...first.items, ...second.items].map(creator => creator.address)), new Set([f.creator.address, f.bob.address]));
    assert.deepEqual((await service.list(2, 20)).items, []);
  });
  it("повторне надання доступу не дублює автора", async () => {
    await (await as(f.registry, f.moderator).grantRole(await f.registry.CREATOR_ROLE(), f.creator.address)).wait();
    const response = await request(app, "/api/creators?offset=0&limit=20");
    assert.equal(response.status, 200);
    assert.equal(response.body.total, 1);
    assert.deepEqual(response.body.items, [{ address: f.creator.address }]);
  });
  it("після відкликання прибирає автора зі списку і показує відсутність доступу", async () => {
    await (await as(f.registry, f.moderator).revokeRole(await f.registry.CREATOR_ROLE(), f.creator.address)).wait();
    assert.equal((await service.list(0, 20)).total, 0);
    assert.equal((await service.get(f.creator.address)).canCreate, false);
  });
  it("враховує самостійну відмову автора від доступу", async () => {
    await (await as(f.registry, f.creator).renounceRole(await f.registry.CREATOR_ROLE(), f.creator.address)).wait();
    assert.equal((await service.list(0, 20)).total, 0);
  });
  it("повертає автора після повторного надання відкликаного доступу", async () => {
    const role = await f.registry.CREATOR_ROLE();
    await (await as(f.registry, f.moderator).revokeRole(role, f.creator.address)).wait();
    await (await as(f.registry, f.moderator).grantRole(role, f.creator.address)).wait();
    assert.deepEqual((await service.list(0, 20)).items, [{ address: f.creator.address }]);
  });
  for (const suffix of ["?offset=-1", "?limit=0", "?limit=101", "/invalid", `/${ZeroAddress}`]) it(`перевіряє параметри ${suffix}`, async () => {
    assert.equal((await request(app, `/api/creators${suffix}`)).status, 400);
  });
});
