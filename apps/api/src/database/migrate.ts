import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import type { Pool } from "pg";

export async function migrateDatabase(pool: Pool) {
  const client = await pool.connect().catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ECONNREFUSED") {
      throw new Error("PostgreSQL недоступний. Запустіть Docker Desktop, виконайте npm run db:up і повторіть запуск API.", { cause: error });
    }
    throw error;
  });
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended(current_schema() || ':migrations', 0))");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    const directory = new URL("./migrations/", import.meta.url);
    for (const version of (await readdir(directory)).filter(file => file.endsWith(".sql")).sort()) {
      const sql = await readFile(new URL(version, directory), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query("SELECT checksum FROM schema_migrations WHERE version = $1", [version]);
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum) throw new Error(`Змінено застосовану міграцію ${version}`);
        continue;
      }
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", [version, checksum]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
