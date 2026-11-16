import "dotenv/config";
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Deployment } from "../../../shared/interfaces/deployment";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const deployment = z.object({
  chainId: z.number().int().positive(),
  blockNumber: z.number().int().nonnegative(),
  blockHash: z.string(),
  contracts: z.object({ registry: address, token: address, crowdfunding: address })
}).parse(JSON.parse(readFileSync(process.env.DEPLOYMENT_FILE || "deployments/31337.json", "utf8"))) satisfies Deployment;
export const config = {
  rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545",
  host: z.string().ip({ version: "v4" }).parse(process.env.API_HOST || "127.0.0.1"),
  port: z.coerce.number().int().min(1).max(65535).parse(process.env.API_PORT || 3001),
  origin: process.env.WEB_ORIGIN || "http://localhost:5173",
  relayKey: process.env.RELAYER_PRIVATE_KEY
};
