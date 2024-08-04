// drizzle.config.ts
import { defineConfig } from "drizzle-kit";
import dotenv from 'dotenv';

dotenv.config();
const supabaseUrl = process.env.SUPABASE_URL!;
console.log(supabaseUrl);
export default defineConfig({
  schema: "./src/schema/*",
  out: "./drizzle",
  dialect: 'postgresql',
  dbCredentials: {
    url: supabaseUrl,
  }
});