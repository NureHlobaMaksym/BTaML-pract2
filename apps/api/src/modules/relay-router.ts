import { Router } from "express";
import { Contract, isAddress, AbstractProvider, Wallet } from "ethers";
import { z } from "zod";
import { ApiError } from "../shared/api-error";
import { contractArtifacts } from "../shared/contract-artifacts";

export function relayRouter(provider: AbstractProvider, address: string, key?: string) {
  const router = Router();
  const contract = key ? new Contract(address, contractArtifacts.crowdfunding.abi, new Wallet(key, provider)) : undefined;
  let busy = false;
  const attempts = new Map<string, number>();
  router.post("/campaigns", async (req, res) => {
    if (!contract) throw new ApiError(503, "Релеєр не налаштований");
    const body = z.object({ creator: z.string().refine(isAddress), title: z.string().min(1).refine(value => Buffer.byteLength(value) <= 120), goal: z.string().regex(/^[1-9][0-9]{0,76}$/), deadline: z.number().int().positive(), expiresAt: z.number().int().positive(), signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) }).strict().parse(req.body);
    const now = Date.now();
    const creator = body.creator.toLowerCase();
    if (busy || now - (attempts.get(creator) || 0) < 60000) throw new ApiError(429, "Повторіть спробу за хвилину");
    if (attempts.size > 1000) for (const [account, timestamp] of attempts) if (now - timestamp > 60000) attempts.delete(account);
    busy = true;
    try {
      const args = [body.creator, body.title, body.goal, body.deadline, body.expiresAt, body.signature];
      await contract.createCampaignBySignature.staticCall(...args);
      const tx = await contract.createCampaignBySignature(...args);
      attempts.set(creator, now);
      res.status(202).json({ transactionHash: tx.hash });
      await tx.wait();
    } finally { busy = false; }
  });
  return router;
}
