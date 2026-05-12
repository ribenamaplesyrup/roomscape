# AGENTS.md

This file is for AI coding agents working on Roomscape. Keep changes small, test the affected behavior, and preserve the trusted-host versus generated-room boundary.

## Project Intent

Roomscape is a browser-based Three.js room co-creation app. The trusted app handles authentication, persistence, telemetry, API routes, and Codex orchestration. The generated room sandbox contains only room scene code that Codex is allowed to edit.

## First Commands

```bash
npm install
npm run test
npm run dev
```

The dev server runs at `http://127.0.0.1:8787` by default.

## Important Paths

- `src/client/main.ts`: UI state, auth flow, room save/load/reset, SSE run events.
- `src/client/room/RoomRenderer.ts`: Three.js renderer, first-person navigation, generated animation hooks, collision collection.
- `src/client/room/sceneTypes.ts`: generated scene module contract.
- `src/server/index.ts`: server bootstrap, Vite middleware, stores, Codex bridge, runner wiring.
- `src/server/http/app.ts`: HTTP API routes, run queue, active room state, SSE subscriptions.
- `src/server/agent/codexArchitectRunner.ts`: live Codex SDK runner and generated-scene prompt/repair policy.
- `src/server/agent/roomCodeRepository.ts`: sandboxed reads/writes and generated scene validation.
- `src/server/agent/sandboxPolicy.ts`: path containment policy.
- `src/server/codex/appServerClient.ts`: Codex app-server auth and rate-limit bridge.
- `src/server/storage/`: file and memory persistence.
- `src/shared/`: client/server type contracts.
- `sandbox/rooms/active/`: generated room config and scene modules.
- `test/`: Vitest tests for contracts and behavior.

## Hard Boundaries

- Do not let agent-authored code edit files outside `sandbox/rooms/active`.
- Do not expand the live Codex runner's writable roots without updating tests and docs.
- Do not move auth, audit, rate limits, persistence, or permission decisions into generated scene code.
- Do not make generated room scenes create renderers, cameras, controls, DOM nodes, network calls, timers, or imports beyond the allowed type-only local import.
- Preserve the generated scene contract:

```ts
export const roomTitle = "Readable title";
export function buildRoom({ THREE, root, scene }: RoomSceneContext): void;
```

## Development Rules Of Thumb

- Prefer the existing direct TypeScript style over adding framework layers.
- Keep shared API changes in `src/shared/api.ts` or `src/shared/room.ts` and update both client and server callers.
- Add tests near the behavior being changed. Server and policy behavior belongs in `test/*.test.ts`.
- For sandbox policy changes, cover both allowed and blocked paths.
- For renderer/navigation changes, include tests in `test/navigation.test.ts` when possible.
- For generated scene contract changes, update `docs/room-sandbox.md`, `src/client/room/sceneTypes.ts`, and `src/server/agent/roomCodeRepository.ts` together.

## Verification

At minimum run:

```bash
npm run test
```

Run this before handing off broader changes:

```bash
npm run build
```

If you change UI, renderer, or scene behavior, also run the app and inspect the room in a browser.

## Existing Dirty Work

The working tree may contain user-authored changes, especially in `sandbox/rooms/active` or UI files. Do not revert unrelated changes. If a file you need already has edits, read it carefully and layer your work on top.
