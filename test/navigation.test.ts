import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  collectNavigationColliders,
  constrainNavigationPosition,
  generatedAnimationHooks,
  hasGeneratedAnimation,
  normalizeGeneratedStartPose,
  optimizeGeneratedScenePerformance,
  positionIntersectsColliders,
  requestPointerLockSafely,
} from "../src/client/room/RoomRenderer";

describe("first-person navigation", () => {
  it("does not trap the camera at the original room walls", () => {
    const position = new THREE.Vector3(0, 1.65, -6);

    constrainNavigationPosition(position);

    expect(position.z).toBe(-6);
  });

  it("still keeps runaway movement within a broad world extent", () => {
    const position = new THREE.Vector3(120, 1.65, -120);

    constrainNavigationPosition(position);

    expect(position.x).toBe(48);
    expect(position.z).toBe(-48);
  });

  it("keeps wall geometry solid while leaving a doorway gap passable", () => {
    const root = new THREE.Group();
    const wallMaterial = new THREE.MeshBasicMaterial();
    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(3.8, 3, 0.08), wallMaterial);
    leftWall.position.set(-3.1, 1.5, -5);
    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(3.8, 3, 0.08), wallMaterial);
    rightWall.position.set(3.1, 1.5, -5);
    root.add(leftWall, rightWall);

    const colliders = collectNavigationColliders(root);

    expect(positionIntersectsColliders(new THREE.Vector3(0, 1.65, -5), colliders)).toBe(false);
    expect(positionIntersectsColliders(new THREE.Vector3(-3.1, 1.65, -5), colliders)).toBe(true);
  });

  it("ignores narrow decorative trim as navigation blockers", () => {
    const root = new THREE.Group();
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2, 0.04), new THREE.MeshBasicMaterial());
    trim.position.set(0, 1.4, -2);
    root.add(trim);

    const colliders = collectNavigationColliders(root);

    expect(positionIntersectsColliders(new THREE.Vector3(0, 1.65, -2), colliders)).toBe(false);
  });

  it("does not turn decorative tube arches into invisible walls", () => {
    const root = new THREE.Group();
    const arch = new THREE.Mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(-4, 1.1, -2),
          new THREE.Vector3(0, 4.5, -2),
          new THREE.Vector3(4, 1.1, -2),
        ]),
        16,
        0.08,
        8,
        false,
      ),
      new THREE.MeshBasicMaterial(),
    );
    root.add(arch);

    const colliders = collectNavigationColliders(root);

    expect(colliders).toHaveLength(0);
    expect(positionIntersectsColliders(new THREE.Vector3(0, 1.65, -2), colliders)).toBe(false);
  });

  it("ignores generated BackSide sky shells as navigation blockers", () => {
    const root = new THREE.Group();
    const skyShell = new THREE.Mesh(
      new THREE.SphereGeometry(45, 16, 12),
      new THREE.MeshBasicMaterial({ side: THREE.BackSide }),
    );
    skyShell.position.set(0, 2.6, -10);
    root.add(skyShell);

    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 3, 4),
      new THREE.MeshBasicMaterial(),
    );
    wall.position.set(3, 1.5, 0);
    root.add(wall);

    const colliders = collectNavigationColliders(root);

    expect(positionIntersectsColliders(new THREE.Vector3(0, 1.65, 0), colliders)).toBe(false);
    expect(positionIntersectsColliders(new THREE.Vector3(3, 1.65, 0), colliders)).toBe(true);
  });

  it("detects generated animation hooks only when the scene asks for continuous rendering", () => {
    const scene = new THREE.Scene();
    const root = new THREE.Group();

    expect(hasGeneratedAnimation(scene, root)).toBe(false);

    root.userData.isAnimated = true;
    root.userData.update = () => undefined;

    expect(hasGeneratedAnimation(scene, root)).toBe(true);
    expect(generatedAnimationHooks(scene, root)).toHaveLength(1);
  });

  it("deduplicates generated animation hooks shared across scene and root", () => {
    const scene = new THREE.Scene();
    const root = new THREE.Group();
    const update = () => undefined;
    scene.userData.update = update;
    scene.userData.animate = update;
    root.userData.update = update;

    expect(generatedAnimationHooks(scene, root)).toEqual([update]);
  });

  it("accepts only finite generated start pose hints", () => {
    expect(normalizeGeneratedStartPose({
      position: [2, 1.65, -4],
      rotation: [0, Math.PI / 2, 0],
    })).toEqual({
      position: [2, 1.65, -4],
      rotation: [0, Math.PI / 2, 0],
    });

    expect(normalizeGeneratedStartPose({ position: [0, 1.65, Number.NaN] })).toBeNull();
    expect(normalizeGeneratedStartPose({ position: [0, 1.65] })).toBeNull();
    expect(normalizeGeneratedStartPose({ position: [0, 1.65, 0], rotation: [0, Infinity, 0] })).toBeNull();
  });

  it("ignores pointer lock failures in embedded browsers", async () => {
    const rejectedElement = {
      requestPointerLock: () => Promise.reject(new DOMException("blocked", "SecurityError")),
    } as unknown as HTMLElement;
    const throwingElement = {
      requestPointerLock: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    } as unknown as HTMLElement;

    await expect(requestPointerLockSafely(rejectedElement)).resolves.toBeUndefined();
    expect(requestPointerLockSafely(throwingElement)).toBeUndefined();
  });

  it("caps expensive generated lights while preserving the strongest glow sources", () => {
    const root = new THREE.Group();
    for (let index = 0; index < 18; index += 1) {
      const light = new THREE.PointLight(0xffffff, index + 1, index % 2 === 0 ? 6 : 18);
      light.castShadow = true;
      light.name = `point-${index}`;
      root.add(light);
    }
    for (let index = 0; index < 7; index += 1) {
      const light = new THREE.SpotLight(0xffffff, index + 1, 12);
      light.castShadow = true;
      light.name = `spot-${index}`;
      root.add(light);
    }

    const stats = optimizeGeneratedScenePerformance(root);
    const remainingPointLights: THREE.PointLight[] = [];
    const remainingSpotLights: THREE.SpotLight[] = [];
    root.traverse((object) => {
      if (object instanceof THREE.PointLight) remainingPointLights.push(object);
      if (object instanceof THREE.SpotLight) remainingSpotLights.push(object);
    });

    expect(stats).toEqual({
      pointLightsRemoved: 6,
      spotLightsRemoved: 3,
      shadowCastingLightsDisabled: 25,
    });
    expect(remainingPointLights).toHaveLength(12);
    expect(remainingSpotLights).toHaveLength(4);
    expect(remainingPointLights.map((light) => light.name)).toContain("point-17");
    expect(remainingSpotLights.map((light) => light.name)).toContain("spot-6");
    expect([...remainingPointLights, ...remainingSpotLights].every((light) => !light.castShadow)).toBe(true);
  });
});
