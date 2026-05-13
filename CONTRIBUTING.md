# Contributing To Roomscape

Roomscape favors small, testable slices. A good change explains the user-visible behavior, keeps the sandbox boundary intact, and includes enough tests for the risk it introduces.

## Local Setup

```bash
npm install
npm run test
npm run dev
```

Open `http://127.0.0.1:8787`.

For Docker:

```bash
docker compose up --build
```

Open `http://127.0.0.1:8788`.

## Workflow

1. Read [README.md](README.md), [docs/architecture.md](docs/architecture.md), and the relevant code before editing.
2. Write or update tests first when changing behavior.
3. Keep generated room code concerns inside the active generated-room workspace and trusted app concerns inside `src/server` or `src/client`.
4. Keep runtime data/workspace path rules in `src/server/config/paths.ts`.
5. Run the focused tests, then `npm run test`.
6. Run `npm run build` for changes that touch shared contracts, server bootstrap, Vite config, or generated scene typing.

## Code Style

- TypeScript modules use ESM.
- Prefer plain functions/classes and explicit data contracts over new abstractions.
- Keep comments useful and rare; explain policy or non-obvious constraints.
- Use shared types from `src/shared` for client/server contracts.
- Keep UI text concise and user-facing.

## Sandbox And Security Expectations

Roomscape's core safety property is that the live Codex runner can edit only the active generated-room workspace. Changes that affect this area need extra care:

- Preserve the active generated-room workspace as the live working directory. The checked-in starter sandbox is `sandbox/rooms/active`.
- Keep `workspace-write` sandboxing, no extra writable roots, and network disabled unless the architecture intentionally changes.
- Convert path escapes and sandbox denials into permission-request events.
- Validate generated scene source before promotion to `activeRoomScene.ts`.
- Keep authentication and saved-room ownership checks on the server.

## Pull Request Checklist

- Tests cover the behavior or policy changed.
- `npm run test` passes.
- `npm run build` passes for type-affecting changes.
- Docs are updated when contracts, commands, routes, or sandbox rules change.
- Saved data under `.roomscape/`, build output under `dist/`, and dependencies under `node_modules/` are not committed.
