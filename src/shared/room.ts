export type RoomObjectKind = "cube" | "table" | "sofa" | "column" | "light";

export interface RoomObject {
  id: string;
  kind: RoomObjectKind;
  label: string;
  color: string;
  position: [number, number, number];
  scale: [number, number, number];
}

export interface RoomConfig {
  name: string;
  palette: {
    wall: string;
    floor: string;
    ceiling: string;
    accent: string;
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
