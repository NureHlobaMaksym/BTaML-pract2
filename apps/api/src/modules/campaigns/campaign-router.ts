import { Router } from "express";
import { z } from "zod";
import { isAddress } from "ethers";
import type { CampaignGateway } from "./campaign-gateway";
import { MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from "../../../../../shared/constants/pagination";
import { ApiError } from "../../shared/api-error";

const pagination = z.object({ offset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0), limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE) });
const idSchema = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export function campaignRouter(service: CampaignGateway) {
  const router = Router();
  router.get("/", async (req, res) => {
    const { offset, limit } = pagination.parse(req.query);
    res.json(await service.page(offset, limit));
  });
  router.get("/:id", async (req, res) => {
    const id = idSchema.parse(req.params.id);
    if (id >= await service.count()) throw new ApiError(404, "Кампанію не знайдено");
    res.json(await service.get(id));
  });
  router.get("/:id/contributors/:address", async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const address = z.string().refine(isAddress).parse(req.params.address);
    if (id >= await service.count()) throw new ApiError(404, "Кампанію не знайдено");
    res.json(await service.account(id, address));
  });
  return router;
}
