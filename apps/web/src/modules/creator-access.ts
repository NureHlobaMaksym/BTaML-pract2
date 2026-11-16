import { getAddress, isAddress, ZeroAddress } from "ethers";
import type { Creator } from "../../../../shared/interfaces/creator";
import type { Page } from "../../../../shared/interfaces/page";
import { DEFAULT_PAGE_SIZE } from "../../../../shared/constants/pagination";
import type { CreatorAccessDependencies } from "../shared/creator-access-dependencies";
import { api } from "../shared/api";
import { escape } from "../shared/format";
import { UserError } from "../shared/user-error";
import { openDialog } from "./dialog";

export class CreatorAccess {
  private readonly dialog = document.getElementById("manage-dialog") as HTMLDialogElement;
  private readonly input = document.getElementById("creator-address") as HTMLInputElement;
  private readonly message = document.getElementById("creator-access-state")!;
  private readonly grant = document.getElementById("grant") as HTMLButtonElement;
  private readonly list = document.getElementById("creator-list")!;
  private readonly more = document.getElementById("more-creators") as HTMLButtonElement;
  private access: boolean | undefined;
  private checkedAddress = "";
  private checking = false;
  private pending = false;
  private loadingList = false;
  private listRequest = 0;
  private revision = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private creators: Creator[] = [];
  private own = "";
  constructor(private readonly dependencies: CreatorAccessDependencies) {
    this.input.addEventListener("input", () => {
      clearTimeout(this.timer);
      this.revision++;
      this.access = undefined;
      this.checkedAddress = "";
      this.message.textContent = this.input.value.trim() ? "Перевіряємо адресу…" : "Введіть адресу гаманця або оберіть автора нижче.";
      this.message.className = "access-state";
      this.refreshButtons();
      this.timer = setTimeout(() => void this.check(), 300);
    });
    document.getElementById("use-own-address")!.onclick = () => this.dependencies.run(async () => {
      this.input.value = await this.dependencies.ownAddress();
      await this.check();
    });
    this.grant.onclick = () => this.dependencies.run(() => this.change(true));
    this.more.onclick = () => this.dependencies.run(() => this.loadList());
    this.list.addEventListener("click", event => {
      const revoke = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-revoke-address]");
      if (revoke && !this.pending) {
        this.dependencies.run(() => this.change(false, revoke.dataset.revokeAddress));
        return;
      }
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-creator-address]");
      if (!button || this.pending) return;
      this.input.value = button.dataset.creatorAddress!;
      void this.check();
    });
    this.refreshButtons();
  }
  async open() {
    openDialog("manage-dialog");
    this.own = await this.dependencies.ownAddress();
    if (!this.input.value.trim()) this.input.value = this.own;
    await Promise.all([this.check(), this.loadList(true)]);
  }
  async refresh() {
    if (!this.dialog.open || this.pending || this.checking) return;
    const address = this.input.value.trim();
    if (isAddress(address) && getAddress(address) !== ZeroAddress) {
      const enabled = await this.dependencies.readAccess(getAddress(address));
      if (address === this.input.value.trim() && enabled !== this.access && !this.pending) await this.check();
    }
    if (this.dialog.open && !this.pending) await this.loadList(true);
  }
  reset() {
    clearTimeout(this.timer);
    this.revision++;
    this.input.value = "";
    this.checkedAddress = "";
    this.access = undefined;
    this.checking = false;
    this.creators = [];
    this.listRequest++;
    this.loadingList = false;
    this.own = "";
    this.refreshButtons();
  }
  refreshButtons() {
    const valid = this.checkedAddress === this.input.value.trim().toLowerCase();
    const blocked = this.pending || document.getElementById("app")?.getAttribute("aria-busy") === "true";
    this.input.disabled = this.pending;
    this.grant.disabled = blocked || this.checking || !valid || this.access !== false;
    this.list.querySelectorAll<HTMLButtonElement>("[data-revoke-address]").forEach(button => { button.disabled = Boolean(blocked); });
    this.grant.textContent = this.pending ? "Очікуємо підтвердження…" : this.access === true && valid ? "Доступ уже надано" : "Дозволити створення зборів";
  }
  private async check() {
    const revision = ++this.revision;
    const input = this.input.value.trim();
    this.access = undefined;
    this.checkedAddress = "";
    this.message.className = "access-state";
    if (!isAddress(input) || getAddress(input) === ZeroAddress) {
      this.checking = false;
      this.message.textContent = input ? "Введіть правильну адресу гаманця." : "Введіть адресу гаманця або оберіть автора нижче.";
      this.refreshButtons();
      return;
    }
    this.checking = true;
    this.message.textContent = "Перевіряємо доступ…";
    this.refreshButtons();
    try {
      const enabled = await this.dependencies.readAccess(getAddress(input));
      if (revision !== this.revision) return;
      this.access = enabled;
      this.checkedAddress = input.toLowerCase();
      this.message.textContent = enabled ? "Доступ уже надано. Цей автор може створювати збори." : "Доступу ще немає. Цьому гаманцю можна дозволити створення зборів.";
      this.message.className = `access-state ${enabled ? "access-enabled" : "access-available"}`;
    } catch {
      if (revision === this.revision) this.message.textContent = "Не вдалося перевірити доступ. Введіть адресу ще раз.";
    } finally {
      if (revision === this.revision) { this.checking = false; this.refreshButtons(); }
    }
  }
  private async change(enabled: boolean, selectedAddress?: string) {
    const input = (selectedAddress ?? this.input.value).trim();
    if (!isAddress(input) || getAddress(input) === ZeroAddress) throw new UserError("Введіть правильну адресу гаманця.");
    const address = getAddress(input);
    this.pending = true;
    this.refreshButtons();
    try {
      const current = await this.dependencies.readAccess(address);
      if (current === enabled) {
        await Promise.all([this.check(), this.loadList(true)]);
        this.dependencies.notify(enabled ? "Цей автор уже має доступ. Повторне підтвердження не потрібне." : "Доступ цього автора вже відкликано.");
        return;
      }
      await this.dependencies.changeAccess(address, enabled);
      if (enabled) {
        this.access = true;
        this.checkedAddress = address.toLowerCase();
        this.dialog.close();
      } else {
        await Promise.all([this.check(), this.loadList(true)]);
      }
      this.dependencies.notify(enabled ? "Автору дозволено створювати збори." : "Доступ автора відкликано.");
    } finally { this.pending = false; this.refreshButtons(); }
  }
  private async loadList(reset = false) {
    if (this.loadingList && !reset) return;
    this.loadingList = true;
    this.more.disabled = true;
    const request = ++this.listRequest;
    if (reset && !this.creators.length) this.list.innerHTML = '<p class="creators-hint">Завантажуємо авторів…</p>';
    try {
      const page = await api<Page<Creator>>(`/creators?offset=${reset ? 0 : this.creators.length}&limit=${DEFAULT_PAGE_SIZE}`);
      if (!this.dialog.open || request !== this.listRequest) return;
      this.creators = reset ? page.items : [...this.creators, ...page.items];
      this.more.hidden = this.creators.length >= page.total;
      const markup = this.creators.map(creator => `<div class="creator-row"><button type="button" class="creator-select" data-creator-address="${escape(creator.address)}"><strong>${creator.address.toLowerCase() === this.own.toLowerCase() ? "Ваш гаманець" : "Автор"}</strong><span class="creator-wallet" title="${escape(creator.address)}">${escape(creator.address.slice(0, 10))}…${escape(creator.address.slice(-8))}</span></button><span class="creator-access-badge">Доступ надано</span><button type="button" class="remove-creator" data-revoke-address="${escape(creator.address)}" aria-label="Відкликати доступ автора ${escape(creator.address)}" title="Відкликати доступ">×</button></div>`).join("") || '<p class="creators-hint">Авторів із доступом поки немає. Можна додати один або кілька гаманців.</p>';
      if (this.list.innerHTML !== markup) this.list.innerHTML = markup;
      this.refreshButtons();
    } catch (error) {
      if (reset && request === this.listRequest) this.list.innerHTML = '<p class="creators-hint">Не вдалося завантажити список авторів. Спробуйте відкрити це вікно ще раз.</p>';
      throw error;
    } finally { if (request === this.listRequest) { this.loadingList = false; this.more.disabled = false; } }
  }
}
