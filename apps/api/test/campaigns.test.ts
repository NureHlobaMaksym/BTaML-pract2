import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app";
import { campaignRouter } from "../src/modules/campaigns/campaign-router";
import type { CampaignGateway } from "../src/modules/campaigns/campaign-gateway";
import { request } from "./http";

const campaign = { id: 0, creator: "0x0000000000000000000000000000000000000001", title: "Ідея", goal: "1000000000000000000", raised: "1", state: 0, deadline: 2000000000 };
const service: CampaignGateway = {
  async count() { return 1; },
  async page(offset, limit) { return { items: offset >= 1 ? [] : [campaign].slice(0, limit), total: 1, offset, limit }; },
  async get() { return campaign; },
  async account() { return { contribution: "1", rewardClaimed: false }; }
};
const app = createApp("http://localhost:5173", campaignRouter(service));

describe("REST API", () => {
  it("повертає health", async () => { const res = await request(app, "/api/health"); assert.equal(res.status, 200); assert.equal(res.body.status, "ok"); });
  it("повертає кампанії з пагінацією і сумами без втрати точності", async () => { const res = await request(app, "/api/campaigns"); assert.equal(res.status, 200); assert.equal(res.body.total, 1); assert.deepEqual(res.body.items, [campaign]); });
  it("повертає одну кампанію", async () => { assert.deepEqual((await request(app, "/api/campaigns/0")).body, campaign); });
  it("повертає внесок гаманця", async () => { assert.equal((await request(app, `/api/campaigns/0/contributors/${campaign.creator}`)).body.contribution, "1"); });
  it("повертає 404 для невідомої кампанії", async () => { assert.equal((await request(app, "/api/campaigns/1")).status, 404); });
  it("повертає порожню сторінку за межами списку", async () => { assert.deepEqual((await request(app, "/api/campaigns?offset=10")).body.items, []); });
  for (const query of ["limit=0", "limit=101", "offset=-1", "offset=1.1", "limit=x"]) it(`відмовляє для ${query}`, async () => { assert.equal((await request(app, `/api/campaigns?${query}`)).status, 400); });
  for (const id of ["-1", "1.2", "abc"]) it(`відмовляє для id=${id}`, async () => { assert.equal((await request(app, `/api/campaigns/${id}`)).status, 400); });
  it("перевіряє адресу гаманця", async () => { assert.equal((await request(app, "/api/campaigns/0/contributors/invalid")).status, 400); });
  it("повертає 404 для внеску невідомої кампанії", async () => { assert.equal((await request(app, `/api/campaigns/2/contributors/${campaign.creator}`)).status, 404); });
  it("повертає 404 для невідомого маршруту", async () => { assert.equal((await request(app, "/api/missing")).status, 404); });
});
