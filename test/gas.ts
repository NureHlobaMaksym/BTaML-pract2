import { mkdirSync, writeFileSync } from "node:fs";

const measurements = new Map<string, bigint[]>();
export function recordGas(name: string, amount: bigint) {
  measurements.set(name, [...(measurements.get(name) || []), amount]);
}
export function saveGas() {
  const rows = [...measurements].map(([name, values]) => ({ function: name, calls: values.length, min: Number(values.reduce((a, b) => a < b ? a : b)), max: Number(values.reduce((a, b) => a > b ? a : b)), average: Number(values.reduce((a, b) => a + b, 0n) / BigInt(values.length)) }));
  mkdirSync("evidence", { recursive: true });
  writeFileSync("evidence/gas.json", JSON.stringify(rows, null, 2));
  console.table(rows);
}
