# Railway Deployment Notes

Roomscape can run on Railway as a single Node web service, but the current app is still closer to a local prototype than a fully multi-tenant production service.

## Service

- Deploy from the repository root.
- Railway will use `railway.json` and the root `Dockerfile`.
- The app listens on `process.env.PORT` and defaults to `0.0.0.0`, which allows Railway to route public traffic to it.
- Configure Railway's healthcheck path as `/api/health` if you override the checked-in config.

## Runtime Variables

- `PORT`: injected by Railway.
- `HOST`: optional; defaults to `0.0.0.0`.
- `ROOMSCAPE_DATA_DIR`: optional directory for the JSON store, for example `/data` when a Railway volume is mounted there.
- `ROOMSCAPE_DATA_PATH`: optional full path to the JSON store. Takes precedence over `ROOMSCAPE_DATA_DIR`.

## Persistent Data

The current branch still uses `JsonStore`. For a single instance, mount a Railway volume and set:

```text
ROOMSCAPE_DATA_DIR=/data
```

This keeps `.roomscape/data.json`-style app data outside the container filesystem. This is acceptable for a small private deployment, but it is not the final shape for user-isolated hosted Roomscape.

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

## ChatGPT Auth Caveat

The current ChatGPT sign-in is mediated through Codex's local app-server bridge. That works for local Codex workflows, but it is not a production web OAuth flow for arbitrary Railway users. Before public deployment, replace it with a web-safe auth provider or an official OpenAI/ChatGPT OAuth mechanism if one is available for this use case.
