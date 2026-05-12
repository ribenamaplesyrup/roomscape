import { createServer } from "node:http";
import path from "node:path";
import { createServer as createViteServer } from "vite";
import { AgentRunBus } from "./agent/architectRunner";
import { CodexSdkArchitectRunner } from "./agent/codexArchitectRunner";
import { CodexAppServerClient } from "./codex/appServerClient";
import { RoomCodeRepository } from "./agent/roomCodeRepository";
import { createApp } from "./http/app";
import { createDataStore } from "./storage/createDataStore";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";
const hmrPort = Number(process.env.VITE_HMR_PORT ?? port + 10_000);
const cwd = process.cwd();
const vite = process.env.NODE_ENV === "production"
  ? undefined
  : await createViteServer({
      server: { middlewareMode: true, hmr: { port: hmrPort } },
      appType: "spa",
      root: path.join(cwd, "src/client"),
    });

const store = createDataStore(cwd, process.env);
const roomCode = new RoomCodeRepository(path.join(cwd, "sandbox/rooms/active"));
const runner = new CodexSdkArchitectRunner(roomCode);
const bus = new AgentRunBus();
const codex = new CodexAppServerClient();
const staticRoot = path.join(cwd, "dist/client");
const app = createApp({ store, runner, bus, roomCode, codex, ...(vite ? { vite } : { staticRoot }) });

createServer((req, res) => {
  app(req, res);
}).listen(port, host, () => {
  console.log(`Roomscape running at http://${host}:${port}`);
});
