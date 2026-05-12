import type { RoomConfig } from "../../../shared/room";

export const roomConfig = {
  name: "Bare Room",
  palette: {
    wall: "#d7d2c8",
    floor: "#8a8479",
    ceiling: "#f1eee8",
    accent: "#47b5a6",
  },
  objects: [],
  updatedAt: new Date(0).toISOString(),
} satisfies RoomConfig;
