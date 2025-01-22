// drizzle.config.ts
import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";

dotenv.config();
const supabaseUrl = process.env.SUPABASE_URL!;
export default defineConfig({
  schema: "./src/db/*",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: supabaseUrl,
  },
});
