import { emptyData, type DataStore, type RoomscapeData } from "./types";

export class MemoryStore implements DataStore {
  private data: RoomscapeData;

  public constructor(seed: RoomscapeData = emptyData()) {
    this.data = structuredClone(seed);
  }

  /** Returns a defensive copy so tests and handlers cannot mutate storage implicitly. */
  public async read(): Promise<RoomscapeData> {
    return structuredClone(this.data);
  }

  /** Replaces the in-memory dataset atomically for test and local runner use. */
  public async write(data: RoomscapeData): Promise<void> {
    this.data = structuredClone(data);
  }
}
