import { describe, expect, it } from "vitest";
import { createDataStore } from "../src/server/storage/createDataStore";
import { JsonStore } from "../src/server/storage/jsonStore";

describe("deployment data store configuration", () => {
  it("uses the JSON store when no database URL is configured", () => {
    const store = createDataStore("/app", { ROOMSCAPE_DATA_DIR: "/data" });

    expect(store).toBeInstanceOf(JsonStore);
  });

  it("fails clearly when a database URL is configured before Postgres storage exists", () => {
    expect(() => createDataStore("/app", { DATABASE_URL: "postgres://example", ROOMSCAPE_DATA_DIR: "/data" }))
      .toThrow("PostgreSQL DataStore is not implemented yet");
  });

  it("creates an empty JSON store shape when the configured file is missing", async () => {
    const store = createDataStore("/app", { ROOMSCAPE_DATA_PATH: "/tmp/roomscape-missing-data.json" }) as JsonStore;
    await expect(store.read()).resolves.toMatchObject({ users: [], sessions: [], rooms: [] });
  });
});
