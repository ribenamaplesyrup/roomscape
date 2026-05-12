import * as THREE from "three";
import type { RoomConfig, RoomObject, SurfaceMaterial, SurfaceTexture } from "../../shared/room";
import type { RoomSceneModule, RoomSceneStartPose } from "./sceneTypes";

export interface CameraPose {
  position: [number, number, number];
  rotation: [number, number, number];
}

const defaultCameraPosition: [number, number, number] = [0, 1.65, 0];

export class RoomRenderer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "low-power" });
  private readonly keys = new Set<string>();
  private readonly dynamicObjects = new THREE.Group();
  private readonly navigationHalfExtent = 48;
  private readonly collisionRadius = 0.28;
  private readonly idleAnimationFrameMs = 1000 / 30;
  private readonly colliders: THREE.Box3[] = [];
  private readonly onResize = () => this.resize();
  private readonly onKeyDown = (event: KeyboardEvent) => this.handleKeyDown(event);
  private readonly onKeyUp = (event: KeyboardEvent) => this.handleKeyUp(event);
  private readonly onMouseMove = (event: MouseEvent) => this.handleMouseMove(event);
  private readonly onCanvasClick = () => requestPointerLockSafely(this.renderer.domElement);
  private yaw = 0;
  private pitch = 0;
  private frame = 0;
  private lastFrameTime = 0;
  private renderRequested = false;
  private running = false;
  private animatedScene = false;

  public constructor(private readonly mount: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.mount.append(this.renderer.domElement);
    this.resetPose();
    this.scene.add(this.dynamicObjects);
    this.bindInput();
    this.resize();
    window.addEventListener("resize", this.onResize);
  }

  /** Applies a new generated room config without replacing the camera or controls. */
  public applyConfig(config: RoomConfig): void {
    this.resetSceneAnimation();
    this.scene.background = new THREE.Color(config.palette.ceiling);
    this.scene.fog = config.objects.length > 0 ? new THREE.Fog(config.palette.ceiling, 9, 20) : null;
    disposeObject3D(this.dynamicObjects);
    this.buildShell(config);
    for (const object of config.objects) {
      const mesh = meshForObject(object);
      if (mesh) this.dynamicObjects.add(mesh);
    }
    this.refreshColliders();
    this.requestRender();
  }

  /** Applies sandbox-authored Three.js scene code without replacing camera or controls. */
  public applyScene(module: RoomSceneModule): void {
    this.resetSceneAnimation();
    disposeObject3D(this.dynamicObjects);
    module.buildRoom({ THREE, root: this.dynamicObjects, scene: this.scene });
    optimizeGeneratedScenePerformance(this.dynamicObjects);
    this.animatedScene = hasGeneratedAnimation(this.scene, this.dynamicObjects);
    this.refreshColliders();
    this.requestRender();
  }

  /** Starts the demand-driven render loop and first-person movement updates. */
  public start(): void {
    if (this.running) return;
    this.running = true;
    this.requestRender();
  }

  private requestRender(): void {
    if (this.renderRequested || !this.running) return;
    this.renderRequested = true;
    this.frame = requestAnimationFrame((time) => {
      this.renderRequested = false;
      const hasMovement = this.hasMovementInput();
      if (this.shouldThrottleAnimatedFrame(time, hasMovement)) {
        this.requestRender();
        return;
      }
      const delta = this.lastFrameTime === 0 ? 0 : (time - this.lastFrameTime) / 1000;
      this.lastFrameTime = time;
      this.moveCamera();
      this.updateGeneratedAnimation(time / 1000, delta);
      this.renderer.render(this.scene, this.camera);
      if (hasMovement || this.animatedScene) this.requestRender();
    });
  }

  /** Captures the current pose so hot updates can preserve user immersion. */
  public pose(): CameraPose {
    return {
      position: this.camera.position.toArray() as [number, number, number],
      rotation: [this.pitch, this.yaw, 0],
    };
  }

  /** Restores a saved pose after generated room code hot reloads. */
  public restorePose(pose: CameraPose): void {
    this.camera.position.fromArray(pose.position);
    this.pitch = pose.rotation[0];
    this.yaw = pose.rotation[1];
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
    if (positionIntersectsColliders(this.camera.position, this.colliders)) {
      this.resetPose();
      return;
    }
    this.requestRender();
  }

  /** Returns to the generated room's neutral start position. */
  public resetPose(): void {
    const startPose = normalizeGeneratedStartPose(this.scene.userData.startPose ?? this.dynamicObjects.userData.startPose);
    this.camera.position.fromArray(startPose?.position ?? defaultCameraPosition);
    this.pitch = startPose?.rotation?.[0] ?? 0;
    this.yaw = startPose?.rotation?.[1] ?? 0;
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
    this.requestRender();
  }

  public dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("mousemove", this.onMouseMove);
    this.renderer.domElement.removeEventListener("click", this.onCanvasClick);
    window.removeEventListener("resize", this.onResize);
    disposeObject3D(this.dynamicObjects);
    this.mount.replaceChildren();
    this.renderer.dispose();
  }

  private buildShell(config: RoomConfig): void {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      surfaceMaterial(config.palette.floor, config.materials?.floor),
    );
    floor.rotation.x = -Math.PI / 2;
    this.dynamicObjects.add(floor);

    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      surfaceMaterial(config.palette.ceiling, config.materials?.ceiling),
    );
    ceiling.position.y = 3;
    ceiling.rotation.x = Math.PI / 2;
    this.dynamicObjects.add(ceiling);

    const wallMaterial = surfaceMaterial(config.palette.wall, config.materials?.wall);
    const wallGeometry = new THREE.PlaneGeometry(10, 3);
    const walls: Array<[number, number, number, number]> = [
      [0, 1.5, -5, 0],
      [0, 1.5, 5, Math.PI],
      [-5, 1.5, 0, Math.PI / 2],
      [5, 1.5, 0, -Math.PI / 2],
    ];
    for (const [x, y, z, rotationY] of walls) {
      const wall = new THREE.Mesh(wallGeometry, wallMaterial);
      wall.position.set(x, y, z);
      wall.rotation.y = rotationY;
      this.dynamicObjects.add(wall);
    }

    if (config.objects.length > 0) {
      const trimMaterial = new THREE.MeshStandardMaterial({ color: config.palette.accent, roughness: 0.74 });
      const trimGeometry = new THREE.BoxGeometry(10, 0.08, 0.08);
      const backTrim = new THREE.Mesh(trimGeometry, trimMaterial);
      backTrim.position.set(0, 0.08, -4.96);
      const frontTrim = backTrim.clone();
      frontTrim.position.z = 4.96;
      const sideTrimGeometry = new THREE.BoxGeometry(0.08, 0.08, 10);
      const leftTrim = new THREE.Mesh(sideTrimGeometry, trimMaterial);
      leftTrim.position.set(-4.96, 0.08, 0);
      const rightTrim = leftTrim.clone();
      rightTrim.position.x = 4.96;
      this.dynamicObjects.add(backTrim, frontTrim, leftTrim, rightTrim);
    }

    const light = new THREE.HemisphereLight("#ffffff", "#555555", config.objects.length === 0 ? 1.2 : 1.7);
    this.dynamicObjects.add(light);
    const directional = new THREE.DirectionalLight("#ffffff", config.objects.length === 0 ? 0.6 : 1.4);
    directional.position.set(2, 4, 3);
    this.dynamicObjects.add(directional);
  }

  private bindInput(): void {
    this.renderer.domElement.addEventListener("click", this.onCanvasClick);
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("mousemove", this.onMouseMove);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (isMovementKey(event.key)) {
      event.preventDefault();
      this.keys.add(event.key);
      this.requestRender();
    }
  }

  private handleKeyUp(event: KeyboardEvent): void {
    if (isMovementKey(event.key)) event.preventDefault();
    this.keys.delete(event.key);
  }

  private handleMouseMove(event: MouseEvent): void {
    if (document.pointerLockElement !== this.renderer.domElement) return;
    this.yaw -= event.movementX * 0.0024;
    this.pitch = THREE.MathUtils.clamp(this.pitch - event.movementY * 0.0024, -1.2, 1.2);
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
    this.requestRender();
  }

  private moveCamera(): void {
    const direction = new THREE.Vector3();
    const forward = horizontalCameraForward(this.camera);
    const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
    if (this.keys.has("ArrowUp")) direction.add(forward);
    if (this.keys.has("ArrowDown")) direction.sub(forward);
    if (this.keys.has("ArrowRight")) direction.add(right);
    if (this.keys.has("ArrowLeft")) direction.sub(right);
    if (direction.lengthSq() > 0) {
      direction.normalize().multiplyScalar(0.055);
      this.tryMove(direction);
    }
  }

  private tryMove(delta: THREE.Vector3): void {
    const next = constrainNavigationPosition(this.camera.position.clone().add(delta), this.navigationHalfExtent);
    if (!positionIntersectsColliders(next, this.colliders)) {
      this.camera.position.copy(next);
      return;
    }

    const slideX = constrainNavigationPosition(this.camera.position.clone().add(new THREE.Vector3(delta.x, 0, 0)), this.navigationHalfExtent);
    if (!positionIntersectsColliders(slideX, this.colliders)) {
      this.camera.position.copy(slideX);
      return;
    }

    const slideZ = constrainNavigationPosition(this.camera.position.clone().add(new THREE.Vector3(0, 0, delta.z)), this.navigationHalfExtent);
    if (!positionIntersectsColliders(slideZ, this.colliders)) {
      this.camera.position.copy(slideZ);
    }
  }

  private refreshColliders(): void {
    this.colliders.splice(0, this.colliders.length, ...collectNavigationColliders(this.dynamicObjects, this.camera.position.y, this.collisionRadius));
  }

  private resetSceneAnimation(): void {
    this.animatedScene = false;
    this.lastFrameTime = 0;
    this.scene.onBeforeRender = () => undefined;
    for (const key of ["animate", "update", "isAnimated", "needsContinuousRender"]) {
      delete this.scene.userData[key];
      delete this.dynamicObjects.userData[key];
    }
  }

  private updateGeneratedAnimation(time: number, delta: number): void {
    if (!this.animatedScene) return;
    for (const hook of generatedAnimationHooks(this.scene, this.dynamicObjects)) {
      hook({ time, delta, scene: this.scene, root: this.dynamicObjects });
    }
  }

  private shouldThrottleAnimatedFrame(time: number, hasMovement: boolean): boolean {
    return this.animatedScene
      && !hasMovement
      && this.lastFrameTime > 0
      && time - this.lastFrameTime < this.idleAnimationFrameMs;
  }

  private resize(): void {
    const width = this.mount.clientWidth || window.innerWidth;
    const height = this.mount.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.requestRender();
  }

  private hasMovementInput(): boolean {
    return this.keys.has("ArrowUp") || this.keys.has("ArrowDown") || this.keys.has("ArrowRight") || this.keys.has("ArrowLeft");
  }
}

