FROM node:22-bookworm-slim

WORKDIR /workspace

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npm run build

ENV HOST=0.0.0.0
ENV PORT=8787
ENV NODE_ENV=production

EXPOSE 8787

CMD ["npm", "start"]
