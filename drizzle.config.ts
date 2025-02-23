// drizzle.config.ts
import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";

dotenv.config();
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw Error('Database URL not set.');
export default defineConfig({
  schema: "./src/db/*",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
