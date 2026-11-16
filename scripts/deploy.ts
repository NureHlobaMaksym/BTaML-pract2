import "dotenv/config";
import { BrowserProvider, ContractFactory, JsonRpcProvider, Wallet } from "ethers";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { VerificationContract } from "../shared/interfaces/verification-contract";
import type { Deployment } from "../shared/interfaces/deployment";
import { deploymentRoles } from "./deployment-roles";

async function main() {
  const sepolia = process.env.NETWORK === "sepolia";
  if (sepolia && !process.env.SEPOLIA_RPC_URL) throw new Error("Задайте SEPOLIA_RPC_URL");
  const connection = process.env.NETWORK === "hardhat" ? await (await import("hardhat")).network.create() : undefined;
  const provider = connection ? new BrowserProvider(connection.provider, undefined, { cacheTimeout: -1 }) : new JsonRpcProvider(sepolia ? process.env.SEPOLIA_RPC_URL : process.env.RPC_URL || "http://127.0.0.1:8545", undefined, { cacheTimeout: -1 });
  try {
    const chainId = Number((await provider.getNetwork()).chainId);
    if (chainId !== (sepolia ? 11155111 : 31337)) throw new Error("Неправильна мережа");
    if (sepolia && !process.env.DEPLOYER_PRIVATE_KEY) throw new Error("Задайте DEPLOYER_PRIVATE_KEY");
    const deployer = sepolia && process.env.DEPLOYER_PRIVATE_KEY ? new Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider) : await provider.getSigner(0);
    const deployerAddress = await deployer.getAddress();
    const { admin, moderator } = deploymentRoles(deployerAddress, process.env.MODERATOR_ADDRESS);
    const verification: VerificationContract[] = [];
    async function deploy(name: string, args: string[]) {
      const artifact = JSON.parse(await readFile(`artifacts/contracts/${name}.sol/${name}.json`, "utf8"));
      const contract = await new ContractFactory(artifact.abi, artifact.bytecode, deployer).deploy(...args);
      await contract.waitForDeployment();
      const build = JSON.parse(await readFile(`artifacts/build-info/${artifact.buildInfoId}.json`, "utf8"));
      verification.push({ name, address: await contract.getAddress(), sourceName: artifact.inputSourceName, compilerVersion: build.solcLongVersion, input: build.input, constructorTypes: args.map(() => "address"), constructorArguments: args });
      return contract;
    }
    const registry = await deploy("CreatorRegistry", [admin, moderator]);
    const token = await deploy("RewardToken", [admin]);
    const crowdfunding = await deploy("Crowdfunding", [await registry.getAddress(), await token.getAddress()]);
    await (await token.getFunction("grantRole")(await token.getFunction("MINTER_ROLE")(), await crowdfunding.getAddress())).wait();
    const receipt = await registry.deploymentTransaction()!.wait();
    const deployment: Deployment = { chainId, blockNumber: receipt!.blockNumber, blockHash: receipt!.blockHash, contracts: { registry: await registry.getAddress(), token: await token.getAddress(), crowdfunding: await crowdfunding.getAddress() } };
    await mkdir("deployments", { recursive: true });
    await writeFile(`deployments/${connection ? "simulation-" : ""}${chainId}.json`, JSON.stringify(deployment, null, 2));
    await writeFile(`deployments/verification-${connection ? "simulation-" : ""}${chainId}.json`, JSON.stringify(verification, null, 2));
    console.log(JSON.stringify(deployment, null, 2));
    if (connection) console.log("Симуляцію завершено; для API запустіть постійний localhost node та deploy:local.");
  } finally {
    provider.destroy();
    if (connection) await connection.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
