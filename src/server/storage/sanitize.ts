import type { RoomscapeData } from "./types";

export function sanitizeData(data: RoomscapeData): RoomscapeData {
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
