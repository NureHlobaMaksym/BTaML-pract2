import "./style.css";
import { CAMPAIGN_DURATION_MS } from "./shared/deadline-limits";
import { CreatorAccess } from "./modules/creator-access";
import { Contract, keccak256, parseEther, toUtf8Bytes, type BrowserProvider, type JsonRpcSigner } from "ethers";
import { api } from "./shared/api";
import type { PublicConfig } from "./shared/public-config";
import type { Campaign } from "../../../shared/interfaces/campaign";
import type { CampaignParticipation } from "./shared/campaign-participation";
import { CAMPAIGN_PAGE_SIZE } from "../../../shared/constants/pagination";
import { NOTIFICATION_DURATIONS_MS } from "../../../shared/constants/notification-durations";
import { amount } from "./shared/format";
import { CAMPAIGN_REFRESH_INTERVAL_MS } from "../../../shared/constants/polling-intervals";
import { CREATE_CAMPAIGN_TYPES } from "../../../shared/constants/signature-types";
import { abis, connect, explainError, readContracts } from "./modules/wallet";
import { campaignCard } from "./modules/campaign-card";
import { HistoryFeed } from "./modules/history";
import { layout } from "./modules/layout";
import { initializeDialogs, openDialog } from "./modules/dialog";
import { UserError } from "./shared/user-error";

const root = document.querySelector<HTMLDivElement>("#app")!;
root.innerHTML = layout;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const history = new HistoryFeed(el("events"), el<HTMLButtonElement>("more-events"), el<HTMLButtonElement>("new-activity"));
let config: PublicConfig | undefined;
let provider: BrowserProvider | undefined;
let signer: JsonRpcSigner | undefined;
let busy = false;
let refreshing: Promise<void> | undefined;
let offset = 0;
let activeTab = "campaigns";
let selectedCampaign = 0;
let paused = false;
let campaigns: Campaign[] = [];
let campaignRevision = "";
let accountRevision = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

