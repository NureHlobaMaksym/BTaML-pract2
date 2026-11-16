import { JsonRpcProvider } from "ethers";
import { config, deployment } from "./config";
import { createApp } from "./app";
import { createDatabasePool } from "./database/pool";
import { migrateDatabase } from "./database/migrate";
import { CampaignService } from "./modules/campaigns/campaign-service";
import { campaignRouter } from "./modules/campaigns/campaign-router";
import { EventIndexer } from "./modules/events/event-indexer";
import { eventRouter } from "./modules/events/event-router";
import { creatorRouter } from "./modules/creators/creator-router";
import { CreatorService } from "./modules/creators/creator-service";
import { relayRouter } from "./modules/relay-router";

async function main() {
  const pool = createDatabasePool();
  const provider = new JsonRpcProvider(config.rpcUrl);
  try {
    await migrateDatabase(pool);
    if (Number((await provider.getNetwork()).chainId) !== deployment.chainId) throw new Error("Chain ID не відповідає розгортанню");
    if ((await provider.getBlock(deployment.blockNumber))?.hash !== deployment.blockHash) throw new Error("Мережу перезапущено. Повторіть розгортання");
    const codes = await Promise.all(Object.values(deployment.contracts).map(address => provider.getCode(address)));
    if (codes.some(code => code === "0x")) throw new Error("Контракт відсутній у мережі");
    const indexer = new EventIndexer(provider, deployment, pool);
    await indexer.initialize();
    const app = createApp(config.origin, campaignRouter(new CampaignService(deployment.contracts.crowdfunding, provider, indexer)), eventRouter(indexer), relayRouter(provider, deployment.contracts.crowdfunding, config.relayKey), { ...deployment, relayEnabled: Boolean(config.relayKey) }, creatorRouter(new CreatorService(indexer, deployment.contracts.registry, provider)));
    const server = app.listen(config.port, config.host, () => console.log(`API: http://localhost:${config.port}`));
    server.on("error", async () => { console.error(`Не вдалося запустити API на порту ${config.port}`); provider.destroy(); await pool.end(); process.exitCode = 1; });
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      server.close(async () => { provider.destroy(); await pool.end(); });
      server.closeAllConnections();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  } catch (error) {
    provider.destroy();
    await pool.end();
    throw error;
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Не вдалося запустити API"); process.exitCode = 1; });
