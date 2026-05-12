# Roomscape

Roomscape is a browser-based 3D interior co-creation app. Users enter a bare Three.js room, define an AI "Architect" persona, prompt the agent, and watch the room evolve while logs and cost telemetry stream beside the scene.

This repository is intentionally small for the first TDD slice:

- Node/Vite/TypeScript full-stack app.
- ChatGPT-only entry flow through Codex managed auth.
- Architect setup after authentication with separate name and description fields.
- File-backed room persistence under `.roomscape/data.json`.
- Active room code sandbox under `sandbox/rooms/active`.
- Codex SDK Architect runner scoped to the active room sandbox, with a formal permission request when a path leaves that sandbox.
- Three.js first-person room with Vite hot module reload that preserves camera position.

## Run

```bash
npm install
npm run test
npm run dev
```

Then open `http://127.0.0.1:8787`.

## Entry Flow

Roomscape starts on a distinct landing page. Users authenticate with their ChatGPT account through Codex managed auth. After authentication, the user defines the Architect with a persona name and a separate description before entering the room.

## Development Notes

The first live agent adapter is deliberately narrow. Roomscape runs Codex through the official TypeScript SDK with `sandbox/rooms/active` as the working directory, `workspace-write` sandboxing, no additional writable directories, and network access disabled. Auth, approvals, audit, persistence, and telemetry stay in the trusted app server; generated room code stays in the active room sandbox.
