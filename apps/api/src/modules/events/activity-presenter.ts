import type { IndexedEvent } from "../../../../../shared/interfaces/indexed-event";
import type { Activity } from "../../../../../shared/interfaces/activity";
import { ACTIVITY_EVENTS } from "../../../../../shared/constants/activity-events";

export function presentActivity(event: IndexedEvent, campaignTitle: string): Activity {
  const definition = ACTIVITY_EVENTS[event.name as keyof typeof ACTIVITY_EVENTS];
  if (!definition) throw new Error("Непідтримувана подія історії");
  const activity: Activity = { id: event.id, title: definition.title, kind: definition.kind, campaignTitle, timestamp: event.timestamp };
  if (event.name === "CampaignFinalized") {
    activity.title = event.args.state === "1" ? "Ціль збору досягнуто" : "Збір завершено без досягнення цілі";
    activity.kind = event.args.state === "1" ? "success" : "closed";
  }
  if (event.args.amount || event.name === "CampaignCreated") {
    activity.amount = event.args.amount || event.args.goal;
    activity.currency = event.name === "RewardClaimed" ? "CFR" : "ETH";
    if (event.name === "CampaignCreated") activity.amountLabel = "Ціль";
  }
  return activity;
}
