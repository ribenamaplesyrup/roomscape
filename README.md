# Roomscape

Roomscape is a browser-based 3D interior co-creation app. Users enter a bare Three.js room, prompt an AI "Architect" agent, and watch the room evolve while logs and usage telemetry stream beside the scene.

The project is intentionally small and direct:

- Node/Vite/TypeScript full-stack app.
- ChatGPT-only entry flow through Codex-managed auth.
- ChatGPT-backed app sessions without a separate Roomscape password or API-key flow.
- JSON persistence under `.roomscape/data.json` by default, with PostgreSQL enabled by `DATABASE_URL`.
- Per-user active room source and config stored in the app data store.
- Per-user generated-code workspaces under `.roomscape/workspaces` by default.
- Codex SDK Architect runner scoped to the active room workspace, with a formal permission request when a path leaves that sandbox.
- Three.js first-person room with generated scene reloads that preserve camera position.

## Start Here

Use these docs depending on what you are trying to do:

- [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, development workflow, and review expectations.
- [AGENTS.md](AGENTS.md) for AI coding agents working in this repository.
- [docs/development.md](docs/development.md) for commands, runtime details, Docker, data files, and troubleshooting.
- [docs/architecture.md](docs/architecture.md) for system boundaries and trusted/sandboxed responsibilities.
- [docs/demo-walkthrough.md](docs/demo-walkthrough.md) for a concise system walkthrough and diagram.
- [docs/room-sandbox.md](docs/room-sandbox.md) for the generated Three.js room contract.
- [docs/api.md](docs/api.md) for HTTP endpoints and server-sent events.
- [docs/testing.md](docs/testing.md) for test coverage and where to add new tests.

## Quick Run

```bash
npm install
npm run test
npm run dev
```

Then open `http://127.0.0.1:8787`.

Useful verification commands:

```bash
npm run test
npm run build
```

For Docker:

```bash
docker compose up --build
```

Then open `http://127.0.0.1:8788`.

## Product Flow

Roomscape starts on a distinct landing page. Users authenticate with their ChatGPT account through Codex managed auth, then enter the room workspace directly.

Inside the workspace, users can:

- Walk the room with first-person controls.
- Prompt the Architect to edit the active Three.js scene.
- Watch run logs, cost telemetry, and permission requests.
- Save the current room scene and load saved rooms later.
- Reset the active room back to a blank starter scene.

## Repository Map

```text
src/client/main.ts                 Browser state, auth flow, room save/load/reset, SSE run events.
src/client/room/RoomRenderer.ts    Three.js renderer, first-person controls, collisions, animation hooks.
src/server/index.ts                Server bootstrap and Vite/static serving setup.
src/server/http/app.ts             HTTP API routes, run queue, active room state, SSE subscriptions.
src/server/config/paths.ts         Runtime paths for local data and per-user workspaces.
src/server/agent/                  Codex runner, generated scene validation, sandbox policy.
src/server/codex/                  Codex app-server auth and rate-limit bridge.
src/server/storage/                JSON/PostgreSQL stores and room repositories.
src/shared/                        API, model, and room contracts shared by client/server.
sandbox/rooms/active/              Starter generated room files and sandbox contract examples.
test/                              Vitest coverage for auth, storage, sandbox, renderer, and runner behavior.
docs/                              Architecture, API, development, testing, deployment, and sandbox docs.
```

## Key Constraints

The live agent adapter is deliberately narrow. Roomscape runs Codex through the official TypeScript SDK in a generated-room workspace, with `workspace-write` sandboxing in local development, no additional writable directories, and network access disabled. Auth, approvals, audit, persistence, and telemetry stay in the trusted app server; generated room code stays in the active generated-room workspace.

Generated scene code must keep the browser-facing module contract documented in [docs/room-sandbox.md](docs/room-sandbox.md). The app validates generated scene source before promoting it to `activeRoomScene.ts`, so failures stay recoverable instead of breaking the room.

## Maintenance Notes

- Keep trusted app code in `src/client`, `src/server`, and `src/shared`; keep generated scene code in the active generated-room workspace.
- Update `src/shared/api.ts` or `src/shared/room.ts` alongside both client and server callers when a contract changes.
- Update [docs/api.md](docs/api.md), [docs/architecture.md](docs/architecture.md), or [docs/room-sandbox.md](docs/room-sandbox.md) whenever routes, boundaries, or the generated scene contract change.
- Run `npm run test` before handoff. Run `npm run build` when touching shared contracts, server bootstrap, generated scene validation, Vite config, or deployment settings.
