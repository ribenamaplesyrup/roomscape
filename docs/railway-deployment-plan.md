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

## 3. Deploy Interim Single-Instance Railway App

Use the current Docker/Railway config with volume-backed JSON storage.

Testable outcomes:

- Railway deploy succeeds from `codex/railway-deployment-work`.
- `/api/health` returns `200`.
- Landing page loads over the Railway public URL.
- `ROOMSCAPE_DATA_DIR=/data` points to a mounted Railway volume.

## 4. Verify Current Auth Behavior on Railway

Confirm whether Codex local app-server auth works in Railway. This is expected to be unsuitable for public users, but the behavior should be verified explicitly.

Testable outcomes:

- Sign-in either works and creates a session, or fails with a clear error.
- Unauthenticated users cannot access `/api/rooms`, `/api/active-room`, or `/api/agent/runs`.
- Result is documented in `docs/railway.md`.

## 5. Replace Local Codex Auth With Web-Safe Auth

Pick and integrate a production auth provider such as Auth.js, Clerk, GitHub OAuth, Google OAuth, or an official OpenAI/ChatGPT OAuth path if available for this use case.

Testable outcomes:

- Users can log in on Railway without local Codex.
- Session cookie is secure in production.
- User identity has a stable provider account id.
- Auth tests cover login, logout, session lookup, and unauthorized API access.

## 6. Introduce PostgreSQL Data Store

Replace JSON storage with a Railway PostgreSQL-backed store for users, sessions, rooms, and active room state.

Testable outcomes:

- `DATABASE_URL` enables the PostgreSQL store.
- App starts successfully with Railway Postgres attached.
- JSON store still works for local/dev fallback if kept.
- Repository tests pass against memory and Postgres-backed stores.
- Data survives redeploys.

## 7. Add Migrations

Add a migration runner for schema creation and future changes.

Testable outcomes:

- Fresh Postgres database initializes automatically or via `npm run migrate`.
- Re-running migrations is safe.
- Tables exist for `users`, `sessions`, `rooms`, `active_rooms`, and later `world_versions`.

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
