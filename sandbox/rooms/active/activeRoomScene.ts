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
}