function meshForObject(object: RoomObject): THREE.Object3D | null {
  if (!isVector3(object.position) || !isVector3(object.scale)) return null;
  if (object.kind === "table") return tableForObject(object);
  if (object.kind === "sofa") return sofaForObject(object);
  if (object.kind === "column") return columnForObject(object);
  if (object.kind === "light") return lightForObject(object);
  return boxForObject(object, texturedMaterial(object.color, "object", 0.62));
}

function boxForObject(object: RoomObject, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.position.fromArray(object.position);
  mesh.scale.fromArray(object.scale);
  return mesh;
}

function tableForObject(object: RoomObject): THREE.Object3D {
  const [sx, sy, sz] = object.scale;
  const group = new THREE.Group();
  group.position.fromArray(object.position);
  const material = texturedMaterial(object.color, "wood", 0.68);
  const top = new THREE.Mesh(new THREE.BoxGeometry(sx, Math.max(0.08, sy * 0.18), sz), material);
  top.position.y = sy * 0.42;
  group.add(top);
  const legMaterial = new THREE.MeshStandardMaterial({ color: darken(object.color, 0.72), roughness: 0.72 });
  const legHeight = Math.max(0.28, sy * 0.78);
  const legGeometry = new THREE.BoxGeometry(0.08, legHeight, 0.08);
  for (const x of [-sx * 0.42, sx * 0.42]) {
    for (const z of [-sz * 0.38, sz * 0.38]) {
      const leg = new THREE.Mesh(legGeometry, legMaterial);
      leg.position.set(x, -legHeight * 0.08, z);
      group.add(leg);
    }
  }
  return group;
}

