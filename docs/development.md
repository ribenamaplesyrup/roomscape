# Development

This page is the day-to-day runbook for Roomscape.

## Requirements

- Node.js 22 or compatible modern Node runtime.
- npm.
- Codex CLI available as `codex` for the live ChatGPT auth bridge and live Codex SDK room edits.

## Commands

```bash
npm install
npm run test
npm run test:watch
npm run build
npm run dev
npm run start
```

- `npm run dev` starts the TypeScript server with Vite middleware.
- `npm run start` starts the production server after `npm run build`.
- `npm run build` runs TypeScript checking and builds the Vite client into `dist/client`.
- `npm run test` runs Vitest once.

## Local Server

By default, the app listens on:

```text
http://127.0.0.1:8787
```

Runtime environment variables:

- `HOST`: server bind host. Defaults to `127.0.0.1`; Docker and Railway set `0.0.0.0`.
- `PORT`: HTTP port. Defaults to `8787`.
- `VITE_HMR_PORT`: Vite HMR websocket port. Defaults to `PORT + 10000`.
- `NODE_ENV=production`: disables Vite middleware and serves `dist/client`.
- `ROOMSCAPE_DATA_DIR`: directory for local JSON data, Codex auth homes, and user workspaces. Defaults to `.roomscape`.
- `ROOMSCAPE_DATA_PATH`: full path to the JSON store. Takes precedence over `ROOMSCAPE_DATA_DIR`.
- `ROOMSCAPE_WORKSPACE_DIR`: generated room workspace root. Defaults to `${ROOMSCAPE_DATA_DIR}/workspaces`.
- `ROOMSCAPE_CODEX_AUTH_DIR`: per-user Codex auth root. Defaults to `${ROOMSCAPE_DATA_DIR}/codex-auth`.
- `ROOMSCAPE_CHATGPT_LOGIN_FLOW`: `browser` or `device_code`. Local development defaults to `browser`; production/Railway defaults to `device_code`.
- `DATABASE_URL`: enables PostgreSQL instead of the JSON store.

## Docker

```bash
docker compose up --build
```

Docker serves the app at:

```text
http://127.0.0.1:8788
```

The compose file mounts:

- The repository at `/workspace`.
- Dependencies in the `roomscape_node_modules` volume.
- App data in the `roomscape_data` volume at `/workspace/.roomscape`.

## Data Files

Roomscape stores local data in `.roomscape/data.json`. That file contains local users, sessions, and saved room snapshots. It is ignored by git.

Saved rooms include both the typed `RoomConfig` and the validated generated scene source. Loading a saved room writes the saved scene back into the user's active generated-room workspace and promotes it after validation.

Runtime paths are defined in `src/server/config/paths.ts`. Keep storage and workspace path rules there so HTTP routes, storage setup, tests, and migration scripts do not drift apart.

## Generated Room Files

The starter sandbox checked into the repository is:

```text
sandbox/rooms/active/
```

Important files:

- `roomScene.ts`: editable scene source Codex works on.
- `activeRoomScene.ts`: browser-facing scene source after validation.
- `roomConfig.ts`: generated typed room configuration for the older config-based path and reset flow.

See [room-sandbox.md](room-sandbox.md) before changing these contracts.

At runtime, authenticated users get isolated generated-code workspaces under `ROOMSCAPE_WORKSPACE_DIR`. The checked-in sandbox remains the starter contract and local reference; the data store is the source of truth for each user's active scene.

## Common Troubleshooting

If sign-in fails with "Codex is not available", confirm the Codex CLI is installed and authenticated, then retry.

If the room fails to render after a generated edit, the client falls back to a recovery scene and logs the render error. Inspect the user's active workspace under `ROOMSCAPE_WORKSPACE_DIR`, run `npm run build`, and check validation failures from the agent log. For starter-scene contract issues, inspect `sandbox/rooms/active/roomScene.ts`.

If generated room updates stop appearing, restart `npm run dev` and reload the workspace. The client fetches the validated scene module from `/api/active-room/scene-module`, so the data store and the user's generated-room workspace should agree before debugging Vite.

If tests create local data, remove `.roomscape/` only when you are sure you do not need saved local rooms.
