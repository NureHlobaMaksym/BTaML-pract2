import "dotenv/config";

if (!process.env.SEPOLIA_RPC_URL?.trim()) throw new Error("Задайте SEPOLIA_RPC_URL у локальному .env");
process.env.RPC_URL = process.env.SEPOLIA_RPC_URL;
process.env.CHAIN_ID = "11155111";
process.env.DEPLOYMENT_FILE = "deployments/11155111.json";
await import("../apps/api/src/main");
