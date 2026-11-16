import { createDatabasePool } from "../apps/api/src/database/pool";
import { migrateDatabase } from "../apps/api/src/database/migrate";

const pool = createDatabasePool();
try {
  await migrateDatabase(pool);
  console.log("Міграції PostgreSQL застосовані");
} finally { await pool.end(); }
