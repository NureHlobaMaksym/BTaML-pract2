import { mkdir, writeFile } from "node:fs/promises";
import { keccak256, toUtf8Bytes } from "ethers";
import { fixture, as } from "../test/helpers";
import { CREATE_CAMPAIGN_TYPES } from "../shared/constants/signature-types";

async function main() {
  const f = await fixture();
  try {
    const rows: { contract: string; function: string; gas: number; executionGas: number }[] = [];
    for (const name of ["Crowdfunding", "UnpackedCrowdfunding", "StorageDependenciesCrowdfunding"]) {
      const contract = name === "Crowdfunding" ? f.fund : await f.deploy(name, [await f.registry.getAddress(), await f.token.getAddress()]);
      const title = "Crowdfunding campaign with a sufficiently detailed title to compare calldata copies";
      const deadline = await f.now() + 100000;
      const direct = await as(contract, f.creator).createCampaign(title, 100n, deadline);
      const directReceipt = await direct.wait();
      const intrinsic = (data: string) => 21000 + [...Buffer.from(data.slice(2), "hex")].reduce((sum, byte) => sum + (byte === 0 ? 4 : 16), 0);
      rows.push({ contract: name, function: "createCampaign", gas: Number(directReceipt.gasUsed), executionGas: Number(directReceipt.gasUsed) - intrinsic(direct.data) });
      const expiresAt = await f.now() + 1000;
      const signature = await f.creator.signTypedData({ name: "Crowdfunding", version: "1", chainId: 31337, verifyingContract: await contract.getAddress() }, CREATE_CAMPAIGN_TYPES, { creator: f.creator.address, titleHash: keccak256(toUtf8Bytes(title)), goal: 100n, deadline, nonce: 0, expiresAt });
      const relayed = await as(contract, f.bob).createCampaignBySignature(f.creator.address, title, 100n, deadline, expiresAt, signature);
      const relayReceipt = await relayed.wait();
      rows.push({ contract: name, function: "createCampaignBySignature", gas: Number(relayReceipt.gasUsed), executionGas: Number(relayReceipt.gasUsed) - intrinsic(relayed.data) });
    }
    await mkdir("evidence", { recursive: true });
    await writeFile("evidence/gas-comparison.json", JSON.stringify({ method: "identical inputs; executionGas excludes calldata intrinsic gas to remove signature-byte variance; baselines alter only storage packing or immutable dependency addresses", rows }, null, 2));
    console.table(rows);
    for (const baseline of ["UnpackedCrowdfunding", "StorageDependenciesCrowdfunding"]) for (const method of ["createCampaign", "createCampaignBySignature"]) {
      const before = rows.find(row => row.contract === baseline && row.function === method)!.executionGas;
      const after = rows.find(row => row.contract === "Crowdfunding" && row.function === method)!.executionGas;
      if (before <= after) throw new Error(`Оптимізація не знизила execution gas: ${baseline}.${method}`);
    }
  } finally { f.provider.destroy(); await f.connection.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
