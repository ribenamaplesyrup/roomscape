import { createServer } from "node:http";
import path from "node:path";
import { createServer as createViteServer } from "vite";
import { DeterministicArchitectRunner, AgentRunBus } from "./agent/architectRunner";
import { CodexAppServerClient } from "./codex/appServerClient";
import { RoomCodeRepository } from "./agent/roomCodeRepository";
import { createApp, roomscapeDataPath } from "./http/app";
import { JsonStore } from "./storage/jsonStore";

const port = Number(process.env.PORT ?? 8787);
const hmrPort = Number(process.env.VITE_HMR_PORT ?? port + 10_000);
const cwd = process.cwd();
const vite = process.env.NODE_ENV === "production"
  ? undefined
  : await createViteServer({
      server: { middlewareMode: true, hmr: { port: hmrPort } },
      appType: "spa",
      root: path.join(cwd, "src/client"),
    });

const store = new JsonStore(roomscapeDataPath(cwd));
const roomCode = new RoomCodeRepository(path.join(cwd, "sandbox/rooms/active"));
const runner = new DeterministicArchitectRunner(roomCode);
const bus = new AgentRunBus();
const codex = new CodexAppServerClient();
const staticRoot = path.join(cwd, "dist/client");
const app = createApp({ store, runner, bus, codex, ...(vite ? { vite } : { staticRoot }) });

createServer((req, res) => {
  app(req, res);
}).listen(port, "127.0.0.1", () => {
  console.log(`Roomscape running at http://127.0.0.1:${port}`);
});
