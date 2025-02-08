import { pgTable, serial, varchar, bigint, type AnyPgColumn, foreignKey, unique, char, integer, text, jsonb, timestamp, boolean, smallint, pgEnum, customType } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const riftSide = pgEnum("rift_side", ['BLUE', 'RED'])
const bytea = customType<{
	data: Buffer,
	default: false
}>({
    dataType() {
      return 'bytea';
    },
});


export const commandRolePermissions = pgTable("command_role_permissions", {
	id: serial().primaryKey().notNull(),
	name: varchar().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	roleId: bigint("role_id", { mode: "number" }).notNull(),
});

export const commandChannelPermissions = pgTable("command_channel_permissions", {
	id: serial().primaryKey().notNull(),
	name: varchar().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	channelId: bigint("channel_id", { mode: "number" }).notNull(),
});

export const players = pgTable("players", {
	id: serial().primaryKey().notNull(),
	riotPuuid: char("riot_puuid", { length: 78 }).notNull(),
	summonerName: varchar("summoner_name", { length: 25 }),
	teamId: integer("team_id"),
}, (table) => [
	foreignKey({
			columns: [table.teamId],
			foreignColumns: [teams.id],
			name: "fk_team_id"
		}).onDelete("set null"),
	unique("players_riot_puuid_key").on(table.riotPuuid),
]);

export const teams = pgTable("teams", {
	id: serial().primaryKey().notNull(),
	name: varchar({ length: 100 }).notNull(),
	logo: text(),
	captainId: integer("captain_id"),
	divisionId: integer("division_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.captainId],
			foreignColumns: [players.id],
			name: "fk_captain_id"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.divisionId],
			foreignColumns: [divisions.id],
			name: "fk_division_id"
		}),
]);

export const games = pgTable("games", {
	id: serial().primaryKey().notNull(),
	shortcode: varchar({ length: 100 }).notNull(),
	gameNum: integer("game_num").notNull(),
	winnerId: integer("winner_id"),
	loserId: integer("loser_id"),
	callbackResult: jsonb("callback_result"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	seriesId: integer("series_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.loserId],
			foreignColumns: [teams.id],
			name: "fk_loser_id"
		}),
	foreignKey({
			columns: [table.seriesId],
			foreignColumns: [series.id],
			name: "fk_series_id"
		}),
	foreignKey({
			columns: [table.winnerId],
			foreignColumns: [teams.id],
			name: "fk_winner_id"
		}),
	unique("games_shortcode_key").on(table.shortcode),
]);

export const teamToSeries = pgTable("team_to_series", {
	id: serial().primaryKey().notNull(),
	teamId: integer("team_id").notNull(),
	seriesId: integer("series_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.seriesId],
			foreignColumns: [series.id],
			name: "fk_series_id"
		}),
	foreignKey({
			columns: [table.teamId],
			foreignColumns: [teams.id],
			name: "fk_team_id"
		}),
]);

export const series = pgTable("series", {
	id: serial().primaryKey().notNull(),
	divisionId: integer("division_id").notNull(),
	winnerId: integer("winner_id"),
	loserId: integer("loser_id"),
	playoffs: boolean().default(false).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.loserId],
			foreignColumns: [teams.id],
			name: "fk_loser_id"
		}),
	foreignKey({
			columns: [table.winnerId],
			foreignColumns: [teams.id],
			name: "fk_winner_id"
		}),
	foreignKey({
			columns: [table.divisionId],
			foreignColumns: [divisions.id],
			name: "series_division_id_fkey"
		}),
]);

export const teamGameData = pgTable("team_game_data", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "team_game_data_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	teamPerformanceId: integer("team_performance_id").notNull(),
	gold: integer().notNull(),
	kills: integer().notNull(),
	side: text().notNull(),
	win: boolean().notNull(),
	gameLength: integer("game_length").notNull(),
	barons: integer().default(0).notNull(),
	dragons: integer().default(0).notNull(),
	grubs: integer().default(0).notNull(),
	heralds: integer().default(0).notNull(),
	towers: integer().default(0).notNull(),
	inhibitors: integer().default(0).notNull(),
	firstBaron: boolean("first_baron").default(false).notNull(),
	firstDragon: boolean("first_dragon").default(false).notNull(),
	firstGrub: boolean("first_grub").default(false).notNull(),
	firstHerald: boolean("first_herald").default(false).notNull(),
	firstTower: boolean("first_tower").default(false).notNull(),
	firstInhibitor: boolean("first_inhibitor").default(false).notNull(),
	firstBlood: boolean("first_blood").default(false).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.teamPerformanceId],
			foreignColumns: [teamPerformances.id],
			name: "team_game_data_team_performance_id_fkey"
		}),
	unique("team_game_data_team_performance_id_key").on(table.teamPerformanceId),
]);

export const teamPerformances = pgTable("team_performances", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "team_performances_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	teamId: integer("team_id"),
	gameId: integer("game_id"),
	divisionId: integer("division_id"),
}, (table) => [
	foreignKey({
			columns: [table.divisionId],
			foreignColumns: [divisions.id],
			name: "team_performances_division_id_fkey"
		}),
	foreignKey({
			columns: [table.gameId],
			foreignColumns: [games.id],
			name: "team_performances_game_id_fkey"
		}),
	foreignKey({
			columns: [table.teamId],
			foreignColumns: [teams.id],
			name: "team_performances_team_id_fkey"
		}),
	unique("team_performances_team_id_game_id_key").on(table.teamId, table.gameId),
]);

