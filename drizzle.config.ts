// drizzle.config.ts
import { defineConfig } from "drizzle-kit";
import dotenv from 'dotenv';

dotenv.config();
const supabaseUrl = process.env.SUPABASE_URL!;
console.log(supabaseUrl);
export default defineConfig({
  dialect: "postgresql", // "mysql" | "sqlite"
  dbCredentials: {
    url: supabaseUrl,
  },
  schema: "./src/schema.ts",
  out: "./drizzle",
});