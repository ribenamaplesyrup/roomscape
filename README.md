# Roomscape

Roomscape is a browser-based 3D interior co-creation app. Users enter a bare Three.js room, prompt an AI "Architect" agent, and watch the room evolve while logs and cost telemetry stream beside the scene.

The project is intentionally small and direct:

- Node/Vite/TypeScript full-stack app.
- ChatGPT-only entry flow through Codex managed auth.
- ChatGPT-backed local sessions without a separate Roomscape password or API-key flow.
- File-backed room persistence under `.roomscape/data.json`.
- Active room code sandbox under `sandbox/rooms/active`.
- Codex SDK Architect runner scoped to the active room sandbox, with a formal permission request when a path leaves that sandbox.
- Three.js first-person room with Vite hot module reload that preserves camera position.

## Start Here

Use these docs depending on what you are trying to do:

- [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, development workflow, and review expectations.
- [AGENTS.md](AGENTS.md) for AI coding agents working in this repository.
- [docs/development.md](docs/development.md) for commands, runtime details, Docker, data files, and troubleshooting.
- [docs/architecture.md](docs/architecture.md) for system boundaries and trusted/sandboxed responsibilities.
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
src/client/                  Browser app, styles, and Three.js renderer.
src/server/                  HTTP server, auth bridge, storage, and agent runner.
src/shared/                  API and room data contracts shared by client/server.
sandbox/rooms/active/        Codex-editable generated room files.
test/                        Vitest coverage for server, auth, sandbox, renderer behavior.
docs/                        Human and agent reference docs.
```

## Key Constraints

The live agent adapter is deliberately narrow. Roomscape runs Codex through the official TypeScript SDK with `sandbox/rooms/active` as the working directory, `workspace-write` sandboxing, no additional writable directories, and network access disabled. Auth, approvals, audit, persistence, and telemetry stay in the trusted app server; generated room code stays in the active room sandbox.

Generated scene code must keep the browser-facing module contract documented in [docs/room-sandbox.md](docs/room-sandbox.md). The app validates generated scene source before promoting it to `activeRoomScene.ts`, so failures stay recoverable instead of breaking the room.
