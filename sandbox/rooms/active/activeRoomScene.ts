import type { RoomSceneContext } from "../../../src/client/room/sceneTypes";

export const roomTitle = "Off-White Office Corridor";

export function buildRoom({ THREE, root, scene }: RoomSceneContext): void {
  scene.background = new THREE.Color("#f4f2ec");
  scene.fog = new THREE.Fog("#f4f2ec", 12, 24);

  const makeFiberTexture = (base: [number, number, number], variance: number, size: number) => {
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const stride = (y * size + x) * 4;
        const softNoise =
          Math.sin(x * 12.9898 + y * 78.233) * 0.5 +
          Math.sin(x * 3.37 + y * 11.17) * 0.28;
        const fiberLine = x % 9 === 0 || y % 11 === 0 ? -variance * 0.35 : 0;
        const grain = Math.round(softNoise * variance + fiberLine);
        const [red, green, blue] = base;
        data[stride] = Math.max(0, Math.min(255, red + grain));
        data[stride + 1] = Math.max(0, Math.min(255, green + grain));
        data[stride + 2] = Math.max(0, Math.min(255, blue + grain));
        data[stride + 3] = 255;
      }
    }

    const texture = new THREE.DataTexture(data, size, size);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    return texture;
  };

  const ceilingPanelTexture = makeFiberTexture([235, 232, 224], 10, 72);
  ceilingPanelTexture.repeat.set(1.4, 1.4);

  const wallPanelTexture = makeFiberTexture([229, 227, 220], 7, 64);
  wallPanelTexture.repeat.set(1.2, 1.2);

  const carpetTexture = makeFiberTexture([114, 118, 113], 18, 80);
  carpetTexture.repeat.set(10, 10);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardMaterial({
      color: "#767a74",
      map: carpetTexture,
      roughness: 0.96,
      metalness: 0,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  root.add(floor);

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardMaterial({ color: "#eeeae1", roughness: 1 }),
  );
  ceiling.position.y = 3;
  ceiling.rotation.x = Math.PI / 2;
  root.add(ceiling);

  const panelMaterial = new THREE.MeshStandardMaterial({
    color: "#f1efe8",
    map: ceilingPanelTexture,
    roughness: 1,
    metalness: 0,
  });
  const runnerMaterial = new THREE.MeshStandardMaterial({
    color: "#d7d4ca",
    roughness: 0.68,
    metalness: 0.12,
  });

  const ceilingGridSize = 8.4;
  const ceilingTileCount = 6;
  const runnerThickness = 0.035;
  const runnerDepth = 0.035;
  const tileGap = 0.035;
  const tileSize = ceilingGridSize / ceilingTileCount - tileGap;
  const tileStep = ceilingGridSize / ceilingTileCount;
  const tileStart = -ceilingGridSize / 2 + tileStep / 2;
  const ceilingPanelY = 2.958;
  const ceilingRunnerY = 2.975;

  for (let row = 0; row < ceilingTileCount; row += 1) {
    for (let column = 0; column < ceilingTileCount; column += 1) {
      const tile = new THREE.Mesh(new THREE.PlaneGeometry(tileSize, tileSize), panelMaterial);
      tile.position.set(tileStart + column * tileStep, ceilingPanelY, tileStart + row * tileStep);
      tile.rotation.x = Math.PI / 2;
      root.add(tile);
    }
  }

  for (let index = 0; index <= ceilingTileCount; index += 1) {
    const offset = -ceilingGridSize / 2 + index * tileStep;
    const northSouthRunner = new THREE.Mesh(
      new THREE.BoxGeometry(runnerThickness, runnerDepth, ceilingGridSize + runnerThickness),
      runnerMaterial,
    );
    northSouthRunner.position.set(offset, ceilingRunnerY, 0);
    root.add(northSouthRunner);

    const eastWestRunner = new THREE.Mesh(
      new THREE.BoxGeometry(ceilingGridSize + runnerThickness, runnerDepth, runnerThickness),
      runnerMaterial,
    );
    eastWestRunner.position.set(0, ceilingRunnerY, offset);
    root.add(eastWestRunner);
  }

  const wallMaterial = new THREE.MeshStandardMaterial({
    color: "#e8e5dd",
    map: wallPanelTexture,
    roughness: 0.92,
    metalness: 0,
  });
  const doorWallZ = -5;
  const doorHalfWidth = 0.95;
  const doorHeight = 2.06;
  const wallHeight = 3;
  const wallY = wallHeight / 2;
  const roomHalf = 5;
  const wallGeometry = new THREE.PlaneGeometry(10, wallHeight);

  const addWallSegment = (width: number, x: number, z: number, rotationY: number) => {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(width, wallHeight), wallMaterial);
    wall.position.set(x, wallY, z);
    wall.rotation.y = rotationY;
    root.add(wall);
  };

  const northWall = new THREE.Mesh(wallGeometry, wallMaterial);
  northWall.position.set(0, wallY, roomHalf);
  northWall.rotation.y = Math.PI;
  root.add(northWall);

  const westWall = new THREE.Mesh(wallGeometry, wallMaterial);
  westWall.position.set(-roomHalf, wallY, 0);
  westWall.rotation.y = Math.PI / 2;
  root.add(westWall);

  const eastWall = new THREE.Mesh(wallGeometry, wallMaterial);
  eastWall.position.set(roomHalf, wallY, 0);
  eastWall.rotation.y = -Math.PI / 2;
  root.add(eastWall);

  const southWallClearHalf = doorHalfWidth + 0.25;
  const southWallSegmentWidth = roomHalf - southWallClearHalf;
  addWallSegment(southWallSegmentWidth, -(roomHalf + southWallClearHalf) / 2, -roomHalf, 0);
  addWallSegment(southWallSegmentWidth, (roomHalf + southWallClearHalf) / 2, -roomHalf, 0);

  const corridorLength = 6;
  const corridorWidth = 2.4;
  const corridorDepth = corridorLength;
  const corridorZStart = -roomHalf;
  const corridorCenterZ = corridorZStart - corridorDepth / 2;
  const corridorHalfWidth = corridorWidth / 2;
  const corridorMaterial = new THREE.MeshStandardMaterial({
    color: "#ddd9d0",
    map: wallPanelTexture,
    roughness: 0.88,
    metalness: 0,
  });
  const corridorSideMaterial = new THREE.MeshStandardMaterial({
    color: "#d9d5cc",
    roughness: 0.82,
    metalness: 0.03,
  });

  const corridorFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(corridorWidth, corridorDepth),
    new THREE.MeshStandardMaterial({
      color: "#6f726f",
      map: carpetTexture,
      roughness: 0.96,
      metalness: 0,
    }),
  );
  corridorFloor.rotation.x = -Math.PI / 2;
  corridorFloor.position.set(0, 0, corridorCenterZ);
  root.add(corridorFloor);

  const corridorCeiling = new THREE.Mesh(
    new THREE.PlaneGeometry(corridorWidth, corridorDepth),
    corridorMaterial,
  );
  corridorCeiling.position.set(0, wallHeight, corridorCenterZ);
  corridorCeiling.rotation.x = Math.PI / 2;
  root.add(corridorCeiling);

  const corridorLeft = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, wallHeight, corridorDepth),
    corridorSideMaterial,
  );
  corridorLeft.position.set(-corridorHalfWidth, wallY, corridorCenterZ);
  root.add(corridorLeft);

  const corridorRight = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, wallHeight, corridorDepth),
    corridorSideMaterial,
  );
  corridorRight.position.set(corridorHalfWidth, wallY, corridorCenterZ);
  root.add(corridorRight);

  const corridorEndWall = new THREE.Mesh(
    new THREE.PlaneGeometry(corridorWidth, wallHeight),
    corridorMaterial,
  );
  corridorEndWall.position.set(0, wallY, corridorZStart - corridorDepth);
  corridorEndWall.rotation.y = 0;
  root.add(corridorEndWall);

  const wallTrimMaterial = new THREE.MeshStandardMaterial({
    color: "#d8d5cc",
    roughness: 0.78,
    metalness: 0.04,
  });
  const doorTrimMaterial = new THREE.MeshStandardMaterial({
    color: "#b3aca0",
    roughness: 0.62,
    metalness: 0.12,
  });
  const wallPanelWidth = 1.0;
  const wallPanelHeight = 1.0;
  const wallPanelColumns = 10;
  const wallPanelRows = 3;
  const seamDepth = 0.018;
  const seamLift = 0.012;

  const addWallSeams = (
    x: number,
    z: number,
    rotationY: number,
    horizontalAxis: "x" | "z",
    faceDirection: number,
    skipDoor = false,
  ) => {
    for (let column = 1; column < wallPanelColumns; column += 1) {
      const offset = -5 + column * wallPanelWidth;
      const insideDoorOpening =
        skipDoor && z === doorWallZ && Math.abs(offset) < doorHalfWidth + seamDepth;
      if (insideDoorOpening) {
        continue;
      }
      const seam = new THREE.Mesh(
        new THREE.BoxGeometry(0.026, 3, seamDepth),
        wallTrimMaterial,
      );
      if (horizontalAxis === "x") {
        seam.position.set(offset, 1.5, z + faceDirection * seamLift);
      } else {
        seam.position.set(x + faceDirection * seamLift, 1.5, offset);
      }
      seam.rotation.y = rotationY;
      root.add(seam);
    }

    for (let row = 1; row < wallPanelRows; row += 1) {
      const y = row * wallPanelHeight;
      const doorClearHeight = skipDoor && z === doorWallZ && y < doorHeight + 0.35;
      if (doorClearHeight) {
        continue;
      }
      const seam = new THREE.Mesh(
        new THREE.BoxGeometry(10, 0.026, seamDepth),
        wallTrimMaterial,
      );
      seam.position.set(x, y, z);
      if (horizontalAxis === "x") {
        seam.position.z += faceDirection * seamLift;
      } else {
        seam.position.x += faceDirection * seamLift;
      }
      seam.rotation.y = rotationY;
      root.add(seam);
    }
  };

  const addDoor = () => {
    const frameDepth = 0.055;
    const frameThickness = 0.06;
    const frameGap = 0.26;
    const frameHeight = doorHeight + frameGap * 2;

    const jambGeom = new THREE.BoxGeometry(frameThickness, frameHeight, frameDepth);
    const doorJambLeft = new THREE.Mesh(jambGeom, doorTrimMaterial);
    doorJambLeft.position.set(-doorHalfWidth - frameThickness / 2, frameHeight / 2, -frameDepth / 2);
    const doorJambRight = new THREE.Mesh(jambGeom, doorTrimMaterial);
    doorJambRight.position.set(doorHalfWidth + frameThickness / 2, frameHeight / 2, -frameDepth / 2);

    const door = new THREE.Group();
    door.add(doorJambLeft);
    door.add(doorJambRight);
    door.position.set(0, 0, doorWallZ);
    root.add(door);
  };

  addWallSeams(0, -5, 0, "x", 1, true);
  addWallSeams(0, 5, Math.PI, "x", -1);
  addWallSeams(-5, 0, Math.PI / 2, "z", 1);
  addWallSeams(5, 0, -Math.PI / 2, "z", -1);
  addDoor();

  const ambient = new THREE.HemisphereLight("#ffffff", "#7a766d", 1.35);
  root.add(ambient);

  const directional = new THREE.DirectionalLight("#fffdf7", 0.55);
  directional.position.set(2.5, 4.5, 3);
  root.add(directional);

  const softPanelLight = new THREE.PointLight("#fffaf0", 0.75, 8, 2);
  softPanelLight.position.set(0, 2.7, 0);
  root.add(softPanelLight);
}
