import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { emptyData, type DataStore, type RoomscapeData } from "./types";

export class JsonStore implements DataStore {
  public constructor(private readonly filePath: string) {}

  /** Reads the file-backed database, creating an empty shape when it does not exist yet. */
  public async read(): Promise<RoomscapeData> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return sanitizeData(JSON.parse(raw) as RoomscapeData);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyData();
      }
      throw error;
    }
  }

  /** Writes the database with a single JSON document for easy local inspection. */
  public async write(data: RoomscapeData): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(sanitizeData(data), null, 2)}\n`, "utf8");
  }
}

function sanitizeData(data: RoomscapeData): RoomscapeData {
  return {
    ...data,
    users: data.users.map((user) => {
      const { architectName, architectDescription, architectPersona, encryptedOpenAiKey, passwordHash, passwordSalt, username, ...safeUser } = user as typeof user & Record<string, unknown>;
      void architectName;
      void architectDescription;
      void architectPersona;
      void encryptedOpenAiKey;
      void passwordHash;
      void passwordSalt;
      void username;
      return {
        ...safeUser,
        authMode: safeUser.authMode ?? "chatgpt",
        accountLabel: safeUser.accountLabel ?? safeUser.openAiAccountLabel ?? "OpenAI account",
      };
    }),
    rooms: data.rooms.map((room) => ({
      ...room,
      sceneSource: room.sceneSource ?? "",
    })),
    activeRooms: (data.activeRooms ?? []).map((activeRoom) => ({
      ...activeRoom,
      config: activeRoom.config,
      ...(activeRoom.sceneSource ? { sceneSource: activeRoom.sceneSource } : {}),
    })),
  };
}
