# Roomscape

Roomscape is a browser-based 3D interior co-creation app. Users enter a bare Three.js room, define an AI "Architect" persona, prompt the agent, and watch the room evolve while logs and cost telemetry stream beside the scene.

This repository is intentionally small for the first TDD slice:

- Node/Vite/TypeScript full-stack app.
- Username/password auth with encrypted stored OpenAI credentials.
- File-backed room persistence under `.roomscape/data.json`.
- Active room code sandbox under `sandbox/rooms/active`.
- Agent runner boundary that halts and emits a formal permission request when a path leaves the active room sandbox.
- Three.js first-person room with Vite hot module reload that preserves camera position.

## Run

```bash
npm install
npm run test
npm run dev
```

Then open `http://127.0.0.1:8787`.

## Development Notes

The first live agent adapter is deliberately narrow. The official OpenAI docs recommend keeping the trusted harness outside the sandbox while the sandbox owns file and command execution. Roomscape follows that split: auth, credentials, approvals, audit, persistence, and telemetry live in the app server; agent writes are constrained to `sandbox/rooms/active`.
