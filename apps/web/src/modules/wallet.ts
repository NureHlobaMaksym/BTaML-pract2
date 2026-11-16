import { UserError } from "../shared/user-error";
import { BrowserProvider, Contract, Interface } from "ethers";
import registryArtifact from "../../../../artifacts/contracts/CreatorRegistry.sol/CreatorRegistry.json";
import tokenArtifact from "../../../../artifacts/contracts/RewardToken.sol/RewardToken.json";
import crowdfundingArtifact from "../../../../artifacts/contracts/Crowdfunding.sol/Crowdfunding.json";
import type { PublicConfig } from "../shared/public-config";
import { ERROR_MESSAGES } from "../../../../shared/constants/contract-error-messages";

export const abis = { registry: registryArtifact.abi, token: tokenArtifact.abi, crowdfunding: crowdfundingArtifact.abi };

export async function connect(config: PublicConfig, requestAccess = true) {
  if (!window.ethereum) throw new UserError("Для продовження встановіть MetaMask — розширення гаманця для браузера.");
  const provider = new BrowserProvider(window.ethereum, undefined, { cacheTimeout: -1 });
  await provider.send(requestAccess ? "eth_requestAccounts" : "eth_accounts", []);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== config.chainId) throw new UserError(`У гаманці виберіть ${config.chainId === 31337 ? "локальну тестову мережу" : "мережу Sepolia"}, щоб продовжити.`);
  return { provider, signer: await provider.getSigner() };
}

export function explainError(error: unknown): string {
  if (error instanceof UserError) return error.message;
  const item = error as { code?: string | number; data?: string; error?: { data?: string }; info?: { error?: { data?: string | { data?: string } } }; message?: string };
  if (item.code === "ACTION_REJECTED" || item.code === 4001) return "Ви відхилили запит у MetaMask.";
  if (item.code === "INSUFFICIENT_FUNDS") return "Недостатньо ETH для суми операції та газу.";
  const nested = item.info?.error?.data;
  const data = item.data || item.error?.data || (typeof nested === "string" ? nested : nested?.data);
  if (data) for (const abi of Object.values(abis)) {
    try {
      const parsed = new Interface(abi).parseError(data);
      if (parsed) return ERROR_MESSAGES[parsed.name] || "Ця дія зараз недоступна для вашого гаманця.";
    } catch { continue; }
  }
  return "Не вдалося виконати дію. Перевірте підключення гаманця та спробуйте ще раз.";
}

export function readContracts(config: PublicConfig, provider: BrowserProvider) {
  return Object.fromEntries(Object.entries(config.contracts).map(([name, address]) => [name, new Contract(address, abis[name as keyof typeof abis], provider)])) as Record<keyof typeof abis, Contract>;
}
