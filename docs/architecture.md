# Roomscape Architecture

## Boundaries

Roomscape keeps the trusted harness separate from the room-editing workspace:

- The app server owns authentication, encrypted OpenAI credentials, user rooms, cost tracking, audit logs, and permission approvals.
- The active room sandbox is `src/client/rooms/active`.
- The agent runner may only read or write inside that active room directory.
- Any attempted path escape creates a formal permission request and halts the run.

This mirrors the OpenAI Agents SDK sandbox guidance: keep the harness as the control plane and let the sandbox be the execution plane for files, commands, ports, and generated artifacts.

## First Iteration

The current `DeterministicArchitectRunner` is a local, deterministic runner used for TDD and UI integration. It updates the generated room module and emits logs, cost telemetry, and completion events through the same interface that the live Agents SDK runner will use.

## Next Live SDK Step

The next implementation slice should add an `AgentsSdkArchitectRunner` behind the existing `ArchitectRunner` interface using `SandboxAgent`, `Manifest`, `filesystem`, `shell`, and a local or hosted sandbox client. The active room directory should be mounted as the only writable workspace entry, and Roomscape should keep credentials and approval state outside that sandbox.
