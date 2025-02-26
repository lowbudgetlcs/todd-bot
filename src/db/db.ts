import "dotenv/config";

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
 
const { Pool } = pg; 
console.log(process)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 15,
  prepare: false
});

export const db = drizzle({client: pool});