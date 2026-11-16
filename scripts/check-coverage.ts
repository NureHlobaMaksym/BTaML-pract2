import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import type { ContractCoverage } from "../shared/interfaces/contract-coverage";

const report: Record<string, ContractCoverage> = JSON.parse(readFileSync("coverage.json", "utf8"));
const expected = ["CreatorRegistry", "RewardToken", "Crowdfunding"].map(name => `contracts/${name}.sol`);
if (Object.keys(report).length !== expected.length || expected.some(file => !report[file])) throw new Error("Очікується стандартне покриття всіх трьох production-контрактів");
const percent = (hits: number[]) => hits.length ? hits.filter(hit => hit > 0).length / hits.length * 100 : 100;
const files = Object.fromEntries(expected.map(file => {
  const coverage = report[file];
  const lines = percent(Object.values(coverage.l));
  const branches = percent(Object.values(coverage.b).flat());
  console.log(`${file}: lines=${lines.toFixed(2)}%, branches=${branches.toFixed(2)}%`);
  if (lines < 90 || branches < 90) process.exitCode = 1;
  return [file, { lines, branches }];
}));
mkdirSync("coverage", { recursive: true });
writeFileSync("coverage/summary.json", JSON.stringify({ tool: "solidity-coverage/Istanbul", files }, null, 2));
