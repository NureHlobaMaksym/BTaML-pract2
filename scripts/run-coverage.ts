import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

if (!existsSync("quality/contracts-coverage/node_modules/hardhat/internal/cli/cli.js")) {
  const install = spawnSync("npm", ["ci", "--prefix", "quality/contracts-coverage"], { stdio: "inherit" });
  if (install.status !== 0) process.exit(install.status || 1);
}
rmSync("coverage.json", { force: true });
rmSync("coverage", { recursive: true, force: true });
const result = spawnSync(process.execPath, [resolve("quality/contracts-coverage/runner.cjs"), "coverage", "--config", "hardhat.config.cjs", "--solcoverjs", ".solcover.cjs"], { cwd: resolve("quality/contracts-coverage"), stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
