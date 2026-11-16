import { randomUUID } from "node:crypto";
import { createDatabasePool } from "../src/database/pool";
import { migrateDatabase } from "../src/database/migrate";

export async function testDatabase() {
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  const settings = process.env.TEST_DATABASE_URL ? { connectionString: process.env.TEST_DATABASE_URL } : {};
  const admin = createDatabasePool(settings);
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = createDatabasePool({ ...settings, options: `-c search_path=${schema}` });
  try { await migrateDatabase(pool); }
  catch (error) { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); throw error; }
  return {
    pool,
    async reset() { await pool.query("TRUNCATE index_deployments CASCADE"); },
    async close() { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  };
}