function sofaForObject(object: RoomObject): THREE.Object3D {
  const [sx, sy, sz] = object.scale;
  const group = new THREE.Group();
  group.position.fromArray(object.position);
  const material = texturedMaterial(object.color, "fabric", 0.94);
  const base = new THREE.Mesh(new THREE.BoxGeometry(sx, sy * 0.45, sz), material);
  base.position.y = -sy * 0.15;
  const back = new THREE.Mesh(new THREE.BoxGeometry(sx, sy * 0.9, Math.max(0.12, sz * 0.18)), material);
  back.position.set(0, sy * 0.1, -sz * 0.42);
  const armGeometry = new THREE.BoxGeometry(Math.max(0.12, sx * 0.1), sy * 0.65, sz);
  const leftArm = new THREE.Mesh(armGeometry, material);
  leftArm.position.set(-sx * 0.48, -sy * 0.02, 0);
  const rightArm = leftArm.clone();
  rightArm.position.x = sx * 0.48;
  group.add(base, back, leftArm, rightArm);
  return group;
}

function columnForObject(object: RoomObject): THREE.Object3D {
  const [sx, sy, sz] = object.scale;
  const radius = Math.max(0.08, Math.max(sx, sz) * 0.5);
  const geometry = new THREE.CylinderGeometry(radius, radius, sy, 24);
  const mesh = new THREE.Mesh(geometry, texturedMaterial(object.color, "plaster", 0.8));
  mesh.position.fromArray(object.position);
  return mesh;
}

