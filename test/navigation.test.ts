import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { collectNavigationColliders, constrainNavigationPosition, positionIntersectsColliders } from "../src/client/room/RoomRenderer";

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
});
