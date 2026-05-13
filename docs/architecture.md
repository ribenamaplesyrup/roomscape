# Roomscape Architecture

## Boundaries

Roomscape keeps the trusted harness separate from the room-editing workspace:

- The app server owns authentication, hashed account identifiers, remembered-device tokens, user rooms, usage telemetry, audit logs, and permission approvals.
- The repository starter sandbox is `sandbox/rooms/active`; authenticated runtime edits are materialized into per-user workspaces under `ROOMSCAPE_WORKSPACE_DIR`.
- The agent runner may only read or write inside the active generated-room workspace it receives for that run.
- The host app loads validated generated scene source through the trusted server, keeping application code and agent-owned code separate while preserving recoverability.
- Any attempted path escape creates a formal permission request and halts the run.

This mirrors the Codex integration guidance: keep the trusted host as the control plane and let the sandbox be the execution plane for generated room files.

## Agent Runner

`CodexSdkArchitectRunner` is the live runner. It uses `@openai/codex-sdk` server-side, starts a Codex thread in the active generated-room workspace, disables network access, and does not provide additional writable directories. Local development uses Codex `workspace-write` sandboxing. Railway containers do not allow Codex's bubblewrap sandbox, so hosted production can set `ROOMSCAPE_CODEX_SANDBOX_MODE=danger-full-access` while Roomscape still validates streamed file-change paths and generated scene source before promotion.

The deterministic runner remains available as a test double for fast UI and policy tests.

## Authentication

Roomscape does not maintain a separate username/password account and does not ask users for API keys. Users authenticate with their ChatGPT account through Codex-managed OAuth or hosted device-code auth. Roomscape stores a local user record keyed by a fingerprint of the Codex ChatGPT account id, then takes the user directly into the room workspace.

## Permission Flow

The runner preflights explicit outside-sandbox prompts, validates every streamed Codex file-change path, and converts sandbox or approval failures into `permission-request` events for the UI. Roomscape does not silently expand the sandbox.

## Runtime Paths

`src/server/config/paths.ts` is the single source for Roomscape data and workspace paths:

- `ROOMSCAPE_DATA_PATH` points directly at the JSON store.
- `ROOMSCAPE_DATA_DIR` groups JSON data, Codex auth homes, and workspaces.
- `ROOMSCAPE_WORKSPACE_DIR` overrides only generated room workspaces.

Keep new path decisions in that module unless they are specific to one subsystem.
