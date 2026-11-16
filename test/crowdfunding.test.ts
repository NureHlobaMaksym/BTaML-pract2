import { before, after, beforeEach, describe, it } from "./test-runner";
import assert from "node:assert/strict";
import { keccak256, toUtf8Bytes, ZeroAddress } from "ethers";
import { fixture, as, rejects, event } from "./helpers";
import { saveGas } from "./gas";
import { CREATE_CAMPAIGN_TYPES } from "../shared/constants/signature-types";

let f: Awaited<ReturnType<typeof fixture>>;
let snapshot: string;
before(async () => { f = await fixture(); snapshot = await f.connection.provider.request({ method: "evm_snapshot" }) as string; });
beforeEach(async () => {
  await f.connection.provider.request({ method: "evm_revert", params: [snapshot] });
  snapshot = await f.connection.provider.request({ method: "evm_snapshot" }) as string;
});
after(async () => { if (process.env.GAS === "true") saveGas(); f.provider.destroy(); await f.connection.close(); });

async function successful() {
  const campaign = await f.create();
  await (await as(f.fund, f.alice).contribute(campaign.id, { value: 100n })).wait();
  await f.advance(campaign.deadline);
  await (await f.fund.finalize(campaign.id)).wait();
  return campaign;
}
async function failed() {
  const campaign = await f.create();
  await (await as(f.fund, f.alice).contribute(campaign.id, { value: 40n })).wait();
  await f.advance(campaign.deadline);
  await (await f.fund.finalize(campaign.id)).wait();
  return campaign;
}
async function signature(overrides: Record<string, unknown> = {}, domainOverrides: Record<string, unknown> = {}) {
  const payload = { creator: f.creator.address, titleHash: keccak256(toUtf8Bytes("Підписана ідея")), goal: 100n, deadline: await f.now() + 5000, nonce: await f.fund.nonces(f.creator.address), expiresAt: await f.now() + 1000, ...overrides };
  const signed = await f.creator.signTypedData({ name: "Crowdfunding", version: "1", chainId: 31337, verifyingContract: await f.fund.getAddress(), ...domainOverrides }, CREATE_CAMPAIGN_TYPES, payload);
  return { payload, args: [payload.creator, "Підписана ідея", payload.goal, payload.deadline, payload.expiresAt, signed] };
}

describe("Ролі та ERC-20", () => {
  it("призначає адміністратора, модератора та автора", async () => {
    assert.equal(await f.registry.hasRole(await f.registry.DEFAULT_ADMIN_ROLE(), f.admin.address), true);
    assert.equal(await f.registry.isModerator(f.moderator.address), true);
    assert.equal(await f.registry.isCreator(f.creator.address), true);
    assert.equal(await f.registry.isCreator(f.bob.address), false);
    assert.equal(await f.registry.isModerator(f.bob.address), false);
  });
  it("забороняє нульового адміністратора реєстру", async () => { await assert.rejects(f.deploy("CreatorRegistry", [ZeroAddress, f.moderator.address])); });
  it("забороняє нульового модератора", async () => { await assert.rejects(f.deploy("CreatorRegistry", [f.admin.address, ZeroAddress])); });
  it("забороняє нульового адміністратора токена", async () => { await assert.rejects(f.deploy("RewardToken", [ZeroAddress])); });
  it("забороняє неконтрактні залежності", async () => { await assert.rejects(f.deploy("Crowdfunding", [f.admin.address, await f.token.getAddress()])); });
  it("забороняє неконтрактний токен", async () => { await assert.rejects(f.deploy("Crowdfunding", [await f.registry.getAddress(), f.admin.address])); });
  it("лише модератор надає роль автора", async () => { await rejects(as(f.registry, f.bob).grantRole(await f.registry.CREATOR_ROLE(), f.bob.address), f.registry, "AccessControlUnauthorizedAccount"); });
  it("модератор відкликає роль автора з подією", async () => {
    await event(as(f.registry, f.moderator).revokeRole(await f.registry.CREATOR_ROLE(), f.creator.address), f.registry, "RoleRevoked");
    assert.equal(await f.registry.isCreator(f.creator.address), false);
  });
  it("стороння адреса не карбує токени", async () => { await rejects(as(f.token, f.alice).mint(f.alice.address, 1n), f.token, "AccessControlUnauthorizedAccount"); });
  it("ERC-20 передає винагороду іншому користувачу", async () => {
    const { id } = await successful();
    await (await as(f.fund, f.alice).claimReward(id)).wait();
    await event(as(f.token, f.alice).transfer(f.bob.address, 40n), f.token, "Transfer");
    assert.equal(await f.token.balanceOf(f.bob.address), 40n);
    assert.equal(await f.token.totalSupply(), 100n);
  });
});

