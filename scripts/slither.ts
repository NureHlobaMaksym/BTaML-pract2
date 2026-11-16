import { mkdir, readFile, writeFile, rm, access, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

async function main() {
  const compile = spawnSync(process.execPath, ["node_modules/hardhat/dist/src/cli.js", "compile", "--force"], { stdio: "inherit" });
  if (compile.error || compile.status !== 0) throw new Error("Не вдалося підготувати повну збірку для Slither");
  const stage = resolve(".slither/artifacts/build-info");
  await rm(".slither", { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  const builds = new Set<string>();
  for (const name of ["CreatorRegistry", "RewardToken", "Crowdfunding"]) {
    const artifact = JSON.parse(await readFile(`artifacts/contracts/${name}.sol/${name}.json`, "utf8"));
    builds.add(artifact.buildInfoId);
  }
  for (const id of builds) {
    for (const suffix of [".json", ".output.json"]) await copyFile(`artifacts/build-info/${id}${suffix}`, resolve(stage, `${id}${suffix}`));
  }
  let executable = process.env.SLITHER_BIN || "slither";
  try { await access(".venv/bin/slither"); executable = resolve(".venv/bin/slither"); } catch {}
  await mkdir("evidence", { recursive: true });
  await rm("evidence/slither.json", { force: true });
  const result = spawnSync(executable, [".", "--hardhat-ignore-compile", "--hardhat-artifacts-directory", resolve(".slither/artifacts"), "--filter-paths", "node_modules|npm/|contracts/security/|contracts/benchmarks/", "--json", resolve("evidence/slither.json")], {
    stdio: "inherit", env: { ...process.env, VIRTUAL_ENV: resolve(".venv") }
  });
  if (result.error) throw new Error("Slither недоступний. Створіть .venv і встановіть requirements-dev.txt");
  const report = JSON.parse(await readFile("evidence/slither.json", "utf8"));
  if (!report.success) throw new Error("Slither не завершив аналіз");
  const review = report.results.detectors.map((finding: { id: string; check: string; impact: string; description: string }) => {
    const rationale = finding.check === "timestamp"
      ? "Дедлайни та строк дії підписів навмисно залежать від block.timestamp. Час не використовується як випадковість; граничні секунди та прострочення перевірені тестами. Включення транзакції до блоку може відбутися пізніше за натискання кнопки."
      : finding.check === "low-level-calls"
        ? "Pull-виплата виконується через call для підтримки контрактних гаманців. Стан змінено до виклику, результат перевірено, nonReentrant блокує повторний вхід; тести перевіряють атаку та відмову отримувача."
        : undefined;
    if (!rationale || /High|Medium/i.test(finding.impact)) process.exitCode = 1;
    return { id: finding.id, check: finding.check, impact: finding.impact, description: finding.description, status: rationale ? "reviewed" : "requires-review", rationale };
  });
  await writeFile("evidence/slither-review.json", JSON.stringify({ slitherVersion: "0.11.6", findings: review }, null, 2));
  console.log(`Slither: ${review.length} зауважень; розбір: evidence/slither-review.json`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
