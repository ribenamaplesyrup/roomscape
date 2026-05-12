import * as THREE from "three";
import type { RoomConfig, RoomObject } from "../../shared/room";

export interface CameraPose {
  position: [number, number, number];
  rotation: [number, number, number];
}

export class RoomRenderer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly keys = new Set<string>();
  private readonly dynamicObjects = new THREE.Group();
  private yaw = 0;
  private pitch = 0;
  private frame = 0;

  public constructor(private readonly mount: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.mount.append(this.renderer.domElement);
    this.camera.position.set(0, 1.65, 4.5);
    this.scene.add(this.dynamicObjects);
    this.bindInput();
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  /** Applies a new generated room config without replacing the camera or controls. */
  public applyConfig(config: RoomConfig): void {
    this.scene.background = new THREE.Color(config.palette.ceiling);
    this.dynamicObjects.clear();
    this.buildShell(config);
    for (const object of config.objects) {
      this.dynamicObjects.add(meshForObject(object));
    }
  }

  /** Starts the render loop and first-person movement updates. */
  public start(): void {
    const loop = () => {
      this.frame = requestAnimationFrame(loop);
      this.moveCamera();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
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
  }

  public dispose(): void {
    cancelAnimationFrame(this.frame);
    this.renderer.dispose();
  }

  private buildShell(config: RoomConfig): void {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.MeshStandardMaterial({ color: config.palette.floor, roughness: 0.75 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.dynamicObjects.add(floor);

    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.MeshStandardMaterial({ color: config.palette.ceiling, roughness: 0.9 }),
    );
    ceiling.position.y = 3;
    ceiling.rotation.x = Math.PI / 2;
    this.dynamicObjects.add(ceiling);

    const wallMaterial = new THREE.MeshStandardMaterial({ color: config.palette.wall, roughness: 0.82 });
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

    const light = new THREE.HemisphereLight("#fff8ec", "#3d4643", 1.7);
    this.dynamicObjects.add(light);
    const directional = new THREE.DirectionalLight("#ffffff", 1.4);
    directional.position.set(2, 4, 3);
    directional.castShadow = true;
    this.dynamicObjects.add(directional);
  }

  private bindInput(): void {
    this.renderer.domElement.addEventListener("click", () => this.renderer.domElement.requestPointerLock());
    document.addEventListener("keydown", (event) => this.keys.add(event.key.toLowerCase()));
    document.addEventListener("keyup", (event) => this.keys.delete(event.key.toLowerCase()));
    document.addEventListener("mousemove", (event) => {
      if (document.pointerLockElement !== this.renderer.domElement) return;
      this.yaw -= event.movementX * 0.0024;
      this.pitch = THREE.MathUtils.clamp(this.pitch - event.movementY * 0.0024, -1.2, 1.2);
      this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
    });
  }

  private moveCamera(): void {
    const direction = new THREE.Vector3();
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw) * -1);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, Math.sin(this.yaw));
    if (this.keys.has("w")) direction.add(forward);
    if (this.keys.has("s")) direction.sub(forward);
    if (this.keys.has("d")) direction.add(right);
    if (this.keys.has("a")) direction.sub(right);
    if (direction.lengthSq() > 0) {
      direction.normalize().multiplyScalar(0.055);
      this.camera.position.add(direction);
      this.camera.position.x = THREE.MathUtils.clamp(this.camera.position.x, -4.5, 4.5);
      this.camera.position.z = THREE.MathUtils.clamp(this.camera.position.z, -4.5, 4.5);
    }
  }

  private resize(): void {
    const width = this.mount.clientWidth || window.innerWidth;
    const height = this.mount.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }
}

function meshForObject(object: RoomObject): THREE.Object3D {
  const material = new THREE.MeshStandardMaterial({ color: object.color, roughness: 0.58, metalness: object.kind === "light" ? 0.15 : 0 });
  const geometry = object.kind === "light" ? new THREE.SphereGeometry(0.4, 32, 16) : new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.fromArray(object.position);
  mesh.scale.fromArray(object.scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