describe("Створення та читання", () => {
  it("створює кампанію з правильними даними та подією", async () => {
    const deadline = await f.now() + 1000;
    const created = await event(as(f.fund, f.creator).createCampaign("Ідея", 100n, deadline), f.fund, "CampaignCreated");
    assert.equal(created.args.creator, f.creator.address);
    const campaign = await f.fund.getCampaign(0);
    assert.equal(campaign.creator, f.creator.address);
    assert.equal(campaign.goal, 100n);
    assert.equal(campaign.deadline, BigInt(deadline));
    assert.equal(campaign.title, "Ідея");
    assert.equal(campaign.state, 0n);
  });
  it("неавтор не створює кампанію", async () => { await rejects(as(f.fund, f.bob).createCampaign("Ідея", 100n, await f.now() + 1000), f.fund, "CreatorRequired"); });
  it("ціль не може бути нульовою", async () => { await rejects(as(f.fund, f.creator).createCampaign("Ідея", 0n, await f.now() + 1000), f.fund, "InvalidGoal"); });
  it("назва не може бути порожньою", async () => { await rejects(as(f.fund, f.creator).createCampaign("", 100n, await f.now() + 1000), f.fund, "InvalidTitle"); });
  it("назва не може перевищувати 120 байтів", async () => { await rejects(as(f.fund, f.creator).createCampaign("я".repeat(61), 100n, await f.now() + 1000), f.fund, "InvalidTitle"); });
  it("допускає рівно 120 байтів назви", async () => { await f.create(100n, 1000, "a".repeat(120)); assert.equal((await f.fund.getCampaign(0)).title.length, 120); });
  it("забороняє минулий дедлайн", async () => { await rejects(as(f.fund, f.creator).createCampaign("Ідея", 100n, await f.now()), f.fund, "InvalidDeadline"); });
  it("забороняє термін понад рік", async () => { await rejects(as(f.fund, f.creator).createCampaign("Ідея", 100n, await f.now() + 365 * 86400 + 10), f.fund, "InvalidDeadline"); });
  it("допускає річний термін", async () => { await f.create(100n, 365 * 86400); assert.equal(await f.fund.campaignCount(), 1n); });
  it("відмовляє для невідомої кампанії", async () => { await rejects(f.fund.getCampaign(0), f.fund, "CampaignNotFound"); });
  it("повертає порожню сторінку для порожнього реєстру", async () => { assert.equal((await f.fund.getCampaigns(0, 10)).length, 0); });
  it("повертає сторінку з обмеженою кількістю записів", async () => { await f.create(); await f.create(); assert.equal((await f.fund.getCampaigns(0, 1)).length, 1); });
  it("обрізає останню сторінку та допускає offset=count", async () => { await f.create(); assert.equal((await f.fund.getCampaigns(0, 100)).length, 1); assert.equal((await f.fund.getCampaigns(1, 10)).length, 0); });
  for (const [offset, limit] of [[0, 0], [0, 101], [1, 10]]) it(`відмовляє для некоректної сторінки ${offset}/${limit}`, async () => { await rejects(f.fund.getCampaigns(offset, limit), f.fund, "InvalidPage"); });
});

