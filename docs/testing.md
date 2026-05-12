# Testing

Roomscape uses Vitest with the test root configured through `vite.config.ts`.

## Commands

```bash
npm run test
npm run test:watch
npm run build
```

Use `npm run test` for normal verification. Use `npm run build` when a change affects shared types, module imports, Vite config, or generated scene contracts.

## Current Coverage Map

- `test/auth.test.ts`: ChatGPT-backed local user/session behavior.
- `test/chatGptHttp.test.ts`: HTTP auth bridge behavior and Codex unavailable errors.
- `test/roomRepository.test.ts`: saved room ownership and persistence.
- `test/architectRunner.test.ts`: deterministic runner behavior, telemetry, and permission events.
- `test/codexArchitectRunner.test.ts`: live-runner contract using mocked Codex threads.
- `test/sandboxPolicy.test.ts`: path containment decisions.
- `test/modelOptions.test.ts`: shared model option contract.
- `test/navigation.test.ts`: first-person navigation, colliders, and generated animation hooks.

## Where To Add Tests

- API route behavior: add to an HTTP-focused test near `chatGptHttp.test.ts` or create a focused `*.test.ts`.
- Storage behavior: extend `roomRepository.test.ts` or add a storage-specific test.
- Sandbox boundary behavior: extend `sandboxPolicy.test.ts`, `architectRunner.test.ts`, or `codexArchitectRunner.test.ts`.
- Generated scene validation: extend `codexArchitectRunner.test.ts` or add tests around `RoomCodeRepository`.
- Renderer navigation and animation hooks: extend `navigation.test.ts`.
- Shared constants and user-facing model choices: extend `modelOptions.test.ts`.

## Test Design Notes

- Prefer memory stores and mocked Codex bridges for server tests.
- Avoid requiring real ChatGPT auth or live Codex network behavior in tests.
- Assert permission-request events for blocked filesystem behavior.
- Assert both the positive path and the blocked path when changing sandbox policy.
- Keep tests focused on observable behavior rather than implementation details.
