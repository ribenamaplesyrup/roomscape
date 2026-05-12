# HTTP API

Roomscape serves browser routes through Vite or static files and reserves `/api/*` for JSON and server-sent event routes.

## Authentication

### `GET /api/session`

Returns the current public user or `null`.

```json
{ "user": null }
```

### `POST /api/auth/chatgpt/start`

Starts Codex-managed ChatGPT auth.

Browser-flow response:

```json
{ "type": "chatgpt", "loginId": "id", "authUrl": "https://..." }
```

Hosted device-code response:

```json
{ "type": "chatgptDeviceCode", "loginId": "id", "verificationUrl": "https://auth.openai.com/codex/device", "userCode": "ABCD-1234" }
```

### `POST /api/auth/chatgpt/complete`

Body:

```json
{ "loginId": "id" }
```

Returns either:

```json
{ "status": "pending" }
```

or:

```json
{ "status": "authenticated", "user": { "id": "user-id", "authMode": "chatgpt", "accountLabel": "ChatGPT account", "openAiAccountLabel": "ChatGPT account" } }
```

### `POST /api/auth/logout`

Clears the current session and cancels active room edits.

## Usage

### `GET /api/usage`

Returns Codex ChatGPT rate-limit details when available:

```json
{ "usage": null }
```

or:

```json
{ "usage": { "rateLimits": {}, "rateLimitsByLimitId": {} } }
```

## Rooms

All room routes require authentication.

### `GET /api/rooms`

Lists rooms owned by the current user.

### `POST /api/rooms`

Saves the active room scene for the current user.

Body:

```json
{ "name": "Warm studio", "config": {} }
```

The server uses the current active config when `config` is omitted and captures `activeRoomScene.ts` as the saved scene source.

### `GET /api/rooms/:id`

Loads a saved room owned by the current user. The server writes the saved scene into the active sandbox, validates it, promotes it, and returns the saved room.

### `GET /api/active-room`

Returns the current in-memory active `RoomConfig`.

### `POST /api/active-room/reset`

Cancels active room edits, resets the in-memory config, writes a fresh starter scene, and returns the fresh config.

## Agent Runs

### `POST /api/agent/runs`

Queues a room edit.

Body:

```json
{ "prompt": "Add walnut shelving", "model": "gpt-5.4", "currentConfig": {} }
```

Response:

```json
{ "runId": "run-id" }
```

Runs are serialized. Reset, logout, and cancel increment the run generation so stale events cannot mutate active state.

### `POST /api/agent/runs/cancel`

Cancels active and queued room edits.

### `GET /api/agent/runs/:id/events`

Subscribes to server-sent events for a run. The server replays remembered events for late subscribers.

Event types:

- `log`: textual progress message.
- `cost`: model, token, and estimated cost data.
- `room-updated`: updated `RoomConfig`.
- `scene-updated`: generated scene was validated and promoted.
- `permission-request`: Codex attempted a path or operation outside the sandbox.
- `complete`: run finished successfully.
- `error`: run failed or was cancelled.

Each SSE message uses the event type as the SSE `event` field and a JSON `data` payload matching `AgentEvent` from `src/shared/api.ts`.
