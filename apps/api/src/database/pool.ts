import "dotenv/config";
import { Pool } from "pg";
import type { PoolConfig } from "pg";

export function createDatabasePool(overrides: PoolConfig = {}) {
  const pool = new Pool({
    host: process.env.PGHOST || "127.0.0.1",
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || "btaml",
    user: process.env.PGUSER || "btaml",
    password: process.env.PGPASSWORD,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    ...overrides
  });
  pool.on("error", () => console.error("Втрачено з’єднання з PostgreSQL"));
  return pool;
}