describe("Внески, час та пауза", () => {
  it("накопичує повторні внески та генерує події", async () => {
    await f.create();
    await event(as(f.fund, f.alice).contribute(0, { value: 30n }), f.fund, "ContributionReceived");
    await (await as(f.fund, f.alice).contribute(0, { value: 20n })).wait();
    assert.equal(await f.fund.contributions(0, f.alice.address), 50n);
    assert.equal((await f.fund.getCampaign(0)).raised, 50n);
  });
  it("відмовляє для нульового внеску", async () => { await f.create(); await rejects(as(f.fund, f.alice).contribute(0), f.fund, "ZeroContribution"); });
  it("приймає внесок за секунду до дедлайну", async () => {
    const { deadline } = await f.create();
    await f.connection.provider.request({ method: "evm_setNextBlockTimestamp", params: [deadline - 1] });
    await (await as(f.fund, f.alice).contribute(0, { value: 1n })).wait();
    assert.equal(await f.fund.contributions(0, f.alice.address), 1n);
  });
  it("відхиляє внесок рівно в дедлайн", async () => { const { deadline } = await f.create(); await f.advance(deadline); await rejects(as(f.fund, f.alice).contribute(0, { value: 1n }), f.fund, "CampaignClosed"); });
  it("відхиляє внесок після дедлайну", async () => { const { deadline } = await f.create(); await f.advance(deadline + 1); await rejects(as(f.fund, f.alice).contribute(0, { value: 1n }), f.fund, "CampaignClosed"); });
  it("відхиляє внесок у завершену кампанію", async () => { await failed(); await rejects(as(f.fund, f.alice).contribute(0, { value: 1n }), f.fund, "CampaignClosed"); });
  it("не завершує збір перед дедлайном", async () => { await f.create(); await rejects(f.fund.finalize(0), f.fund, "DeadlineNotReached"); });
  it("фіксує успіх рівно при досягненні цілі", async () => { const { id } = await successful(); assert.equal((await f.fund.getCampaign(id)).state, 1n); });
  it("фіксує провал і генерує подію", async () => { const { deadline } = await f.create(); await f.advance(deadline); await event(f.fund.finalize(0), f.fund, "CampaignFinalized"); assert.equal((await f.fund.getCampaign(0)).state, 2n); });
  it("не завершує кампанію двічі", async () => { await failed(); await rejects(f.fund.finalize(0), f.fund, "WrongState"); });
  it("лише модератор може зупинити платформу", async () => { await rejects(as(f.fund, f.bob).pause(), f.fund, "ModeratorRequired"); });
  it("лише модератор може відновити платформу", async () => { await rejects(as(f.fund, f.bob).unpause(), f.fund, "ModeratorRequired"); });
  it("пауза блокує внески та створення; відновлення повертає доступ", async () => {
    await f.create();
    await event(as(f.fund, f.moderator).pause(), f.fund, "Paused");
    await rejects(as(f.fund, f.alice).contribute(0, { value: 1n }), f.fund, "EnforcedPause");
    await rejects(as(f.fund, f.creator).createCampaign("Ідея", 100n, await f.now() + 1000), f.fund, "EnforcedPause");
    await event(as(f.fund, f.moderator).unpause(), f.fund, "Unpaused");
    await (await as(f.fund, f.alice).contribute(0, { value: 1n })).wait();
  });
});

