import "dotenv/config";
import { AbiCoder } from "ethers";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { Deployment } from "../shared/interfaces/deployment";
import type { VerificationContract } from "../shared/interfaces/verification-contract";

async function main() {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) throw new Error("Задайте ETHERSCAN_API_KEY у локальному .env");
  const deployment: Deployment = JSON.parse(await readFile("deployments/11155111.json", "utf8"));
  const contracts: VerificationContract[] = JSON.parse(await readFile("deployments/verification-11155111.json", "utf8"));
  const expected = Object.values(deployment.contracts).map(address => address.toLowerCase());
  if (deployment.chainId !== 11155111 || contracts.length !== 3 || new Set(contracts.map(contract => contract.address.toLowerCase())).size !== 3 || contracts.some(contract => !expected.includes(contract.address.toLowerCase()))) throw new Error("Пакет верифікації не відповідає розгортанню Sepolia");
  const results: { name: string; address: string; url: string; verified: boolean; guid?: string }[] = [];
  for (const contract of contracts) {
    const { name, address } = contract;
    const query = new URLSearchParams({ apikey: apiKey, chainid: "11155111", module: "contract", action: "verifysourcecode" });
    const form = new URLSearchParams({ contractaddress: address, sourceCode: JSON.stringify(contract.input), codeformat: "solidity-standard-json-input", contractname: `${contract.sourceName}:${name}`, compilerversion: `v${contract.compilerVersion}`, constructorArguments: AbiCoder.defaultAbiCoder().encode(contract.constructorTypes, contract.constructorArguments).slice(2) });
    const response = await fetch(`https://api.etherscan.io/v2/api?${query}`, { method: "POST", body: form, signal: AbortSignal.timeout(30000) });
    const submission = await response.json() as { status: string; result: string };
    let verified = /already verified/i.test(submission.result);
    if (!verified && submission.status !== "1") throw new Error(`${name}: ${submission.result}`);
    const result = { name, address, url: `https://sepolia.etherscan.io/address/${address}#code`, verified, guid: verified ? undefined : submission.result };
    results.push(result);
    for (let attempt = 0; !verified && attempt < 20; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const query = new URLSearchParams({ apikey: apiKey, chainid: "11155111", module: "contract", action: "checkverifystatus", guid: submission.result });
      const check = await (await fetch(`https://api.etherscan.io/v2/api?${query}`, { signal: AbortSignal.timeout(30000) })).json() as { status: string; result: string };
      verified = check.status === "1" || /already verified/i.test(check.result);
      if (!verified && !/pending|queue/i.test(check.result)) throw new Error(`${name}: ${check.result}`);
    }
    result.verified = verified;
    await mkdir("evidence", { recursive: true });
    await writeFile("evidence/sepolia-verification.json", JSON.stringify(results, null, 2));
    if (!verified) throw new Error(`${name}: верифікація очікує; GUID збережено у evidence/sepolia-verification.json`);
    console.log(`${name}: ${result.url}`);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
