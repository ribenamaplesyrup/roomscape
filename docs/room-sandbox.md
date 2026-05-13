# Room Sandbox

Roomscape keeps generated room code in `sandbox/rooms/active`. The live Codex runner starts in that directory and is instructed to edit only `roomScene.ts`.

## Files

- `roomScene.ts`: Codex-editable source. This is the file the Architect changes.
- `activeRoomScene.ts`: browser-facing copy promoted only after validation passes.
- `roomConfig.ts`: generated `RoomConfig` module used by reset and legacy config rendering.

The server owns copying and validation. The client imports `activeRoomScene.ts`, not `roomScene.ts`.

## Scene Module Contract

Generated scene modules must export:

```ts
import type { RoomSceneContext } from "../../../src/client/room/sceneTypes";

export const roomTitle = "Readable title";

export function buildRoom({ THREE, root, scene, effects, lighting, materials }: RoomSceneContext): void {
  // Add Three.js objects to root and adjust scene background/fog as needed.
}
```

Allowed inside `buildRoom`:

- Three.js geometry, materials, lights, fog, colors, textures, groups, and meshes.
- Host-owned creative helpers through `effects`, `lighting`, and `materials`.
- Pure helper functions and constants local to `roomScene.ts`.
- Procedural `DataTexture` work.
- Deterministic animation hooks through `scene.userData` or `root.userData`.
- An optional host-owned start pose hint through `scene.userData.startPose` or `root.userData.startPose`.

Not allowed:

- Creating a renderer, camera, controls, or DOM nodes.
- `document`, `window`, `fetch`, network calls, timers, or `requestAnimationFrame`.
- Runtime imports or external assets.
- Editing files other than `roomScene.ts`.
- `THREE.*` namespace type annotations such as `: THREE.Mesh`; local values should infer types.

## Host-Owned Creative Helpers

Generated scenes can request richer rendering behavior through constrained helper APIs. The host still owns the renderer, camera, post-load performance budget, and shadow limits.

```ts
export function buildRoom({ lighting, effects, materials }: RoomSceneContext): void {
  effects.setExposure(1.18);
  effects.enableSoftShadows("medium");

  lighting.addOfficeTroffer({
    position: [0, 2.88, -1],
    size: [1.2, 0.08, 0.5],
    intensity: 1.4,
    castShadow: true,
  });

  const glow = materials.makeGlowMaterial({ color: "#fff7d0", opacity: 0.22 });
  // Use glow on a local mesh when a soft emissive cue is useful.
}
```

Use actual lights, emissive diffuser materials, and these helper-created glows for ordinary architectural lighting. Do not add visible transparent cone, cylinder, or pyramid meshes as fake light beams unless the user explicitly asks for fog, haze, theatrical beams, or volumetric light.

## Animation Hooks

Generated scenes can request continuous rendering without timers:

```ts
root.userData.isAnimated = true;
root.userData.update = ({ time, delta, root }) => {
  // Update lights, materials, or transforms deterministically.
};
```

The host renderer detects `isAnimated`, `needsContinuousRender`, `update`, or `animate` hooks on `scene.userData` and `root.userData`, then calls the hooks from the existing render loop.

## Start Pose

The host owns the camera, but generated scenes can suggest where saved rooms and resets should start:

```ts
scene.userData.startPose = {
  position: [0, 1.65, 0],
  rotation: [0, -Math.PI / 2, 0],
};
```

Use this for larger worlds when the neutral origin would face a wall or miss the main route. The host validates the shape and applies the pose during room load/reset without giving generated code direct camera access.

## Navigation And Collisions

The host owns the camera and first-person controls. Generated room meshes become collision geometry when they are large enough around camera height. Thin decorative trim is ignored so it does not trap the user.

When a generated scene adds a doorway, hall, exterior, or adjacent room, it must leave actual gaps in wall geometry and provide walkable floor space. A decorative door texture or panel is not navigable.

## Validation And Promotion

After Codex edits `roomScene.ts`, the server:

1. Normalizes unsafe `THREE.*` type annotations.
2. Checks for required exports.
3. Rejects DOM, window, network, renderer, camera, timer, and animation-loop APIs.
4. Checks unsafe shorthand properties.
5. Runs TypeScript transpile diagnostics.
6. Checks targeted edit scope for narrow requests.
7. Promotes the source to `activeRoomScene.ts` only when validation passes.

If validation fails, the live runner asks Codex for one repair attempt by default. If repair still fails, the server restores the last good scene source.

## Safety Model

Path checks run before server file reads/writes and again for streamed Codex file-change events. Any path escape becomes a `permission-request` event instead of silently widening access.

The trusted server remains responsible for auth, sessions, saved rooms, run cancellation, telemetry, rate limits, and permission decisions.