describe("Виплати та винагороди", () => {
  it("лише автор забирає зібрані кошти", async () => { await successful(); await rejects(as(f.fund, f.bob).withdrawFunds(0), f.fund, "NotCampaignCreator"); });
  it("не виплачує активний збір", async () => { await f.create(); await rejects(as(f.fund, f.creator).withdrawFunds(0), f.fund, "WrongState"); });
  it("виплачує точну суму та не допускає повторної виплати", async () => {
    await successful();
    const before = await f.provider.getBalance(f.creator.address);
    const tx = await as(f.fund, f.creator).withdrawFunds(0);
    const receipt = await tx.wait();
    assert.equal(await f.provider.getBalance(f.creator.address), before + 100n - receipt.fee);
    assert.equal((await f.fund.getCampaign(0)).state, 3n);
    assert.equal(await f.provider.getBalance(await f.fund.getAddress()), 0n);
    await rejects(as(f.fund, f.creator).withdrawFunds(0), f.fund, "WrongState");
  });
  it("генерує FundsWithdrawn", async () => { await successful(); await event(as(f.fund, f.creator).withdrawFunds(0), f.fund, "FundsWithdrawn"); });
  it("не повертає внески успішної кампанії", async () => { await successful(); await rejects(as(f.fund, f.alice).refund(0), f.fund, "WrongState"); });
  it("повертає точну суму внеску, очищує запис, генерує подію", async () => {
    await failed();
    await event(as(f.fund, f.alice).refund(0), f.fund, "Refunded");
    assert.equal(await f.fund.contributions(0, f.alice.address), 0n);
    assert.equal(await f.provider.getBalance(await f.fund.getAddress()), 0n);
  });
  it("не повертає кошти двічі", async () => { await failed(); await (await as(f.fund, f.alice).refund(0)).wait(); await rejects(as(f.fund, f.alice).refund(0), f.fund, "NothingToClaim"); });
  it("не повертає кошти без внеску", async () => { await failed(); await rejects(as(f.fund, f.bob).refund(0), f.fund, "NothingToClaim"); });
  it("карбує винагороду до виплати автору", async () => { await successful(); await event(as(f.fund, f.alice).claimReward(0), f.fund, "RewardClaimed"); assert.equal(await f.token.balanceOf(f.alice.address), 100n); });
  it("карбує винагороду після виплати автору", async () => { await successful(); await (await as(f.fund, f.creator).withdrawFunds(0)).wait(); await (await as(f.fund, f.alice).claimReward(0)).wait(); assert.equal(await f.token.balanceOf(f.alice.address), 100n); });
  it("не карбує винагороду двічі", async () => { await successful(); await (await as(f.fund, f.alice).claimReward(0)).wait(); await rejects(as(f.fund, f.alice).claimReward(0), f.fund, "NothingToClaim"); });
  it("не карбує винагороду без внеску", async () => { await successful(); await rejects(as(f.fund, f.bob).claimReward(0), f.fund, "NothingToClaim"); });
  it("не карбує винагороду проваленого збору", async () => { await failed(); await rejects(as(f.fund, f.alice).claimReward(0), f.fund, "WrongState"); });
  it("не карбує винагороду активного збору", async () => { await f.create(); await rejects(as(f.fund, f.alice).claimReward(0), f.fund, "WrongState"); });
  it("пауза не блокує повернення коштів", async () => { await failed(); await (await as(f.fund, f.moderator).pause()).wait(); await (await as(f.fund, f.alice).refund(0)).wait(); assert.equal(await f.fund.contributions(0, f.alice.address), 0n); });
  it("пауза не блокує завершення, виплату та винагороду", async () => {
    const { deadline } = await f.create();
    await (await as(f.fund, f.alice).contribute(0, { value: 100n })).wait();
    await (await as(f.fund, f.moderator).pause()).wait();
    await f.advance(deadline);
    await (await f.fund.finalize(0)).wait();
    await (await as(f.fund, f.creator).withdrawFunds(0)).wait();
    await (await as(f.fund, f.alice).claimReward(0)).wait();
  });
  it("провал карбування відновлює право на винагороду", async () => {
    await successful();
    await (await f.token.revokeRole(await f.token.MINTER_ROLE(), await f.fund.getAddress())).wait();
    await rejects(as(f.fund, f.alice).claimReward(0), f.token, "AccessControlUnauthorizedAccount");
    assert.equal(await f.fund.rewardClaimed(0, f.alice.address), false);
  });
});

describe("EIP-712", () => {
  it("релеєр створює кампанію; автор визначається підписом", async () => {
    const signed = await signature();
    await event(as(f.fund, f.bob).createCampaignBySignature(...signed.args), f.fund, "NonceUsed");
    assert.equal((await f.fund.getCampaign(0)).creator, f.creator.address);
    assert.equal(await f.fund.nonces(f.creator.address), 1n);
  });
  it("відхиляє повторне використання підпису", async () => { const signed = await signature(); await (await f.fund.createCampaignBySignature(...signed.args)).wait(); await rejects(f.fund.createCampaignBySignature(...signed.args), f.fund, "InvalidSignature"); });
  it("відхиляє підмінені параметри", async () => { const signed = await signature(); signed.args[1] = "Підміна"; await rejects(f.fund.createCampaignBySignature(...signed.args), f.fund, "InvalidSignature"); });
  it("відхиляє підпис для іншої мережі", async () => { const signed = await signature({}, { chainId: 11155111 }); await rejects(f.fund.createCampaignBySignature(...signed.args), f.fund, "InvalidSignature"); });
  it("відхиляє підпис для іншого контракту", async () => { const signed = await signature({}, { verifyingContract: f.bob.address }); await rejects(f.fund.createCampaignBySignature(...signed.args), f.fund, "InvalidSignature"); });
  it("відхиляє прострочений підпис", async () => { const signed = await signature({ expiresAt: await f.now() - 1 }); await rejects(f.fund.createCampaignBySignature(...signed.args), f.fund, "SignatureExpired"); });
  it("невдала кампанія не споживає nonce", async () => { const signed = await signature({ goal: 0n }); await rejects(f.fund.createCampaignBySignature(...signed.args), f.fund, "InvalidGoal"); assert.equal(await f.fund.nonces(f.creator.address), 0n); });
  it("пауза блокує релеєр", async () => { const signed = await signature(); await (await as(f.fund, f.moderator).pause()).wait(); await rejects(f.fund.createCampaignBySignature(...signed.args), f.fund, "EnforcedPause"); });
});

