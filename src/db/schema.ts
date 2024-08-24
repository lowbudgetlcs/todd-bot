import { pgTable, foreignKey, unique, pgEnum, serial, integer, bigint, boolean, varchar, timestamp, type AnyPgColumn, index, char, text, uniqueIndex } from "drizzle-orm/pg-core"
  import { sql } from "drizzle-orm"

export const aal_level = pgEnum("aal_level", ['aal1', 'aal2', 'aal3'])
export const code_challenge_method = pgEnum("code_challenge_method", ['s256', 'plain'])
export const factor_status = pgEnum("factor_status", ['unverified', 'verified'])
export const factor_type = pgEnum("factor_type", ['totp', 'webauthn', 'phone'])
export const one_time_token_type = pgEnum("one_time_token_type", ['confirmation_token', 'reauthentication_token', 'recovery_token', 'email_change_token_new', 'email_change_token_current', 'phone_change_token'])
export const key_status = pgEnum("key_status", ['default', 'valid', 'invalid', 'expired'])
export const key_type = pgEnum("key_type", ['aead-ietf', 'aead-det', 'hmacsha512', 'hmacsha256', 'auth', 'shorthash', 'generichash', 'kdf', 'secretbox', 'secretstream', 'stream_xchacha20'])
export const action = pgEnum("action", ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'ERROR'])
export const equality_op = pgEnum("equality_op", ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in'])


export const series = pgTable("series", {
	id: serial("id").primaryKey().notNull(),
	team1_id: integer("team1_id").references(() => teams.id, { onDelete: "set null", onUpdate: "cascade" } ),
	team2_id: integer("team2_id").references(() => teams.id, { onDelete: "set null", onUpdate: "cascade" } ),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	message_id: bigint("message_id", { mode: "number" }),
	playoffs: boolean("playoffs").notNull(),
	win_condition: integer("win_condition").notNull(),
	winner_id: integer("winner_id").references(() => teams.id, { onDelete: "set null", onUpdate: "cascade" } ),
},
(table) => {
	return {
		series_team1_id_team2_id_playoffs_key: unique("series_team1_id_team2_id_playoffs_key").on(table.team1_id, table.team2_id, table.playoffs),
	}
});

export const games = pgTable("games", {
	id: serial("id").primaryKey().notNull(),
	short_code: varchar("short_code", { length: 100 }).notNull(),
	winner_id: integer("winner_id").references(() => teams.id, { onDelete: "set null", onUpdate: "cascade" } ),
	loser_id: integer("loser_id").references(() => teams.id, { onUpdate: "cascade" } ),
	series_id: integer("series_id").notNull().references(() => series.id, { onDelete: "set null", onUpdate: "cascade" } ),
	result_id: integer("result_id").references(() => results.id, { onDelete: "set null", onUpdate: "cascade" } ),
	game_num: integer("game_num").default(0).notNull(),
	processed: boolean("processed").default(false).notNull(),
	created_at: timestamp("created_at", { mode: 'string' }).defaultNow(),
});

export const teams = pgTable("teams", {
	id: serial("id").primaryKey().notNull(),
	name: varchar("name", { length: 255 }).notNull(),
	division_id: integer("division_id").references(() => divisions.id, { onDelete: "set null", onUpdate: "cascade" } ),
	group_id: char("group_id", { length: 1 }).notNull(),
	captain_id: integer("captain_id").references((): AnyPgColumn => players.id, { onDelete: "set null", onUpdate: "cascade" } ),
	logo: varchar("logo"),
},
(table) => {
	return {
		lower_idx: index("teams_lower_idx").using("btree", sql`lower((name)::text)`),
	}
});

export const standings = pgTable("standings", {
	id: serial("id").primaryKey().notNull(),
	placement: integer("placement").notNull(),
	division_id: integer("division_id").notNull(),
	group_id: char("group_id", { length: 1 }).notNull(),
	team_id: integer("team_id").notNull().references(() => teams.id, { onDelete: "set null", onUpdate: "cascade" } ),
});

export const schedules = pgTable("schedules", {
	id: serial("id").primaryKey().notNull(),
	week: integer("week").notNull(),
	division_id: integer("division_id").notNull().references(() => divisions.id, { onDelete: "set null", onUpdate: "cascade" } ),
	group_id: char("group_id", { length: 1 }).notNull(),
	series_id: integer("series_id").notNull().references(() => series.id, { onDelete: "set null", onUpdate: "cascade" } ),
});

export const divisions = pgTable("divisions", {
	id: serial("id").primaryKey().notNull(),
	name: varchar("name", { length: 20 }).notNull(),
	description: text("description"),
	provider_id: integer("provider_id").notNull(),
	tournament_id: integer("tournament_id").notNull(),
	groups: integer("groups"),
},
(table) => {
	return {
		lower_idx: index("divisions_lower_idx").using("btree", sql`lower((name)::text)`),
		divisions_tournament_id_key: unique("divisions_tournament_id_key").on(table.tournament_id),
	}
});

export const players = pgTable("players", {
	id: serial("id").primaryKey().notNull(),
	primary_riot_puuid: char("primary_riot_puuid", { length: 78 }).notNull(),
	team_id: integer("team_id").references((): AnyPgColumn => teams.id, { onDelete: "set null", onUpdate: "cascade" } ),
	summoner_name: varchar("summoner_name", { length: 40 }),
},
(table) => {
	return {
		primary_riot_puuid_idx: uniqueIndex("players_primary_riot_puuid_idx").using("btree", table.primary_riot_puuid),
		players_primary_riot_puuid_key: unique("players_primary_riot_puuid_key").on(table.primary_riot_puuid),
		players_summoner_name_key: unique("players_summoner_name_key").on(table.summoner_name),
	}
});

export const accounts = pgTable("accounts", {
	id: serial("id").primaryKey().notNull(),
	riot_puuid: char("riot_puuid", { length: 78 }).notNull(),
	player_id: integer("player_id").notNull().references(() => players.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	is_primary: boolean("is_primary").notNull(),
});

export const group_keys = pgTable("group_keys", {
	id: integer("id").primaryKey().notNull(),
	letter: char("letter", { length: 1 }),
},
(table) => {
	return {
		lower_idx: index("group_keys_lower_idx").using("btree", sql`lower((letter)::text)`),
	}
});

export const results = pgTable("results", {
	id: serial("id").primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	start_time: bigint("start_time", { mode: "number" }),
	short_code: varchar("short_code", { length: 100 }).notNull(),
	meta_data: text("meta_data").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	game_id: bigint("game_id", { mode: "number" }),
	game_name: varchar("game_name", { length: 60 }),
	game_type: varchar("game_type", { length: 20 }),
	game_map: integer("game_map"),
	game_mode: varchar("game_mode", { length: 20 }),
	region: varchar("region", { length: 20 }),
},
(table) => {
	return {
		uq_short_code: unique("uq_short_code").on(table.short_code),
	}
});