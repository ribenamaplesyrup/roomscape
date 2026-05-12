import type * as THREE from "three";

export interface RoomSceneContext {
  THREE: typeof THREE;
  root: THREE.Group;
  scene: THREE.Scene;
}

export interface RoomSceneStartPose {
  position: [number, number, number];
  rotation?: [number, number, number];
}

export interface RoomSceneModule {
  roomTitle: string;
  buildRoom(context: RoomSceneContext): void;
}
