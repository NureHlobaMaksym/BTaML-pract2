import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Wallet, keccak256, toUtf8Bytes } from "ethers";
import { fixture } from "../../../test/helpers";
import { createApp } from "../src/app";
import { Router } from "express";
import { relayRouter } from "../src/modules/relay-router";
import { CREATE_CAMPAIGN_TYPES } from "../../../shared/constants/signature-types";
import { request } from "./http";

let f: Awaited<ReturnType<typeof fixture>>;
let app: ReturnType<typeof createApp>;
let payload: Record<string, unknown>;
before(async () => {
  f = await fixture();
  const relayer = Wallet.createRandom().connect(f.provider);
  await (await f.admin.sendTransaction({ to: relayer.address, value: 10n ** 18n })).wait();
  const address = await f.fund.getAddress();
  app = createApp("http://localhost:5173", Router(), undefined, relayRouter(f.provider, address, relayer.privateKey));
  const deadline = await f.now() + 5000;
  const expiresAt = await f.now() + 1000;
  const signature = await f.creator.signTypedData({ name: "Crowdfunding", version: "1", chainId: 31337, verifyingContract: address }, CREATE_CAMPAIGN_TYPES, { creator: f.creator.address, titleHash: keccak256(toUtf8Bytes("Ідея")), goal: 100n, deadline, nonce: 0, expiresAt });
  payload = { creator: f.creator.address, title: "Ідея", goal: "100", deadline, expiresAt, signature };
});
after(async () => { f.provider.destroy(); await f.connection.close(); });

describe("Релеєр", () => {
  it("відмовляє без налаштованого гаманця", async () => {
    const disabled = createApp("http://localhost:5173", Router(), undefined, relayRouter(f.provider, await f.fund.getAddress()));
    assert.equal((await request(disabled, "/api/relay/campaigns", "POST", JSON.stringify(payload))).status, 503);
  });
  it("перевіряє схему запиту", async () => { assert.equal((await request(app, "/api/relay/campaigns", "POST", JSON.stringify({ ...payload, goal: "-1" }))).status, 400); });
  it("відхиляє зламаний JSON", async () => { assert.equal((await request(app, "/api/relay/campaigns", "POST", "{")).status, 400); });
  it("оплачує газ і створює кампанію від імені підписанта", async () => {
    const balance = await f.provider.getBalance(f.creator.address);
    const res = await request(app, "/api/relay/campaigns", "POST", JSON.stringify(payload));
    assert.equal(res.status, 202);
    const receipt = await f.provider.getTransactionReceipt(String(res.body.transactionHash));
    assert.equal(receipt?.status, 1);
    assert.equal((await f.fund.getCampaign(0)).creator, f.creator.address);
    assert.equal(await f.provider.getBalance(f.creator.address), balance);
  });
  it("обмежує частоту запитів", async () => { assert.equal((await request(app, "/api/relay/campaigns", "POST", JSON.stringify(payload))).status, 429); });
});
