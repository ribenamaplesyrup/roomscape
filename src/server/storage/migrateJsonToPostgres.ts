import { roomscapeDataPath } from "../config/paths";
import { JsonStore } from "./jsonStore";
import { PostgresStore } from "./postgresStore";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to migrate Roomscape JSON data into PostgreSQL.");
}

const source = new JsonStore(roomscapeDataPath(process.cwd(), process.env));
const target = new PostgresStore(databaseUrl, { env: process.env });
const data = await source.read();

await target.write(data);
await target.close();

console.log([
  "Migrated Roomscape data to PostgreSQL:",
  `${data.users.length} users`,
  `${data.sessions.length} sessions`,
  `${data.rooms.length} rooms`,
  `${data.activeRooms.length} active rooms`,
].join(" "));
