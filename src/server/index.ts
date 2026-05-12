import { createServer } from "node:http";
import path from "node:path";
import { createServer as createViteServer } from "vite";
import { DeterministicArchitectRunner, AgentRunBus } from "./agent/architectRunner";
import { RoomCodeRepository } from "./agent/roomCodeRepository";
import { createApp, roomscapeDataPath } from "./http/app";
import { JsonStore } from "./storage/jsonStore";

const port = Number(process.env.PORT ?? 8787);
const cwd = process.cwd();
const vite = process.env.NODE_ENV === "production"
  ? undefined
  : await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
      root: path.join(cwd, "src/client"),
    });

const store = new JsonStore(roomscapeDataPath(cwd));
const roomCode = new RoomCodeRepository(path.join(cwd, "src/client/rooms/active"));
const runner = new DeterministicArchitectRunner(roomCode);
const bus = new AgentRunBus();
const staticRoot = path.join(cwd, "dist/client");
const app = createApp({ store, runner, bus, ...(vite ? { vite } : { staticRoot }) });

createServer((req, res) => {
  app(req, res);
}).listen(port, "127.0.0.1", () => {
  console.log(`Roomscape running at http://127.0.0.1:${port}`);
});