function lightForObject(object: RoomObject): THREE.Object3D {
  const group = new THREE.Group();
  group.position.fromArray(object.position);
  const [sx, sy, sz] = object.scale;
  const material = new THREE.MeshStandardMaterial({
    color: object.color,
    emissive: object.color,
    emissiveIntensity: 0.85,
    roughness: 0.36,
  });
  const fixture = new THREE.Mesh(new THREE.BoxGeometry(sx, Math.max(0.04, sy), sz), material);
  const light = new THREE.PointLight(object.color, object.intensity ?? 0.9, 6);
  group.add(fixture, light);
  return group;
}

function isVector3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === "number");
}

export function normalizeGeneratedStartPose(value: unknown): RoomSceneStartPose | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { position?: unknown; rotation?: unknown };
  if (!isVector3(candidate.position)) return null;
  if (candidate.rotation !== undefined && !isVector3(candidate.rotation)) return null;
  if (candidate.position.some((entry) => !Number.isFinite(entry))) return null;
  if (candidate.rotation?.some((entry) => !Number.isFinite(entry))) return null;
  return {
    position: candidate.position,
    ...(candidate.rotation ? { rotation: candidate.rotation } : {}),
  };
}

function horizontalCameraForward(camera: THREE.Camera): THREE.Vector3 {
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() === 0) return new THREE.Vector3(0, 0, -1);
  return forward.normalize();
}

function isMovementKey(key: string): boolean {
  return key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight";
}

