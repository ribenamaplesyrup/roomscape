import { defineConfig } from "vitest/config";

export default defineConfig({
  root: "src/client",
  publicDir: "../../public",
  server: {
    host: "127.0.0.1",
    port: 5173,
    fs: {
      allow: ["../.."],
    },
  },
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
  test: {
    globals: true,
    environment: "node",
    include: ["../../test/**/*.test.ts"],
  },
});
