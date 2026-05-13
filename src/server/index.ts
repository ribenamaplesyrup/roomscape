import { createServer } from "node:http";
import path from "node:path";
import { createServer as createViteServer } from "vite";
import { AgentRunBus } from "./agent/architectRunner";
import { CodexSdkArchitectRunner } from "./agent/codexArchitectRunner";
import { roomscapeWorkspaceRoot } from "./config/paths";
import { CodexUserAuthCoordinator, chatGptLoginFlow, roomscapeCodexAuthRoot } from "./codex/userAuthCoordinator";
import { createApp } from "./http/app";
import { createDataStore } from "./storage/createDataStore";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
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
const bus = new AgentRunBus();
const codex = new CodexUserAuthCoordinator({
  authRoot: roomscapeCodexAuthRoot(cwd, process.env),
  loginFlow: chatGptLoginFlow(process.env),
});
const staticRoot = path.join(cwd, "dist/client");
const app = createApp({
  store,
  runnerFactory: (roomCode) => new CodexSdkArchitectRunner(roomCode),
  bus,
  workspaceRoot: roomscapeWorkspaceRoot(cwd, process.env),
  codex,
  ...(vite ? { vite } : { staticRoot }),
});

createServer((req, res) => {
  app(req, res);
}).listen(port, host, () => {
  console.log(`Roomscape running at http://${host}:${port}`);
});
