import pg, { type Pool, type PoolConfig } from "pg";
import { sanitizeData } from "./sanitize";
import type { ActiveRoomRecord, DataStore, RoomRecord, RoomscapeData, SessionRecord, UserRecord } from "./types";

const { Pool: PgPool } = pg;
const advisoryLockKey = 7_794_337_001;

export class PostgresStore implements DataStore {
  private readonly pool: Pool;
  private schemaReady: Promise<void> | null = null;

  public constructor(connectionString: string, options: { pool?: Pool; env?: NodeJS.ProcessEnv } = {}) {
    this.pool = options.pool ?? new PgPool(poolConfig(connectionString, options.env ?? process.env));
  }

  /** Reads the normalized Roomscape data snapshot from PostgreSQL tables. */
  public async read(): Promise<RoomscapeData> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      const [users, sessions, rooms, activeRooms] = await Promise.all([
        client.query<UserRow>("SELECT * FROM roomscape_users ORDER BY created_at ASC, id ASC"),
        client.query<SessionRow>("SELECT * FROM roomscape_sessions ORDER BY created_at ASC, id ASC"),
        client.query<RoomRow>("SELECT * FROM roomscape_rooms ORDER BY created_at ASC, id ASC"),
        client.query<ActiveRoomRow>("SELECT * FROM roomscape_active_rooms ORDER BY updated_at ASC, user_id ASC"),
      ]);
      return sanitizeData({
        users: users.rows.map(userFromRow),
        sessions: sessions.rows.map(sessionFromRow),
        rooms: rooms.rows.map(roomFromRow),
        activeRooms: activeRooms.rows.map(activeRoomFromRow),
      });
    } finally {
      client.release();
    }
  }

  /** Replaces the PostgreSQL snapshot with the supplied Roomscape data inside one transaction. */
  public async write(data: RoomscapeData): Promise<void> {
    await this.ensureSchema();
    const sanitized = sanitizeData(data);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [advisoryLockKey]);
      await client.query("TRUNCATE roomscape_active_rooms, roomscape_rooms, roomscape_sessions, roomscape_users");
      for (const user of sanitized.users) {
        await client.query(
          `INSERT INTO roomscape_users (
            id, auth_mode, open_ai_account_hash, open_ai_account_label, account_label,
            codex_auth_ref, remember_token_hash, plan_type, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            user.id,
            user.authMode,
            user.openAiAccountHash ?? null,
            user.openAiAccountLabel ?? null,
            user.accountLabel ?? null,
            user.codexAuthRef ?? null,
            user.rememberTokenHash ?? null,
            user.planType ?? null,
            user.createdAt,
            user.updatedAt,
          ],
        );
      }
      for (const session of sanitized.sessions) {
        await client.query(
          "INSERT INTO roomscape_sessions (id, user_id, created_at) VALUES ($1, $2, $3)",
          [session.id, session.userId, session.createdAt],
        );
      }
      for (const room of sanitized.rooms) {
        await client.query(
          `INSERT INTO roomscape_rooms (
            id, user_id, name, config, scene_source, created_at, updated_at
          ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
          [room.id, room.userId, room.name, JSON.stringify(room.config), room.sceneSource, room.createdAt, room.updatedAt],
        );
      }
      for (const activeRoom of sanitized.activeRooms) {
        await client.query(
          "INSERT INTO roomscape_active_rooms (user_id, config, scene_source, updated_at) VALUES ($1, $2::jsonb, $3, $4)",
          [activeRoom.userId, JSON.stringify(activeRoom.config), activeRoom.sceneSource ?? null, activeRoom.updatedAt],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }

  private async ensureSchema(): Promise<void> {
    this.schemaReady ??= this.migrate();
    await this.schemaReady;
  }

  private async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS roomscape_users (
        id text PRIMARY KEY,
        auth_mode text NOT NULL,
        open_ai_account_hash text UNIQUE,
        open_ai_account_label text,
        account_label text,
        codex_auth_ref text,
        remember_token_hash text UNIQUE,
        plan_type text,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );

      CREATE TABLE IF NOT EXISTS roomscape_sessions (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES roomscape_users(id) ON DELETE CASCADE,
        created_at text NOT NULL
      );

      CREATE TABLE IF NOT EXISTS roomscape_rooms (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES roomscape_users(id) ON DELETE CASCADE,
        name text NOT NULL,
        config jsonb NOT NULL,
        scene_source text NOT NULL,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );

      CREATE TABLE IF NOT EXISTS roomscape_active_rooms (
        user_id text PRIMARY KEY REFERENCES roomscape_users(id) ON DELETE CASCADE,
        config jsonb NOT NULL,
        scene_source text,
        updated_at text NOT NULL
      );

      CREATE INDEX IF NOT EXISTS roomscape_sessions_user_id_idx ON roomscape_sessions(user_id);
      CREATE INDEX IF NOT EXISTS roomscape_rooms_user_id_updated_at_idx ON roomscape_rooms(user_id, updated_at DESC);
    `);
  }
}

export function poolConfig(connectionString: string, env: NodeJS.ProcessEnv): PoolConfig {
  const ssl = postgresSslConfig(connectionString, env);
  return {
    connectionString,
    max: Number.parseInt(env.ROOMSCAPE_DATABASE_POOL_SIZE ?? "5", 10),
    ...(ssl !== undefined ? { ssl } : {}),
  };
}

export function postgresSslConfig(connectionString: string, env: NodeJS.ProcessEnv): PoolConfig["ssl"] | undefined {
  const configured = env.ROOMSCAPE_DATABASE_SSL?.trim().toLowerCase();
  if (configured === "false" || configured === "0" || configured === "disable") return false;
  if (configured === "verify-full" || configured === "true-verify") return true;
  if (configured === "true" || configured === "1" || configured === "require" || configured === "no-verify") return { rejectUnauthorized: false };
  const url = new URL(connectionString);
  const sslMode = url.searchParams.get("sslmode")?.toLowerCase();
  if (sslMode === "disable") return false;
  if (sslMode === "verify-full") return true;
  if (sslMode === "require" || sslMode === "prefer" || sslMode === "no-verify") return { rejectUnauthorized: false };
  return undefined;
}

interface UserRow {
  id: string;
  auth_mode: UserRecord["authMode"];
  open_ai_account_hash: string | null;
  open_ai_account_label: string | null;
  account_label: string | null;
  codex_auth_ref: string | null;
  remember_token_hash: string | null;
  plan_type: string | null;
  created_at: string;
  updated_at: string;
}

interface SessionRow {
  id: string;
  user_id: string;
  created_at: string;
}

interface RoomRow {
  id: string;
  user_id: string;
  name: string;
  config: RoomRecord["config"];
  scene_source: string;
  created_at: string;
  updated_at: string;
}

interface ActiveRoomRow {
  user_id: string;
  config: ActiveRoomRecord["config"];
  scene_source: string | null;
  updated_at: string;
}

function userFromRow(row: UserRow): UserRecord {
  return {
    id: row.id,
    authMode: row.auth_mode,
    ...(row.open_ai_account_hash ? { openAiAccountHash: row.open_ai_account_hash } : {}),
    ...(row.open_ai_account_label ? { openAiAccountLabel: row.open_ai_account_label } : {}),
    ...(row.account_label ? { accountLabel: row.account_label } : {}),
    ...(row.codex_auth_ref ? { codexAuthRef: row.codex_auth_ref } : {}),
    ...(row.remember_token_hash ? { rememberTokenHash: row.remember_token_hash } : {}),
    ...(row.plan_type ? { planType: row.plan_type } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sessionFromRow(row: SessionRow): SessionRecord {
  return { id: row.id, userId: row.user_id, createdAt: row.created_at };
}

function roomFromRow(row: RoomRow): RoomRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    config: row.config,
    sceneSource: row.scene_source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function activeRoomFromRow(row: ActiveRoomRow): ActiveRoomRecord {
  return {
    userId: row.user_id,
    config: row.config,
    ...(row.scene_source ? { sceneSource: row.scene_source } : {}),
    updatedAt: row.updated_at,
  };
}
