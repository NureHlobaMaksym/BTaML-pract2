import { coverageRuntime } from "./test-runner";
import { recordGas } from "./gas";
import { BrowserProvider, Contract, ContractFactory, type JsonRpcSigner } from "ethers";
import assert from "node:assert/strict";

export async function fixture() {
  const nativeRuntime = coverageRuntime ? undefined : await import("hardhat");
  const connection = coverageRuntime
    ? { provider: coverageRuntime.network.provider, close: async () => {} }
    : await nativeRuntime!.network.create();
  const names = new Map<string, string>();
  const request = connection.provider.request.bind(connection.provider);
  if (process.env.GAS === "true") connection.provider.request = async (args: { method: string; params?: unknown[] }) => {
    const result = await request(args);
    if (args.method === "eth_sendTransaction") {
      const tx = (args.params as { to?: string; data?: string }[])[0];
      const receipt = await request({ method: "eth_getTransactionReceipt", params: [result] }) as { gasUsed: string };
      recordGas(tx.to ? names.get(`${tx.to.toLowerCase()}:${tx.data?.slice(0, 10) || ""}`) || "unknown" : "deployment", BigInt(receipt.gasUsed));
    }
    return result;
  };
  const provider = new BrowserProvider(connection.provider, undefined, { cacheTimeout: -1 });
  const signers = await Promise.all([0, 1, 2, 3, 4].map(index => provider.getSigner(index)));
  const [admin, moderator, creator, alice, bob] = signers;
  async function deploy(name: string, args: unknown[] = []) {
    const artifact = await (coverageRuntime?.artifacts ?? nativeRuntime!.artifacts).readArtifact(name);
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, admin);
    const instance = await factory.deploy(...args);
    await instance.waitForDeployment();
    const address = (await instance.getAddress()).toLowerCase();
    factory.interface.forEachFunction(fragment => names.set(`${address}:${fragment.selector}`, `${name}.${fragment.name}`));
    return new Contract(await instance.getAddress(), artifact.abi, admin);
  }
  const registry = await deploy("CreatorRegistry", [admin.address, moderator.address]);
  const token = await deploy("RewardToken", [admin.address]);
  const fund = await deploy("Crowdfunding", [await registry.getAddress(), await token.getAddress()]);
  await (await token.grantRole(await token.MINTER_ROLE(), await fund.getAddress())).wait();
  await (await as(registry, moderator).grantRole(await registry.CREATOR_ROLE(), creator.address)).wait();
  const now = async () => Number((await provider.getBlock("latest"))!.timestamp);
  const advance = async (timestamp: number) => {
    await connection.provider.request({ method: "evm_setNextBlockTimestamp", params: [timestamp] });
    await connection.provider.request({ method: "evm_mine", params: [] });
  };
  const create = async (goal = 100n, duration = 1000, title = "Спільна ідея") => {
    const deadline = await now() + duration;
    const id = Number(await fund.campaignCount());
    await (await as(fund, creator).createCampaign(title, goal, deadline)).wait();
    return { id, deadline };
  };
  return { connection, provider, admin, moderator, creator, alice, bob, registry, token, fund, deploy, now, advance, create };
}
export function as(contract: Contract, signer: JsonRpcSigner) { return contract.connect(signer) as Contract; }
export async function rejects(promise: Promise<unknown>, contract: Contract, name: string) {
  await assert.rejects(promise, (error: unknown) => {
    const value = error as { data?: string; info?: { error?: { data?: string | { data?: string } } } };
    const inner = value.info?.error?.data;
    const data = value.data || (typeof inner === "string" ? inner : inner?.data);
    assert.ok(data, `No revert data: ${String(error)}`);
    assert.equal(contract.interface.parseError(data)?.name, name);
    return true;
  });
}
export async function event(promise: Promise<{ wait(): Promise<unknown> }>, contract: Contract, name: string) {
  const receipt = await (await promise).wait() as { logs: { topics: readonly string[]; data: string }[] };
  const parsed = receipt.logs.flatMap(log => { try { const parsed = contract.interface.parseLog(log); return parsed ? [parsed] : []; } catch { return []; } });
  assert.ok(parsed.some(item => item.name === name), `Event ${name} absent`);
  return parsed.find(item => item.name === name)!;
}
