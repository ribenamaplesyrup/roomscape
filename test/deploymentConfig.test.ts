import { describe, expect, it } from "vitest";
import { createDataStore } from "../src/server/storage/createDataStore";
import { JsonStore } from "../src/server/storage/jsonStore";
import { PostgresStore, postgresSslConfig } from "../src/server/storage/postgresStore";

describe("deployment data store configuration", () => {
  it("uses the JSON store when no database URL is configured", () => {
    const store = createDataStore("/app", { ROOMSCAPE_DATA_DIR: "/data" });

    expect(store).toBeInstanceOf(JsonStore);
  });

  it("uses the PostgreSQL store when a database URL is configured", async () => {
    const store = createDataStore("/app", { DATABASE_URL: "postgres://example", ROOMSCAPE_DATA_DIR: "/data" });

    expect(store).toBeInstanceOf(PostgresStore);
    await (store as PostgresStore).close();
  });

  it("creates an empty JSON store shape when the configured file is missing", async () => {
    const store = createDataStore("/app", { ROOMSCAPE_DATA_PATH: "/tmp/roomscape-missing-data.json" }) as JsonStore;
    await expect(store.read()).resolves.toMatchObject({ users: [], sessions: [], rooms: [] });
  });

  it("configures PostgreSQL SSL only when requested", () => {
    expect(postgresSslConfig("postgres://example/db", {})).toBeUndefined();
    expect(postgresSslConfig("postgres://example/db?sslmode=require", {})).toEqual({ rejectUnauthorized: false });
    expect(postgresSslConfig("postgres://example/db?sslmode=disable", {})).toBe(false);
    expect(postgresSslConfig("postgres://example/db", { ROOMSCAPE_DATABASE_SSL: "require" })).toEqual({ rejectUnauthorized: false });
  });
});
