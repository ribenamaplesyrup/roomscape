# Roomscape Architecture

## Boundaries

Roomscape keeps the trusted harness separate from the room-editing workspace:

- The app server owns authentication, encrypted OpenAI credentials, user rooms, cost tracking, audit logs, and permission approvals.
- The active room sandbox is `sandbox/rooms/active`.
- The agent runner may only read or write inside that active room directory.
- The host app imports the generated room module across an explicit Vite filesystem allow-list, keeping application code and agent-owned code separate while preserving hot reload.
- Any attempted path escape creates a formal permission request and halts the run.

This mirrors the Codex integration guidance: keep the trusted host as the control plane and let the sandbox be the execution plane for generated room files.

## Agent Runner

`CodexSdkArchitectRunner` is the live runner. It uses `@openai/codex-sdk` server-side, starts a Codex thread with `sandbox/rooms/active` as the working directory, passes `workspace-write` sandboxing, disables network access, and does not provide additional writable directories.

The deterministic runner remains available as a test double for fast UI and policy tests.

## Authentication

Roomscape does not maintain a separate username/password account and does not ask users for API keys. Users authenticate with their ChatGPT account through Codex-managed OAuth. Roomscape stores a local user record keyed by a fingerprint of the Codex ChatGPT account id, then asks the user to define an Architect name and description before entering the room.

## Permission Flow

The runner preflights explicit outside-sandbox prompts, validates every streamed Codex file-change path, and converts sandbox or approval failures into `permission-request` events for the UI. Roomscape does not silently expand the sandbox.
