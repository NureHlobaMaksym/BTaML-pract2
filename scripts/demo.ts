import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { fixture, as } from "../test/helpers";

async function main() {
  const f = await fixture();
  try {
    const steps: { action: string; account: string; transactionHash: string }[] = [];
    const send = async (action: string, account: string, promise: Promise<{ hash: string; wait(): Promise<unknown> }>) => {
      const tx = await promise;
      await tx.wait();
      steps.push({ action, account, transactionHash: tx.hash });
    };
    const deadline = await f.now() + 1000;
    await send("Створення успішного збору", f.creator.address, as(f.fund, f.creator).createCampaign("Успішна ідея", 100n, deadline));
    await send("Внесок вкладника", f.alice.address, as(f.fund, f.alice).contribute(0, { value: 100n }));
    await f.advance(deadline);
    await send("Фіксація успіху", f.alice.address, as(f.fund, f.alice).finalize(0));
    await send("Виплата автору", f.creator.address, as(f.fund, f.creator).withdrawFunds(0));
    await send("Отримання винагороди", f.alice.address, as(f.fund, f.alice).claimReward(0));
    const nextDeadline = await f.now() + 1000;
    await send("Створення неуспішного збору", f.creator.address, as(f.fund, f.creator).createCampaign("Ідея без достатнього фінансування", 1000n, nextDeadline));
    await send("Недостатній внесок", f.alice.address, as(f.fund, f.alice).contribute(1, { value: 100n }));
    await f.advance(nextDeadline);
    await send("Фіксація провалу", f.alice.address, as(f.fund, f.alice).finalize(1));
    await send("Повернення внеску", f.alice.address, as(f.fund, f.alice).refund(1));
    assert.equal((await f.fund.getCampaign(0)).state, 3n);
    assert.equal((await f.fund.getCampaign(1)).state, 2n);
    assert.equal(await f.fund.contributions(1, f.alice.address), 0n);
    assert.equal(await f.token.balanceOf(f.alice.address), 100n);
    assert.equal(await f.provider.getBalance(await f.fund.getAddress()), 0n);
    await mkdir("evidence", { recursive: true });
    await writeFile("evidence/demo.json", JSON.stringify({ network: "isolated in-process Hardhat, discarded after script exit", contracts: { registry: await f.registry.getAddress(), token: await f.token.getAddress(), crowdfunding: await f.fund.getAddress() }, creator: f.creator.address, contributor: f.alice.address, steps, finalContractBalance: "0", contributorReward: "100" }, null, 2));
    console.table(steps);
    console.log("Два бізнес-акаунти пройшли успішний збір і повернення коштів.");
  } finally { f.provider.destroy(); await f.connection.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