describe("Атака та ізоляція виплат", () => {
  it("та сама атака викрадає чужі кошти з вразливої версії", async () => {
    const vulnerable = await f.deploy("VulnerableRefund");
    const attacker = await f.deploy("RefundAttacker", [await vulnerable.getAddress()]);
    await (await as(vulnerable, f.alice).deposit({ value: 300n })).wait();
    await (await attacker.deposit(0, true, { value: 100n })).wait();
    await (await attacker.attack()).wait();
    assert.equal(await f.provider.getBalance(await vulnerable.getAddress()), 0n);
    assert.equal(await f.provider.getBalance(await attacker.getAddress()), 400n);
    assert.equal(await attacker.reentrySucceeded(), true);
  });
  it("та сама атака не викрадає чужі кошти з правильної версії", async () => {
    const attacker = await f.deploy("RefundAttacker", [await f.fund.getAddress()]);
    const { deadline } = await f.create(1000n);
    await (await as(f.fund, f.alice).contribute(0, { value: 300n })).wait();
    await (await attacker.deposit(0, false, { value: 100n })).wait();
    await f.advance(deadline);
    await (await f.fund.finalize(0)).wait();
    await (await attacker.attack()).wait();
    assert.equal(await f.provider.getBalance(await attacker.getAddress()), 100n);
    assert.equal(await f.provider.getBalance(await f.fund.getAddress()), 300n);
    assert.equal(await attacker.reentrySucceeded(), false);
    await (await as(f.fund, f.alice).refund(0)).wait();
    assert.equal(await f.provider.getBalance(await f.fund.getAddress()), 0n);
  });
  it("отримувач, який відхиляє ETH, не блокує інших вкладників", async () => {
    const attacker = await f.deploy("RefundAttacker", [await f.fund.getAddress()]);
    const { deadline } = await f.create(1000n);
    await (await attacker.deposit(0, false, { value: 100n })).wait();
    await (await as(f.fund, f.alice).contribute(0, { value: 100n })).wait();
    await f.advance(deadline);
    await (await f.fund.finalize(0)).wait();
    await (await attacker.setRejectPayments(true)).wait();
    await rejects(attacker.attack(), f.fund, "TransferFailed");
    assert.equal(await f.fund.contributions(0, await attacker.getAddress()), 100n);
    await (await as(f.fund, f.alice).refund(0)).wait();
    assert.equal(await f.fund.contributions(0, f.alice.address), 0n);
  });
  it("невдала виплата автору відновлює стан Successful", async () => {
    const creator = await f.deploy("RefundAttacker", [await f.fund.getAddress()]);
    await (await as(f.registry, f.moderator).grantRole(await f.registry.CREATOR_ROLE(), await creator.getAddress())).wait();
    const deadline = await f.now() + 1000;
    await (await creator.create("Ідея", 100n, deadline)).wait();
    await (await as(f.fund, f.alice).contribute(0, { value: 100n })).wait();
    await f.advance(deadline);
    await (await f.fund.finalize(0)).wait();
    await (await creator.setRejectPayments(true)).wait();
    await rejects(creator.withdraw(0), f.fund, "TransferFailed");
    assert.equal((await f.fund.getCampaign(0)).state, 1n);
    await (await creator.setRejectPayments(false)).wait();
    await (await creator.withdraw(0)).wait();
    assert.equal((await f.fund.getCampaign(0)).state, 3n);
  });
});
