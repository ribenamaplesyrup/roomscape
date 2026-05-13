import type * as THREE from "three";

export interface RoomSceneContext {
  THREE: typeof THREE;
  root: THREE.Group;
  scene: THREE.Scene;
  effects: RoomSceneEffects;
  lighting: RoomSceneLightingTools;
  materials: RoomSceneMaterialTools;
}

export type RoomSceneShadowQuality = "low" | "medium" | "high";

export interface RoomSceneEffects {
  setExposure(exposure: number): void;
  enableSoftShadows(quality?: RoomSceneShadowQuality): void;
}

export interface RoomSceneOfficeTrofferOptions {
  position: [number, number, number];
  size?: [number, number, number];
  color?: string;
  intensity?: number;
  distance?: number;
  target?: [number, number, number];
  castShadow?: boolean;
}

export interface RoomSceneSoftSpotlightOptions {
  position: [number, number, number];
  target?: [number, number, number];
  color?: string;
  intensity?: number;
  distance?: number;
  angle?: number;
  penumbra?: number;
  castShadow?: boolean;
}

export interface RoomSceneLightingTools {
  addOfficeTroffer(options: RoomSceneOfficeTrofferOptions): THREE.Group;
  addSoftSpotlight(options: RoomSceneSoftSpotlightOptions): THREE.SpotLight;
}

export interface RoomSceneSoftGlowTextureOptions {
  size?: number;
  innerRadius?: number;
  outerRadius?: number;
}

export interface RoomSceneGlowMaterialOptions extends RoomSceneSoftGlowTextureOptions {
  color?: string;
  opacity?: number;
  depthWrite?: boolean;
}

export interface RoomSceneMaterialTools {
  makeSoftGlowTexture(options?: RoomSceneSoftGlowTextureOptions): THREE.DataTexture;
  makeGlowMaterial(options?: RoomSceneGlowMaterialOptions): THREE.MeshBasicMaterial;
}

export interface RoomSceneStartPose {
  position: [number, number, number];
  rotation?: [number, number, number];
}

export interface RoomSceneModule {
  roomTitle: string;
  buildRoom(context: RoomSceneContext): void;
}
