import { formatEther } from "ethers";

export function escape(value: string) {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
export function amount(value: string) {
  const [integer, fraction] = formatEther(value).split(".");
  return `${BigInt(integer).toLocaleString("uk-UA")}${fraction && fraction !== "0" ? `,${fraction}` : ""}`;
}
export function date(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleDateString("uk-UA", { day: "numeric", month: "short", year: "numeric" });
}
