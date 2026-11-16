import type { Activity } from "../../../../shared/interfaces/activity";
import { DEFAULT_PAGE_SIZE } from "../../../../shared/constants/pagination";
import { api } from "../shared/api";
import { amount, date, escape } from "../shared/format";

export class HistoryFeed {
  private items: Activity[] = [];
  private offset = 0;
  private total = 0;
  private loading = false;
  private initialized = false;
  private stale = false;
  constructor(private readonly container: HTMLElement, private readonly more: HTMLButtonElement, private readonly updates: HTMLButtonElement) {}
  async show() { if (!this.initialized) await this.load(true); }
  async load(reset = false) {
    if (this.loading) return;
    this.loading = true;
    this.more.disabled = true;
    this.more.textContent = "Завантажуємо…";
    if (!this.initialized) this.container.innerHTML = '<div class="loading-state">Завантажуємо історію…</div>';
    try {
      const page = await api<{ items: Activity[]; total: number }>(`/events/activity?offset=${reset ? 0 : this.offset}&limit=${DEFAULT_PAGE_SIZE}`);
      if (reset) { this.items = []; this.offset = 0; this.stale = false; this.updates.hidden = true; }
      this.total = page.total;
      this.offset += page.items.length;
      const ids = new Set(this.items.map(item => item.id));
      this.items.push(...page.items.filter(item => !ids.has(item.id)));
      this.initialized = true;
      this.render(reset);
    } catch (error) {
      if (!this.initialized) this.container.innerHTML = '<div class="empty-state"><h3>Історія поки недоступна</h3><p>Спробуйте оновити її трохи пізніше.</p></div>';
      throw error;
    } finally {
      this.loading = false;
      this.more.disabled = false;
      this.more.textContent = "Показати ще";
      this.more.hidden = this.stale || this.offset >= this.total;
    }
  }
  async checkForUpdates() {
    if (!this.initialized || this.loading) return;
    const page = await api<{ items: Activity[]; total: number }>(`/events/activity?offset=0&limit=${DEFAULT_PAGE_SIZE}`);
    if (page.items[0]?.id === this.items[0]?.id && page.total === this.total) return;
    if (this.offset <= DEFAULT_PAGE_SIZE) {
      this.items = page.items;
      this.offset = page.items.length;
      this.total = page.total;
      this.render();
      this.more.hidden = this.offset >= this.total;
    } else {
      this.stale = true;
      this.updates.hidden = false;
      this.more.hidden = true;
    }
  }
  private render(resetScroll = false) {
    const scrollTop = resetScroll ? 0 : this.container.scrollTop;
    this.container.innerHTML = this.items.map(item => `<article class="activity"><span class="activity-icon activity-${item.kind}" aria-hidden="true">${item.kind === "support" ? "+" : item.kind === "refund" ? "↶" : item.kind === "launch" ? "+" : "✓"}</span><div class="activity-copy"><h3>${escape(item.title)}</h3><p>${escape(item.campaignTitle)}</p></div><div class="activity-meta">${item.amount ? `<strong>${item.amountLabel ? `<small>${escape(item.amountLabel)}</small> ` : ""}${amount(item.amount)} <span>${escape(item.currency || "ETH")}</span></strong>` : ""}${item.timestamp ? `<time datetime="${new Date(item.timestamp * 1000).toISOString()}">${date(item.timestamp)}</time>` : ""}</div></article>`).join("") || '<div class="empty-state history-empty"><h3>Історія поки порожня</h3><p>Тут відображатимуться створення зборів, внески та виплати.</p></div>';
    this.container.scrollTop = scrollTop;
  }
}
