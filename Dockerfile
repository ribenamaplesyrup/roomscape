FROM node:22-bookworm-slim

WORKDIR /workspace

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npm run build

ENV HOST=0.0.0.0
ENV PORT=8787
ENV NODE_ENV=production

EXPOSE 8787

CMD ["npm", "start"]