initializeDialogs();
const creatorAccess = new CreatorAccess({
  ownAddress: async () => (await wallet()).getAddress(),
  readAccess: async address => {
    if (!provider || !config) throw new UserError("Підключіть гаманець, щоб перевірити доступ.");
    return Boolean(await new Contract(config.contracts.registry, abis.registry, provider).isCreator(address));
  },
  changeAccess: async (address, enabled) => {
    const connected = await wallet();
    const registry = new Contract(config!.contracts.registry, abis.registry, connected);
    await transaction("registry", enabled ? "grantRole" : "revokeRole", [await registry.CREATOR_ROLE(), address]);
  },
  run: action => { void perform(action); },
  notify: message => status(message, "success")
});
function hideStatus() {
  clearTimeout(toastTimer);
  const notification = el("status");
  if (notification.matches(":popover-open")) notification.hidePopover();
  notification.hidden = true;
}
function status(message: string, kind = "info") {
  clearTimeout(toastTimer);
  const notification = el("status");
  if (notification.matches(":popover-open")) notification.hidePopover();
  notification.hidden = false;
  notification.showPopover();
  el("status").className = `toast toast-${kind}`;
  el("status-text").textContent = message;
  toastTimer = setTimeout(hideStatus, NOTIFICATION_DURATIONS_MS[kind] ?? NOTIFICATION_DURATIONS_MS.info);
}
async function updateAccount() {
  if (!provider || !signer || !config) return;
  const revision = accountRevision;
  const contracts = readContracts(config, provider);
  const address = await signer.getAddress();
  const [balance, nativeBalance, moderator, platformPaused] = await Promise.all([contracts.token.balanceOf(address), provider.getBalance(address), contracts.registry.isModerator(address), contracts.crowdfunding.paused()]);
  if (revision !== accountRevision) return;
  el("connect").querySelector("span")!.textContent = "Мій гаманець";
  el("manage").hidden = !moderator;
  if (!moderator && el<HTMLDialogElement>("manage-dialog").open) el<HTMLDialogElement>("manage-dialog").close();
  el("account-address").textContent = `${address.slice(0, 6)}…${address.slice(-4)}`;
  el("account-reward").textContent = `${amount(balance.toString())} CFR`;
  el("account-eth").textContent = `${amount(nativeBalance.toString())} ETH`;
  paused = Boolean(platformPaused);
  el("pause-notice").hidden = !paused;
  el("toggle-pause").textContent = paused ? "Відновити приймання" : "Призупинити";
}
async function wallet() {
  if (!config) throw new UserError("Сервіс тимчасово недоступний. Спробуйте трохи пізніше.");
  if (!signer || !provider) {
    const connected = await connect(config);
    provider = connected.provider;
    signer = connected.signer;
  }
  await updateAccount();
  return signer;
}
async function perform(action: () => Promise<unknown>) {
  if (busy) return;
  busy = true;
  root.setAttribute("aria-busy", "true");
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("dialog button[type=submit], #support button, #grant, #toggle-pause"));
  buttons.forEach(button => { button.disabled = true; });
  try { await action(); }
  catch (error) { status(explainError(error), "error"); }
  finally { busy = false; buttons.forEach(button => { button.disabled = false; }); root.removeAttribute("aria-busy"); creatorAccess.refreshButtons(); }
}
async function transaction(contract: keyof typeof abis, method: string, args: unknown[] = []) {
  const connected = await wallet();
  status("Підтвердіть дію у гаманці.");
  const instance = new Contract(config!.contracts[contract], abis[contract], connected);
  const tx = await instance[method](...args);
  status("Очікуємо підтвердження. Це може зайняти трохи часу.");
  await tx.wait();
  status("Готово. Зміни збережено.", "success");
  await Promise.allSettled([refreshCampaigns(), updateAccount(), history.checkForUpdates()]);
}
async function refreshCampaigns() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const requestedOffset = offset;
    const revision = accountRevision;
    const address = await signer?.getAddress();
    const page = await api<{ items: Campaign[]; total: number }>(`/campaigns?offset=${requestedOffset}&limit=${CAMPAIGN_PAGE_SIZE}`);
    if (revision !== accountRevision || requestedOffset !== offset) return;
    campaigns = page.items;
    const participation = address ? await Promise.all(campaigns.map(campaign => api<CampaignParticipation>(`/campaigns/${campaign.id}/contributors/${address}`))) : [];
    if (revision !== accountRevision) return;
    const nextRevision = JSON.stringify({ campaigns, participation, address, ended: campaigns.map(campaign => campaign.deadline * 1000 <= Date.now()) });
    if (nextRevision !== campaignRevision) {
      campaignRevision = nextRevision;
      el("campaigns").innerHTML = campaigns.length ? campaigns.map((campaign, index) => campaignCard(campaign, address, participation[index])).join("") : '<div class="empty-state"><h3>Зборів поки немає</h3><p>Натисніть «Створити збір», щоб додати перший.</p></div>';
    }
    el("campaign-pagination").hidden = !page.total || page.total <= CAMPAIGN_PAGE_SIZE;
    el<HTMLButtonElement>("previous").disabled = offset === 0;
    el<HTMLButtonElement>("next").disabled = offset + CAMPAIGN_PAGE_SIZE >= page.total;
  })().finally(() => { refreshing = undefined; });
  return refreshing;
}
function changeTab(tab: string) {
  activeTab = tab;
  for (const name of ["campaigns", "history"]) {
    const selected = name === tab;
    el(`${name}-panel`).hidden = !selected;
    el(`${name}-tab`).classList.toggle("active", selected);
    el(`${name}-tab`).setAttribute("aria-selected", String(selected));
    el(`${name}-tab`).tabIndex = selected ? 0 : -1;
  }
  if (tab === "history") void perform(() => history.show());
}
function campaignInput() {
  const form = el<HTMLFormElement>("create");
  const data = new FormData(form);
  const title = String(data.get("title")).trim();
  let goal: bigint;
  try { goal = parseEther(String(data.get("goal"))); }
  catch { throw new UserError("Введіть коректну суму збору в ETH."); }
  const deadline = Math.floor(new Date(String(data.get("deadline"))).getTime() / 1000);
  if (!title || toUtf8Bytes(title).length > 120) throw new UserError("Введіть коротшу назву збору.");
  if (goal <= 0n) throw new UserError("Сума збору має бути більшою за нуль.");
  if (!Number.isFinite(deadline) || deadline <= Date.now() / 1000) throw new UserError("Оберіть дату завершення в майбутньому.");
  if (deadline > (Date.now() + CAMPAIGN_DURATION_MS) / 1000) throw new UserError("Оберіть дату завершення в межах найближчих 365 днів.");
  return { title, goal, deadline, sponsored: data.has("sponsored") };
}
async function createSponsored(input: ReturnType<typeof campaignInput>) {
  const connected = await wallet();
  const creator = await connected.getAddress();
  const instance = new Contract(config!.contracts.crowdfunding, abis.crowdfunding, connected);
  const nonce = await instance.nonces(creator);
  const expiresAt = Math.floor(Date.now() / 1000) + 600;
  status("Підпишіть створення збору у гаманці. Комісію покриє платформа.");
  const signature = await connected.signTypedData({ name: "Crowdfunding", version: "1", chainId: config!.chainId, verifyingContract: config!.contracts.crowdfunding }, CREATE_CAMPAIGN_TYPES, { creator, titleHash: keccak256(toUtf8Bytes(input.title)), goal: input.goal, deadline: input.deadline, nonce, expiresAt });
  const result = await api<{ transactionHash: string }>("/relay/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creator, title: input.title, goal: input.goal.toString(), deadline: input.deadline, expiresAt, signature }) });
  status("Створюємо ваш збір. Очікуємо підтвердження.");
  const receipt = await provider!.waitForTransaction(result.transactionHash, 1, 120000);
  if (!receipt || receipt.status !== 1) throw new UserError("Створення ще не підтверджено. Перевірте список зборів трохи пізніше.");
  status("Збір створено. Комісію покрила платформа.", "success");
  await refreshCampaigns();
}
el("dismiss-status").onclick = hideStatus;
el("open-create").onclick = () => openDialog("create-dialog");
el("manage").onclick = () => void perform(() => creatorAccess.open());
el("connect").onclick = () => void perform(async () => {
  if (signer) { await updateAccount(); openDialog("account-dialog"); }
  else { await wallet(); await refreshCampaigns(); status("Гаманець підключено.", "success"); }
});
for (const name of ["campaigns", "history"]) el(`${name}-tab`).onclick = () => changeTab(name);
document.querySelector(".tabs")!.addEventListener("keydown", event => {
  const key = (event as KeyboardEvent).key;
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return;
  event.preventDefault();
  const name = key === "Home" ? "campaigns" : key === "End" ? "history" : activeTab === "campaigns" ? "history" : "campaigns";
  changeTab(name);
  el(`${name}-tab`).focus();
});
el("previous").onclick = () => void perform(async () => { offset = Math.max(0, offset - CAMPAIGN_PAGE_SIZE); await refreshCampaigns(); });
el("next").onclick = () => void perform(async () => { offset += CAMPAIGN_PAGE_SIZE; await refreshCampaigns(); });
el("more-events").onclick = () => void perform(() => history.load());
el("new-activity").onclick = () => void perform(() => history.load(true));
el<HTMLFormElement>("create").onsubmit = event => {
  event.preventDefault();
  void perform(async () => {
    const input = campaignInput();
    if (input.sponsored && config?.relayEnabled) await createSponsored(input);
    else await transaction("crowdfunding", "createCampaign", [input.title, input.goal, input.deadline]);
    el<HTMLDialogElement>("create-dialog").close();
    el<HTMLFormElement>("create").reset();
    offset = 0;
    changeTab("campaigns");
    await refreshCampaigns();
  });
};
el("campaigns").addEventListener("click", event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-action]");
  if (!button) return;
  const id = Number(button.closest<HTMLElement>("[data-id]")!.dataset.id);
  if (button.dataset.action === "support") {
    selectedCampaign = id;
    el("support-title").textContent = campaigns.find(campaign => campaign.id === id)?.title || "";
    el<HTMLFormElement>("support").reset();
    openDialog("support-dialog");
    return;
  }
  void perform(() => transaction("crowdfunding", button.dataset.action!, [id]));
});
el<HTMLFormElement>("support").onsubmit = event => {
  event.preventDefault();
  void perform(async () => {
    let value: bigint;
    try { value = parseEther(String(new FormData(el<HTMLFormElement>("support")).get("amount"))); }
    catch { throw new UserError("Введіть коректну суму внеску."); }
    if (value <= 0n) throw new UserError("Сума внеску має бути більшою за нуль.");
    await transaction("crowdfunding", "contribute", [selectedCampaign, { value }]);
    el<HTMLDialogElement>("support-dialog").close();
  });
};
el("toggle-pause").onclick = () => void perform(() => transaction("crowdfunding", paused ? "unpause" : "pause"));
window.ethereum?.on("accountsChanged", () => {
  accountRevision++;
  creatorAccess.reset();
  signer = undefined;
  provider?.destroy();
  provider = undefined;
  el("connect").querySelector("span")!.textContent = "Підключити гаманець";
  el("manage").hidden = true;
  if (el<HTMLDialogElement>("manage-dialog").open) el<HTMLDialogElement>("manage-dialog").close();
  if (el<HTMLDialogElement>("account-dialog").open) el<HTMLDialogElement>("account-dialog").close();
  void restoreWallet();
});
window.ethereum?.on("chainChanged", () => location.reload());
async function restoreWallet() {
  if (window.ethereum && config) {
    const accounts = await window.ethereum.request({ method: "eth_accounts" }) as string[];
    if (accounts.length) {
      try {
        const connected = await connect(config, false);
        provider = connected.provider;
        signer = connected.signer;
        await updateAccount();
      } catch { status("Перевірте вибрану мережу у гаманці, щоб продовжити.", "error"); }
    }
  }
  await refreshCampaigns();
}
async function initialize() {
  config = await api<PublicConfig>("/config");
  el("sponsor-option").hidden = !config.relayEnabled;
  await restoreWallet();
  const stream = new EventSource("/api/events/stream");
  stream.onmessage = () => {
    void refreshCampaigns().catch(() => {});
    if (activeTab === "history") void history.checkForUpdates().catch(() => {});
    if (signer) void updateAccount().catch(() => {});
    void creatorAccess.refresh().catch(() => {});
  };
  window.addEventListener("beforeunload", () => stream.close());
  setInterval(() => {
    if (activeTab === "campaigns") void refreshCampaigns().catch(() => {});
    else void history.checkForUpdates().catch(() => {});
  }, CAMPAIGN_REFRESH_INTERVAL_MS);
}
void initialize().catch(() => {
  el("campaigns").innerHTML = '<div class="empty-state"><h3>Не вдалося завантажити збори</h3><p>Спробуйте оновити сторінку трохи пізніше.</p></div>';
  status("Зараз не вдається з’єднатися із сервісом. Спробуйте ще раз пізніше.", "error");
});
