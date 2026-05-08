import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://yavin:yavin@localhost:5432/yavin_iv";

declare global {
  // eslint-disable-next-line no-var
  var __yavin_pg__: ReturnType<typeof postgres> | undefined;
}

const client = globalThis.__yavin_pg__ ?? postgres(connectionString, { max: 10 });
if (process.env.NODE_ENV !== "production") {
  globalThis.__yavin_pg__ = client;
}

export const db = drizzle(client, { schema });
export { schema };
