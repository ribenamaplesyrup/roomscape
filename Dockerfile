FROM node:22-bookworm-slim

WORKDIR /workspace

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV HOST=0.0.0.0
ENV PORT=8788
ENV VITE_HMR_PORT=18788

EXPOSE 8788 18788

CMD ["npm", "run", "dev"]