export function requestPointerLockSafely(element: HTMLElement): Promise<void> | undefined {
  try {
    // Embedded browsers may reject pointer lock; keyboard navigation still works.
    return element.requestPointerLock().catch(() => undefined);
  } catch {
    return undefined;
  }
}

const generatedPointLightLimit = 12;
const generatedSpotLightLimit = 4;

export interface GeneratedScenePerformanceStats {
  pointLightsRemoved: number;
  spotLightsRemoved: number;
  shadowCastingLightsDisabled: number;
}

export function optimizeGeneratedScenePerformance(root: THREE.Object3D): GeneratedScenePerformanceStats {
  const pointLights: THREE.PointLight[] = [];
  const spotLights: THREE.SpotLight[] = [];
  let shadowCastingLightsDisabled = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Light)) return;
    if (object.castShadow) {
      object.castShadow = false;
      shadowCastingLightsDisabled += 1;
    }
    if (object instanceof THREE.PointLight) pointLights.push(object);
    if (object instanceof THREE.SpotLight) spotLights.push(object);
  });

  return {
    pointLightsRemoved: removeWeakestLights(pointLights, generatedPointLightLimit),
    spotLightsRemoved: removeWeakestLights(spotLights, generatedSpotLightLimit),
    shadowCastingLightsDisabled,
  };
}

function removeWeakestLights<T extends THREE.Light>(lights: T[], limit: number): number {
  if (lights.length <= limit) return 0;
  const rankedLights = [...lights].sort((a, b) => lightScore(b) - lightScore(a));
  const keep = new Set(rankedLights.slice(0, limit));
  let removed = 0;
  for (const light of lights) {
    if (keep.has(light)) continue;
    light.parent?.remove(light);
    removed += 1;
  }
  return removed;
}

function lightScore(light: THREE.Light): number {
  const intensity = Number.isFinite(light.intensity) ? light.intensity : 0;
  if (light instanceof THREE.PointLight || light instanceof THREE.SpotLight) {
    return intensity * Math.max(1, Math.min(light.distance || 1, 24));
  }
  return intensity;
}

/** Keeps navigation finite without trapping the user inside the starter room. */
export function constrainNavigationPosition(position: THREE.Vector3, halfExtent = 48): THREE.Vector3 {
  position.x = THREE.MathUtils.clamp(position.x, -halfExtent, halfExtent);
  position.z = THREE.MathUtils.clamp(position.z, -halfExtent, halfExtent);
  return position;
}

/** Builds camera-height solid bounds from generated scene geometry, leaving real openings passable. */
export function collectNavigationColliders(root: THREE.Object3D, eyeHeight = 1.65, radius = 0.28): THREE.Box3[] {
  const colliders: THREE.Box3[] = [];
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.userData.collider === false || object.userData.walkable === true) return;
    if (isDecorativeNavigationGeometry(object.geometry)) return;
    const bounds = new THREE.Box3().setFromObject(object);
    if (bounds.isEmpty()) return;
    if (bounds.max.y < eyeHeight - 0.55 || bounds.min.y > eyeHeight + 0.45) return;
    if (!isMeaningfulCollider(bounds)) return;
    bounds.min.x -= radius;
    bounds.max.x += radius;
    bounds.min.z -= radius;
    bounds.max.z += radius;
    colliders.push(bounds);
  });
  return colliders;
}

function isDecorativeNavigationGeometry(geometry: THREE.BufferGeometry): boolean {
  return geometry.type === "TubeGeometry";
}

function isMeaningfulCollider(bounds: THREE.Box3): boolean {
  const size = new THREE.Vector3();
  bounds.getSize(size);
  return size.y >= 0.5 && (size.x >= 0.35 || size.z >= 0.35);
}

/** Checks whether a camera position intersects any generated solid at walking height. */
export function positionIntersectsColliders(position: THREE.Vector3, colliders: THREE.Box3[]): boolean {
  return colliders.some((collider) => position.x >= collider.min.x
    && position.x <= collider.max.x
    && position.z >= collider.min.z
    && position.z <= collider.max.z);
}

