import "dotenv/config";
import { JsonRpcProvider, Wallet, formatEther } from "ethers";
import { deploymentRoles } from "./deployment-roles";

async function main() {
  const required = ["SEPOLIA_RPC_URL", "DEPLOYER_PRIVATE_KEY", "ETHERSCAN_API_KEY"];
  const missing = required.filter(name => !process.env[name]?.trim());
  if (missing.length) throw new Error(`Заповніть локальний .env: ${missing.join(", ")}. Приватний ключ не надсилайте в чат.`);
  const address = new Wallet(process.env.DEPLOYER_PRIVATE_KEY!).address;
  const { admin, moderator } = deploymentRoles(address, process.env.MODERATOR_ADDRESS);
  const provider = new JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  try {
    if ((await provider.getNetwork()).chainId !== 11155111n) throw new Error("RPC має вести до Sepolia, Chain ID 11155111");
    const balance = await provider.getBalance(address);
    console.log(`Deployer: ${address}; Sepolia: ${formatEther(balance)} ETH`);
    console.log(`Адміністратор нового розгортання: ${admin}; модератор: ${moderator}`);
    if (balance === 0n) throw new Error("Отримайте тестовий Sepolia ETH на цю адресу для газу розгортання");
    console.log("Параметри мережі та гаманець перевірені. Наступна команда: npm run deploy:sepolia");
  } finally { provider.destroy(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
