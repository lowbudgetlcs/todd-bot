import { pgTable, serial, text, integer, varchar } from "drizzle-orm/pg-core";
export const teams = pgTable('teams', {
  id: serial('id').primaryKey(),
  name: text('name'),
  divsion_id: integer('division_id'),
  group_id: integer('group_id'),
});