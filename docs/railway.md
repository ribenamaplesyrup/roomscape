# Railway Deployment Notes

Roomscape can run on Railway as a single Node web service, but the current app is still closer to a local prototype than a fully multi-tenant production service.

## Current Deployment

- Project: `roomscape`
- Service: `roomscape`
- Environment: `production`
- Public URL: `https://roomscape-production.up.railway.app`
- Deployment ID: `1dcb5e6c-6e73-4967-ab5b-6f24b7de1628`
- Status: deployed successfully on May 12, 2026.

Smoke checks:

- `GET /api/health`: `200 {"ok":true}`
- `GET /`: `200 text/html`
- `GET /api/rooms` without a session: `401 {"error":"Authentication required."}`

## Service

- Deploy from the repository root.
- Railway will use `railway.json` and the root `Dockerfile`.
- The app listens on `process.env.PORT` and defaults to `0.0.0.0`, which allows Railway to route public traffic to it.
- Configure Railway's healthcheck path as `/api/health` if you override the checked-in config.
- Keep the checked-in `.dockerignore` in place so local data, build output, dependencies, and Git metadata are not copied into the image.

## Runtime Variables

- `PORT`: injected by Railway.
- `HOST`: optional; defaults to `0.0.0.0`.
- `ROOMSCAPE_DATA_DIR`: optional directory for the JSON store, for example `/data` when a Railway volume is mounted there.
- `ROOMSCAPE_DATA_PATH`: optional full path to the JSON store. Takes precedence over `ROOMSCAPE_DATA_DIR`.
- `DATABASE_URL`: reserved for the upcoming PostgreSQL-backed store. If this is set today, Roomscape fails on startup instead of silently using local JSON storage.

Use `.env.example` as the local template for the interim volume-backed deployment.

## Persistent Data

The current branch still uses `JsonStore`. For a single instance, mount a Railway volume and set:

```text
ROOMSCAPE_DATA_DIR=/data
```

The current Railway service has volume `roomscape-volume` attached to service `roomscape` at `/data`. This keeps `.roomscape/data.json`-style app data outside the container filesystem. This is acceptable for a small private deployment, but it is not the final shape for user-isolated hosted Roomscape. Do not attach Railway PostgreSQL yet unless the server has a PostgreSQL `DataStore`; the app intentionally fails when `DATABASE_URL` is present so it does not look multi-tenant while still writing JSON.

## User Isolation

Saved rooms are scoped by `userId` in the storage layer, but production deployment still needs two larger changes before Roomscape should be considered safely multi-tenant:

1. Replace `JsonStore` with a database-backed store, preferably Railway PostgreSQL.
2. Remove the shared `sandbox/rooms/active` runtime workspace from request handling. Generated room scene state should be stored per user/world, and each agent run should use a temporary per-run workspace.

The target production model should be:

- `users`: stable auth provider account id.
- `sessions`: cookie session mapped to one user.
- `rooms` or `worlds`: owned by one user.
- `world_versions`: immutable scene/config snapshots.
- `active_world_state`: current scene/config for one user and one world.

Every room/world query should include the authenticated user's id, and every agent run should carry `userId`, `worldId`, and `runId`.

## Next Implementation Steps

1. Deploy and test hosted ChatGPT device-code auth on Railway with a real ChatGPT account.
2. Add a PostgreSQL `DataStore` and migration path for `users`, `sessions`, and `rooms`.
3. Move `activeConfig` out of process memory and into user/world scoped storage.
4. Replace `sandbox/rooms/active` with temporary per-run workspaces and persisted per-world scene source.

## ChatGPT Auth

Roomscape uses Codex-managed ChatGPT auth rather than GitHub, username/password, or user-supplied API keys.

Local development can still use the browser callback flow. Railway production defaults to the official Codex device-code flow: `POST /api/auth/chatgpt/start` returns `verificationUrl` and `userCode`, then the frontend sends the user to `https://auth.openai.com/codex/device` and polls completion.

Some ChatGPT accounts require enabling device-code authorization for Codex in ChatGPT Security Settings before the OpenAI device page will accept the code. After enabling that setting, return to Roomscape and start sign-in again to generate a fresh code.

Completed hosted logins are stored under a per-user Codex auth reference in `ROOMSCAPE_CODEX_AUTH_DIR`, defaulting to `${ROOMSCAPE_DATA_DIR}/codex-auth`. Agent runs receive that user's `CODEX_HOME`, so Codex SDK edits are not powered by a single global Railway account.

Key environment variables:

- `ROOMSCAPE_DATA_DIR=/data`
- `ROOMSCAPE_CHATGPT_LOGIN_FLOW=device_code`
- `ROOMSCAPE_CODEX_AUTH_DIR=/data/codex-auth`