export const playerGameData = pgTable("player_game_data", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "player_game_data_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	playerPerformanceId: integer("player_performance_id").notNull(),
	kills: integer().default(0).notNull(),
	deaths: integer().default(0).notNull(),
	assists: integer().default(0).notNull(),
	level: integer().default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	gold: bigint({ mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	visionScore: bigint("vision_score", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	damage: bigint({ mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	healing: bigint({ mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	shielding: bigint({ mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	damageTaken: bigint("damage_taken", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	selfMitigatedDamage: bigint("self_mitigated_damage", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	damageToTurrets: bigint("damage_to_turrets", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	longestLife: bigint("longest_life", { mode: "number" }).default(0).notNull(),
	doubleKills: smallint("double_kills").default(0).notNull(),
	tripleKills: smallint("triple_kills").default(0).notNull(),
	quadraKills: smallint("quadra_kills").default(0).notNull(),
	pentaKills: smallint("penta_kills").default(0).notNull(),
	cs: integer().default(0).notNull(),
	championName: varchar("champion_name", { length: 25 }).notNull(),
	item0: integer(),
	item1: integer(),
	item2: integer(),
	item3: integer(),
	item4: integer(),
	item5: integer(),
	trinket: integer(),
	keystoneRune: integer("keystone_rune").notNull(),
	secondaryTree: integer("secondary_tree").notNull(),
	summoner1: integer().notNull(),
	summoner2: integer().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.playerPerformanceId],
			foreignColumns: [playerPerformances.id],
			name: "player_game_data_player_performance_id_fkey"
		}),
	unique("player_game_data_player_performance_id_key").on(table.playerPerformanceId),
]);

export const playerPerformances = pgTable("player_performances", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "player_performances_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	playerId: integer("player_id").notNull(),
	gameId: integer("game_id").notNull(),
	teamId: integer("team_id").notNull(),
	divisionId: integer("division_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.divisionId],
			foreignColumns: [divisions.id],
			name: "player_performances_division_id_fkey"
		}),
	foreignKey({
			columns: [table.gameId],
			foreignColumns: [games.id],
			name: "player_performances_game_id_fkey"
		}),
	foreignKey({
			columns: [table.playerId],
			foreignColumns: [players.id],
			name: "player_performances_player_id_fkey"
		}),
	foreignKey({
			columns: [table.teamId],
			foreignColumns: [teams.id],
			name: "player_performances_team_id_fkey"
		}),
	unique("player_performances_player_id_game_id_key").on(table.playerId, table.gameId),
]);

export const gameDumps = pgTable("game_dumps", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "game_dumps_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	gameId: integer("game_id").notNull(),
	dump: jsonb().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.gameId],
			foreignColumns: [games.id],
			name: "game_dumps_game_id_fkey"
		}),
	unique("game_dumps_game_id_key").on(table.gameId),
]);

export const users = pgTable("users", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "users_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	username: varchar().notNull(),
	ha1: bytea("ha1").notNull(),
});

export const draftLobbies = pgTable("draft_lobbies", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "draft_lobbies_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	shortcode: varchar(),
	blueCode: varchar("blue_code", { length: 50 }).notNull(),
	redCode: varchar("red_code", { length: 50 }).notNull(),
	lobbyCode: varchar("lobby_code", { length: 50 }).notNull(),
	redName: varchar("red_name", { length: 50 }).notNull(),
	blueName: varchar("blue_name", { length: 50 }).notNull(),
	bPick1: varchar("b_pick_1", { length: 25 }),
	bPick2: varchar("b_pick_2", { length: 25 }),
	bPick3: varchar("b_pick_3", { length: 25 }),
	bPick4: varchar("b_pick_4", { length: 25 }),
	bPick5: varchar("b_pick_5", { length: 25 }),
	rPick1: varchar("r_pick_1", { length: 25 }),
	rPick2: varchar("r_pick_2", { length: 25 }),
	rPick3: varchar("r_pick_3", { length: 25 }),
	rPick4: varchar("r_pick_4", { length: 25 }),
	rPick5: varchar("r_pick_5", { length: 25 }),
	bBan1: varchar("b_ban_1", { length: 25 }),
	bBan2: varchar("b_ban_2", { length: 25 }),
	bBan3: varchar("b_ban_3", { length: 25 }),
	bBan4: varchar("b_ban_4", { length: 25 }),
	bBan5: varchar("b_ban_5", { length: 25 }),
	rBan1: varchar("r_ban_1", { length: 25 }),
	rBan2: varchar("r_ban_2", { length: 25 }),
	rBan3: varchar("r_ban_3", { length: 25 }),
	rBan4: varchar("r_ban_4", { length: 25 }),
	rBan5: varchar("r_ban_5", { length: 25 }),
}, (table) => [
	foreignKey({
			columns: [table.shortcode],
			foreignColumns: [games.shortcode],
			name: "draft_lobbies_shortcode_fkey"
		}),
	unique("draft_lobbies_shortcode_key").on(table.shortcode),
]);

export const meta = pgTable("meta", {
	id: integer().primaryKey().notNull(),
	seasonName: varchar("season_name", { length: 20 }).notNull(),
	providerId: integer("provider_id").notNull(),
});

export const divisions = pgTable("divisions", {
	id: serial().primaryKey().notNull(),
	name: varchar({ length: 20 }).notNull(),
	tournamentId: integer("tournament_id").notNull(),
}, (table) => [
	unique("divisions_name_key").on(table.name),
]);
