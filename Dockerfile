FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY hardhat.config.ts ./
COPY scripts/compile.ts ./scripts/compile.ts
COPY contracts ./contracts
RUN npm run compile && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/artifacts/contracts/CreatorRegistry.sol/CreatorRegistry.json ./artifacts/contracts/CreatorRegistry.sol/
COPY --from=build /app/artifacts/contracts/RewardToken.sol/RewardToken.json ./artifacts/contracts/RewardToken.sol/
COPY --from=build /app/artifacts/contracts/Crowdfunding.sol/Crowdfunding.json ./artifacts/contracts/Crowdfunding.sol/
COPY apps/api/src ./apps/api/src
COPY shared ./shared
COPY scripts/api-sepolia.ts ./scripts/api-sepolia.ts

USER node

EXPOSE 3001

CMD ["node", "--import", "tsx", "scripts/api-sepolia.ts"]
