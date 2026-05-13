import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { SavedRoom } from "../../shared/api";
import { emptyRoomConfig } from "../../shared/room";

interface FeaturedRoomDefinition {
  id: string;
  name: string;
  config: SavedRoom["config"];
  sourceFile: URL;
  createdAt: string;
  updatedAt: string;
}

const featuredUserId = "__featured__";
const auroraTimestamp = "2026-05-13T00:00:00.000Z";

const featuredRoomDefinitions: FeaturedRoomDefinition[] = [
  {
    id: "featured-aurora-atlas-lounge",
    name: "Aurora Atlas Lounge",
    config: {
      ...emptyRoomConfig,
      name: "Aurora Atlas Lounge",
      palette: {
        wall: "#111927",
        floor: "#17202b",
        ceiling: "#08131d",
        accent: "#7cf4ff",
      },
      updatedAt: auroraTimestamp,
    },
    sourceFile: new URL("./featured/auroraAtlasLounge.roomScene.ts.txt", import.meta.url),
    createdAt: auroraTimestamp,
    updatedAt: auroraTimestamp,
  },
];

let cachedFeaturedRooms: Promise<SavedRoom[]> | null = null;

export function featuredRoomIds(): Set<string> {
  return new Set(featuredRoomDefinitions.map((room) => room.id));
}

export async function featuredRooms(): Promise<SavedRoom[]> {
  cachedFeaturedRooms ??= Promise.all(featuredRoomDefinitions.map(toSavedRoom));
  return structuredClone(await cachedFeaturedRooms);
}

async function toSavedRoom(definition: FeaturedRoomDefinition): Promise<SavedRoom> {
  return {
    id: definition.id,
    userId: featuredUserId,
    name: definition.name,
    config: structuredClone(definition.config),
    sceneSource: await readFile(fileURLToPath(definition.sourceFile), "utf8"),
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
  };
}
