import type { RoomSceneContext } from "../../../src/client/room/sceneTypes";

export const roomTitle = "Bare Room";

export function buildRoom({ THREE, root, scene }: RoomSceneContext): void {
  scene.background = new THREE.Color("#f1eee8");
  scene.fog = null;

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardMaterial({ color: "#8a8479", roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  root.add(floor);

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardMaterial({ color: "#f1eee8", roughness: 1 }),
  );
  ceiling.position.y = 3;
  ceiling.rotation.x = Math.PI / 2;
  root.add(ceiling);

  const wallMaterial = new THREE.MeshStandardMaterial({ color: "#d7d2c8", roughness: 1 });
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
    root.add(wall);
  }

  const ambient = new THREE.HemisphereLight("#ffffff", "#555555", 1.2);
  root.add(ambient);

  const directional = new THREE.DirectionalLight("#ffffff", 0.6);
  directional.position.set(2, 4, 3);
  root.add(directional);

  const plant = new THREE.Group();
  plant.position.set(0, 0, 0);

  const hangerMaterial = new THREE.MeshStandardMaterial({ color: "#7b6043", roughness: 0.9 });
  const potMaterial = new THREE.MeshStandardMaterial({ color: "#b46f4d", roughness: 0.82, metalness: 0.03 });
  const soilMaterial = new THREE.MeshStandardMaterial({ color: "#21160e", roughness: 1 });
  const stemMaterial = new THREE.MeshStandardMaterial({ color: "#31532d", roughness: 0.72 });
  const leafMaterial = new THREE.MeshStandardMaterial({
    color: "#2d7a43",
    roughness: 0.68,
    side: THREE.DoubleSide,
  });
  const leafAccentMaterial = new THREE.MeshStandardMaterial({
    color: "#4e995c",
    roughness: 0.66,
    side: THREE.DoubleSide,
  });
  const veinMaterial = new THREE.MeshStandardMaterial({ color: "#c8ddb0", roughness: 0.65 });

  const hangingPot = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.32, 0.44, 36, 3, false), potMaterial);
  hangingPot.position.y = 1.42;
  plant.add(hangingPot);

  const potRim = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.035, 10, 36), potMaterial);
  potRim.position.y = 1.64;
  potRim.rotation.x = Math.PI / 2;
  plant.add(potRim);

  const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.35, 0.028, 32), soilMaterial);
  soil.position.y = 1.655;
  plant.add(soil);

  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.012, 8, 24, Math.PI * 1.55), hangerMaterial);
  hook.position.y = 2.82;
  hook.rotation.z = Math.PI * 0.24;
  plant.add(hook);

  const cordPositions: Array<[number, number, number, number]> = [
    [0.34, 1.66, 0.08, -0.16],
    [-0.24, 1.66, 0.25, 0.1],
    [-0.12, 1.66, -0.34, 0.06],
  ];
  for (const [x, y, z, roll] of cordPositions) {
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 1.2, 8), hangerMaterial);
    cord.position.set(x * 0.5, y + 0.58, z * 0.5);
    cord.rotation.z = roll;
    cord.rotation.x = -z * 0.12;
    plant.add(cord);
  }

  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, -0.46);
  leafShape.bezierCurveTo(-0.28, -0.25, -0.33, 0.17, 0, 0.52);
  leafShape.bezierCurveTo(0.33, 0.17, 0.28, -0.25, 0, -0.46);
  const leafGeometry = new THREE.ShapeGeometry(leafShape, 18);
  leafGeometry.rotateX(-Math.PI / 2);
  leafGeometry.translate(0, 0.01, 0);

  const addLeaf = (
    x: number,
    y: number,
    z: number,
    scaleX: number,
    scaleZ: number,
    yaw: number,
    pitch: number,
    roll: number,
    accent: boolean,
  ) => {
    const leaf = new THREE.Mesh(leafGeometry.clone(), accent ? leafAccentMaterial : leafMaterial);
    leaf.position.set(x, y, z);
    leaf.scale.set(scaleX, 1, scaleZ);
    leaf.rotation.set(pitch, yaw, roll);
    plant.add(leaf);

    const midrib = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.68, 5), veinMaterial);
    midrib.position.set(x, y + 0.006, z);
    midrib.rotation.set(pitch + Math.PI / 2, yaw, roll);
    plant.add(midrib);
  };

  const stems: Array<[number, number, number, number, number, number, number]> = [
    [0.04, 1.69, 0.02, 0.48, -0.34, 0.18, 0.018],
    [-0.03, 1.7, 0.04, -0.44, -0.24, -0.12, 0.017],
    [0.02, 1.69, -0.02, 0.3, -0.48, -0.1, 0.016],
    [-0.05, 1.68, -0.01, -0.26, -0.4, 0.16, 0.016],
    [0.01, 1.7, 0.03, 0.1, 0.34, 0.08, 0.015],
  ];
  for (const [x, y, z, leanX, leanY, leanZ, radius] of stems) {
    const stemLength = Math.hypot(leanX, leanY, leanZ);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.75, radius, stemLength, 10), stemMaterial);
    stem.position.set(x + leanX * 0.5, y + leanY * 0.5, z + leanZ * 0.5);
    stem.rotation.z = -leanX * 0.85;
    stem.rotation.x = leanZ * 0.85;
    plant.add(stem);
  }

  const leaves: Array<[number, number, number, number, number, number, number, number, boolean]> = [
    [0.48, 1.36, 0.2, 0.38, 0.58, 0.82, -0.62, 0.2, false],
    [-0.45, 1.45, -0.1, 0.36, 0.54, -0.95, -0.56, -0.18, true],
    [0.3, 1.22, -0.34, 0.34, 0.52, 2.48, -0.7, -0.08, false],
    [-0.26, 1.28, 0.32, 0.32, 0.5, -2.45, -0.66, 0.12, false],
    [0.05, 1.96, 0.12, 0.32, 0.5, 0.1, -0.35, 0.04, true],
    [0.18, 1.03, 0.08, 0.28, 0.46, 0.35, -0.88, 0.18, false],
    [-0.12, 1.09, -0.22, 0.27, 0.44, -0.45, -0.84, -0.16, true],
  ];
  for (const [x, y, z, scaleX, scaleZ, yaw, pitch, roll, accent] of leaves) {
    addLeaf(x, y, z, scaleX, scaleZ, yaw, pitch, roll, accent);
  }

  root.add(plant);
}
