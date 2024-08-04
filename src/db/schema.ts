import { pgTable, pgEnum, serial, bigint, char, text, integer, varchar, foreignKey, boolean, index, type AnyPgColumn, smallint } from "drizzle-orm/pg-core"
  import { sql } from "drizzle-orm"

export const aal_level = pgEnum("aal_level", ['aal1', 'aal2', 'aal3'])
export const code_challenge_method = pgEnum("code_challenge_method", ['s256', 'plain'])
export const factor_status = pgEnum("factor_status", ['unverified', 'verified'])
export const factor_type = pgEnum("factor_type", ['totp', 'webauthn'])
export const one_time_token_type = pgEnum("one_time_token_type", ['confirmation_token', 'reauthentication_token', 'recovery_token', 'email_change_token_new', 'email_change_token_current', 'phone_change_token'])
export const key_status = pgEnum("key_status", ['default', 'valid', 'invalid', 'expired'])
export const key_type = pgEnum("key_type", ['aead-ietf', 'aead-det', 'hmacsha512', 'hmacsha256', 'auth', 'shorthash', 'generichash', 'kdf', 'secretbox', 'secretstream', 'stream_xchacha20'])
export const action = pgEnum("action", ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'ERROR'])
export const equality_op = pgEnum("equality_op", ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in'])


export const results = pgTable("results", {
	id: serial("id").primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	start_time: bigint("start_time", { mode: "number" }),
	short_code: char("short_code", { length: 44 }).notNull(),
	meta_data: text("meta_data").notNull(),
	game_id: integer("game_id"),
	game_name: varchar("game_name", { length: 60 }),
	game_type: varchar("game_type", { length: 20 }),
	game_map: varchar("game_map", { length: 20 }),
	game_mode: varchar("game_mode", { length: 20 }),
	region: varchar("region", { length: 20 }),
});

export const accounts = pgTable("accounts", {
	id: serial("id").primaryKey().notNull(),
	riot_puuid: char("riot_puuid", { length: 78 }).notNull(),
	player_id: integer("player_id").notNull().references(() => players.id),
	is_primary: boolean("is_primary").notNull(),
});

export const divisions = pgTable("divisions", {
	id: serial("id").primaryKey().notNull(),
	name: varchar("name", { length: 20 }),
	description: text("description"),
	provider_id: integer("provider_id").notNull(),
	tournament_id: integer("tournament_id").notNull(),
	groups: integer("groups"),
},
(table) => {
	return {
		lower_idx: index("divisions_lower_idx").using("btree", sql`lower((name)::text)`),
	}
});

export const games = pgTable("games", {
	id: serial("id").primaryKey().notNull(),
	short_code: char("short_code", { length: 44 }).notNull(),
	winner_id: integer("winner_id").references(() => teams.id),
	loser_id: integer("loser_id").references(() => teams.id),
	series_id: integer("series_id").notNull().references(() => series.id),
	result_id: integer("result_id").references(() => results.id),
	game_num: integer("game_num"),
});

export const performances = pgTable("performances", {
	id: serial("id").primaryKey().notNull(),
	player_id: integer("player_id").references(() => players.id),
	team_id: integer("team_id").references(() => teams.id),
	game_id: integer("game_id").references(() => games.id),
});

export const players = pgTable("players", {
	id: serial("id").primaryKey().notNull(),
	primary_riot_puuid: char("primary_riot_puuid", { length: 78 }).notNull(),
	team_id: integer("team_id").references((): AnyPgColumn => teams.id),
});

export const schedules = pgTable("schedules", {
	id: serial("id").primaryKey().notNull(),
	week: integer("week").notNull(),
	division_id: integer("division_id").notNull().references(() => divisions.id),
	group_id: char("group_id", { length: 1 }).notNull(),
	series_id: integer("series_id").notNull().references(() => series.id),
});

export const series = pgTable("series", {
	id: serial("id").primaryKey().notNull(),
	team1_id: integer("team1_id").notNull().references(() => teams.id),
	team2_id: integer("team2_id").notNull().references(() => teams.id),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	message_id: bigint("message_id", { mode: "number" }),
	playoffs: boolean("playoffs").notNull(),
	win_condition: integer("win_condition").notNull(),
});

export const standings = pgTable("standings", {
	id: serial("id").primaryKey().notNull(),
	placement: integer("placement").notNull(),
	division_id: integer("division_id").notNull(),
	group_id: char("group_id", { length: 1 }).notNull(),
	team_id: integer("team_id").notNull().references(() => teams.id),
});

export const teams = pgTable("teams", {
	id: serial("id").primaryKey().notNull(),
	name: varchar("name", { length: 255 }).notNull(),
	division_id: integer("division_id").notNull().references(() => divisions.id),
	group_id: char("group_id", { length: 1 }).notNull(),
	captain_id: integer("captain_id").references((): AnyPgColumn => players.id),
	logo: varchar("logo"),
},
(table) => {
	return {
		lower_idx: index("teams_lower_idx").using("btree", sql`lower((name)::text)`),
	}
});

export const group_keys = pgTable("group_keys", {
	id: smallint("id").primaryKey().notNull(),
	letter: char("letter", { length: 1 }),
},
(table) => {
	return {
		lower_idx: index("group_keys_lower_idx").using("btree", sql`lower((letter)::text)`),
	}
});