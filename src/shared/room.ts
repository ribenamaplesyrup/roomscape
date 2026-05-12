export type RoomObjectKind = "cube" | "table" | "sofa" | "column" | "light";
export type SurfaceTexture = "plain" | "carpet" | "plaster" | "tile" | "concrete" | "wood";

export interface SurfaceMaterial {
  texture: SurfaceTexture;
  color?: string;
}

export interface RoomObject {
  id: string;
  kind: RoomObjectKind;
  label: string;
  color: string;
  position: [number, number, number];
  scale: [number, number, number];
  intensity?: number;
}

export interface RoomConfig {
  name: string;
  palette: {
    wall: string;
    floor: string;
    ceiling: string;
    accent: string;
  };
  materials?: {
    floor?: SurfaceMaterial;
    wall?: SurfaceMaterial;
    ceiling?: SurfaceMaterial;
  };
  objects: RoomObject[];
  updatedAt: string;
}

export const emptyRoomConfig: RoomConfig = {
  name: "Untitled room",
  palette: {
    wall: "#d7d2c8",
    floor: "#8a8479",
    ceiling: "#f1eee8",
    accent: "#47b5a6",
  },
  objects: [],
  updatedAt: new Date(0).toISOString(),
};

/** Returns a plain, generated-content-free room suitable for starting over. */
export function freshRoomConfig(): RoomConfig {
  return {
    ...emptyRoomConfig,
    palette: { ...emptyRoomConfig.palette },
    name: "Bare Room",
    updatedAt: new Date(0).toISOString(),
  };
}
