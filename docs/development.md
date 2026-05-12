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

- `HOST`: server bind host. Defaults to `127.0.0.1`.
- `PORT`: HTTP port. Defaults to `8787`.
- `VITE_HMR_PORT`: Vite HMR websocket port. Defaults to `PORT + 10000`.
- `NODE_ENV=production`: disables Vite middleware and serves `dist/client`.

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

Saved rooms include both the typed `RoomConfig` and the validated generated scene source. Loading a saved room writes the saved scene back into the active sandbox and promotes it after validation.

## Generated Room Files

The active sandbox is:

```text
sandbox/rooms/active/
```

Important files:

- `roomScene.ts`: editable scene source Codex works on.
- `activeRoomScene.ts`: browser-facing scene source after validation.
- `roomConfig.ts`: generated typed room configuration for the older config-based path and reset flow.

See [room-sandbox.md](room-sandbox.md) before changing these contracts.

## Common Troubleshooting

If sign-in fails with "Codex is not available", confirm the Codex CLI is installed and authenticated, then retry.

If the room fails to render after a generated edit, the client falls back to a recovery scene and logs the render error. Inspect `sandbox/rooms/active/roomScene.ts`, run `npm run build`, and check validation failures from the agent log.

If HMR stops updating generated room files, restart `npm run dev`. The Vite config intentionally allows filesystem access back to the repository root so client code can import the active sandbox module.

If tests create local data, remove `.roomscape/` only when you are sure you do not need saved local rooms.
