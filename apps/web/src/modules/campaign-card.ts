import type { Campaign } from "../../../../shared/interfaces/campaign";
import type { CampaignParticipation } from "../shared/campaign-participation";
import { amount, date, escape } from "../shared/format";

export function campaignCard(campaign: Campaign, address?: string, participation?: CampaignParticipation): string {
  const progress = Math.min(Number(BigInt(campaign.raised) * 10000n / BigInt(campaign.goal)) / 100, 100);
  const ended = campaign.deadline * 1000 <= Date.now();
  const active = campaign.state === 0 && !ended;
  const own = address?.toLowerCase() === campaign.creator.toLowerCase();
  const contributed = Boolean(participation && BigInt(participation.contribution) > 0n);
  const label = active ? "Триває збір" : campaign.state === 0 ? "Очікує підсумку" : campaign.state === 2 ? "Збір завершено" : "Ціль досягнуто";
  return `<article class="campaign"><div class="card-top"><span class="state ${active ? "state-active" : campaign.state === 2 ? "state-ended" : "state-success"}"><i></i>${label}</span>${own ? '<span class="own-label">Ваш збір</span>' : ""}</div><h3>${escape(campaign.title)}</h3><p class="campaign-deadline">${active ? "Збираємо до" : "Дата завершення"} ${date(campaign.deadline)}</p><div class="campaign-funding"><strong>${amount(campaign.raised)} <span>ETH</span></strong><span>ціль ${amount(campaign.goal)} ETH</span></div><progress aria-label="Прогрес збору" max="100" value="${progress}"></progress><div class="card-actions" data-id="${campaign.id}">
  ${active ? '<button class="button button-primary full-width" data-action="support">Підтримати збір</button>' : ""}
  ${campaign.state === 0 && ended ? '<button class="button button-outline full-width" data-action="finalize">Підбити підсумки</button>' : ""}
  ${campaign.state === 1 && own ? '<button class="button button-primary full-width" data-action="withdrawFunds">Отримати зібрані кошти</button>' : ""}
  ${campaign.state === 2 && contributed ? '<button class="button button-primary full-width" data-action="refund">Повернути мій внесок</button>' : ""}
  ${(campaign.state === 1 || campaign.state === 3) && contributed && !participation?.rewardClaimed ? '<button class="button button-outline full-width" data-action="claimReward">Отримати винагороду</button>' : ""}
  ${contributed ? `<p class="your-contribution">Ваш внесок: ${amount(participation!.contribution)} ETH${participation!.rewardClaimed ? " · Винагороду отримано" : ""}</p>` : !active && campaign.state === 2 ? '<p class="card-note">Учасники можуть повернути свої внески.</p>' : !active && campaign.state !== 0 ? `<p class="card-note">${campaign.state === 3 ? "Кошти отримано автором." : "Кошти доступні автору збору."}</p>` : ""}</div></article>`;
}
