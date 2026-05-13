# Railway Deployment Plan

This checklist tracks the path from the local Roomscape prototype to a Railway deployment where each authenticated user's worlds are isolated from every other user.

## 1. Integrate Latest Main - Complete

Bring `codex/railway-deployment-work` up to date with the latest `main` branch before doing more deployment work.

Testable outcomes:

- Complete: `git fetch origin` succeeded.
- Complete: `git merge origin/main` integrated the latest main branch changes.
- Complete: merge conflict in `src/server/http/app.ts` was resolved by preserving user-scoped active room state while keeping saved-room names in the loaded config.
- Complete: baseline checks in step 2 passed after integration.

## 2. Run Full Baseline Checks - Complete

Establish that the integrated branch is healthy before deeper deployment changes.

Testable outcomes:

- Complete: TypeScript check passes.
- Complete: Test suite passes.
- Complete: Production build passes.
- Complete: no generated scene files are modified by checks.

## 3. Deploy Interim Single-Instance Railway App - Complete

Use the current Docker/Railway config with volume-backed JSON storage.

Testable outcomes:

- Complete: Railway project `roomscape` was created in `Sean Greaves's Projects`.
- Complete: service `roomscape` was deployed from `codex/railway-deployment-work`.
- Complete: `/api/health` returns `200` at `https://roomscape-production.up.railway.app/api/health`.
- Complete: landing page loads over the Railway public URL.
- Complete: `ROOMSCAPE_DATA_DIR=/data` points to attached volume `roomscape-volume`.

## 4. Verify Current Auth Behavior on Railway - Complete

Confirm whether Codex local app-server auth works in Railway. This is expected to be unsuitable for public users, but the behavior should be verified explicitly.

Testable outcomes:

- Complete: unauthenticated `/api/rooms` returns `401`.
- Complete: `/api/auth/chatgpt/start` returns an OpenAI auth URL, but the callback points to local Codex (`http://localhost:1455/auth/callback`), so this is not suitable for hosted users.
- Complete: `/api/auth/chatgpt/existing` returns `202 {"status":"pending"}` on Railway.
- Complete: result is documented in `docs/railway.md`.

## 5. Build ChatGPT-Native Auth - In Progress

Roomscape should authenticate as a ChatGPT/OpenAI-native experience, not with a generic third-party identity provider. Hosted Railway uses Codex app-server's ChatGPT device-code flow so users authenticate through OpenAI without relying on a localhost callback.

Testable outcomes:

- Complete: local ChatGPT/Codex auth remains the only visible sign-in path.
- Complete: GitHub OAuth has been removed from the product path.
- Complete: production defaults to `chatgptDeviceCode` instead of the local callback browser flow.
- Complete: completed logins store a per-user Codex auth ref and agent runs receive that user's `CODEX_HOME`.
- Pending: deploy the device-code flow to Railway and complete a real ChatGPT login from the public URL.
- Pending: verify that User A and User B get distinct Roomscape user ids and isolated worlds on Railway.

## 6. Introduce PostgreSQL Data Store - Complete

Replace JSON storage with a Railway PostgreSQL-backed store for users, sessions, rooms, and active room state.

Testable outcomes:

- Complete: `DATABASE_URL` enables the PostgreSQL store.
- Complete: JSON store still works for local/dev fallback.
- Complete: deployment config tests cover JSON/Postgres selection and Postgres SSL config.
- Pending: app starts successfully with Railway Postgres attached.
- Pending: data survives redeploys after switching production to Postgres.

## 7. Add Migrations - In Progress

Add a migration runner for schema creation and future changes.

Testable outcomes:

- Complete: fresh Postgres database initializes automatically on first read/write.
- Complete: `npm run migrate:postgres` copies the existing JSON snapshot into PostgreSQL.
- Complete: schema creation is idempotent.
- Complete: tables exist for `users`, `sessions`, `rooms`, and `active_rooms`.
- Pending: add explicit versioned migration bookkeeping before adding `world_versions`.

## 8. Fully Isolate World State

Remove shared `sandbox/rooms/active` as the source of truth. Store scene source/config per user/world, then materialize temporary files only during a run.

Testable outcomes:

- User A cannot affect User B's active scene.
- Loading a room updates only that user's active world.
- Agent run reads/writes only that user/world state.
- Tests prove cross-user scene isolation.

## 9. Create Per-Run Workspaces

Each agent run gets a temporary workspace keyed by `userId`, `worldId`, and `runId`.

Testable outcomes:

- Concurrent runs for different users do not share files.
- Cancel/reset cleans only that user's run state.
- Temporary workspaces are deleted or expired safely.
- Sandbox path tests cover user/run workspace boundaries.

## 10. Add Production Environment Validation

Validate required environment variables on startup and fail with readable errors.

Testable outcomes:

- Missing auth secrets fail startup clearly.
- Missing `DATABASE_URL` in production fails unless explicitly using JSON mode.
- `NODE_ENV=production` uses secure cookie settings.

## 11. Railway Production Smoke Tests

Create a repeatable manual or scripted smoke test checklist.

Testable outcomes:

- Healthcheck passes.
- Landing page loads.
- Login works.
- User A creates/saves/loads a world.
- User B cannot see User A's rooms.
- User A and User B can run edits independently.
- Redeploy preserves worlds.

## 12. Open PR and Review Deployment Branch

Merge only after the Railway branch is integrated, tested, and documented.

Testable outcomes:

- PR from `codex/railway-deployment-work` into `main`.
- CI/build checks pass.
- `docs/railway.md` reflects the actual deployed setup.
- No generated scene files are included in the PR.