interface GeneratedAnimationFrame {
  time: number;
  delta: number;
  scene: THREE.Scene;
  root: THREE.Group;
}

type GeneratedAnimationHook = (frame: GeneratedAnimationFrame) => void;

export function hasGeneratedAnimation(scene: THREE.Scene, root: THREE.Group): boolean {
  return Boolean(
    scene.userData.isAnimated
      || scene.userData.needsContinuousRender
      || root.userData.isAnimated
      || root.userData.needsContinuousRender
      || isGeneratedAnimationHook(scene.userData.animate)
      || isGeneratedAnimationHook(scene.userData.update)
      || isGeneratedAnimationHook(root.userData.animate)
      || isGeneratedAnimationHook(root.userData.update),
  );
}

export function generatedAnimationHooks(scene: THREE.Scene, root: THREE.Group): GeneratedAnimationHook[] {
  return [...new Set([
    scene.userData.update,
    scene.userData.animate,
    root.userData.update,
    root.userData.animate,
  ])].filter(isGeneratedAnimationHook);
}

function isGeneratedAnimationHook(value: unknown): value is GeneratedAnimationHook {
  return typeof value === "function";
}

function plainMaterial(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 });
}

function surfaceMaterial(fallbackColor: string, material: SurfaceMaterial | undefined): THREE.MeshStandardMaterial {
  if (!material || material.texture === "plain") return plainMaterial(material?.color ?? fallbackColor);
  const color = material.color ?? fallbackColor;
  const textureKind = material.texture;
  const map = proceduralTexture(color, textureKind);
  const bumpMap = proceduralTexture(color, textureKind);
  return new THREE.MeshStandardMaterial({
    color,
    map,
    bumpMap,
    bumpScale: textureKind === "carpet" ? 0.045 : 0.018,
    roughness: textureKind === "carpet" ? 0.98 : 0.88,
    metalness: 0,
  });
}

function texturedMaterial(color: string, kind: TextureKind, roughness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    map: proceduralTexture(color, kind),
    roughness,
    metalness: 0,
  });
}

type TextureKind = SurfaceTexture | "floor" | "ceiling" | "wall" | "object" | "fabric";

function proceduralTexture(color: string, kind: TextureKind): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d")!;
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const seed = kind.charCodeAt(0) * 19 + color.length * 7;
  const marks = kind === "carpet" ? 560 : 180;
  for (let i = 0; i < marks; i += 1) {
    const x = (i * 37 + seed) % canvas.width;
    const y = (i * 53 + seed * 2) % canvas.height;
    const alpha = kind === "carpet" ? 0.16 : kind === "fabric" ? 0.12 : 0.075;
    context.fillStyle = i % 2 === 0 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
    if (kind === "carpet") {
      context.fillRect(x, y, 1 + (i % 3), 1);
    } else {
      context.fillRect(x, y, kind === "wood" ? 18 : 2, kind === "fabric" ? 1 : 2);
    }
  }
  if (kind === "floor" || kind === "ceiling" || kind === "tile") {
    context.strokeStyle = "rgba(0,0,0,0.08)";
    context.lineWidth = 1;
    for (let line = 32; line < 128; line += 32) {
      context.beginPath();
      context.moveTo(line, 0);
      context.lineTo(line, 128);
      context.moveTo(0, line);
      context.lineTo(128, line);
      context.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(kind === "wall" ? 2 : kind === "carpet" ? 12 : 4, kind === "wall" ? 1 : kind === "carpet" ? 12 : 4);
  return texture;
}

function darken(color: string, amount: number): string {
  const source = new THREE.Color(color);
  source.multiplyScalar(amount);
  return `#${source.getHexString()}`;
}

function disposeObject3D(object: THREE.Object3D): void {
  for (const child of [...object.children]) {
    disposeObject3D(child);
    object.remove(child);
  }
  if (object instanceof THREE.Mesh) {
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  }
}
