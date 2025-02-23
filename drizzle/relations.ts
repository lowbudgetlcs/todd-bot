import { relations } from "drizzle-orm/relations";
import { teams, games, series, divisions, playerPerformances, players, gameDumps, playerGameData, teamToSeries, teamPerformances, teamGameData, draftLobbies } from "./schema";

export const gamesRelations = relations(games, ({one, many}) => ({
	team_loserId: one(teams, {
		fields: [games.loserId],
		references: [teams.id],
		relationName: "games_loserId_teams_id"
	}),
	series: one(series, {
		fields: [games.seriesId],
		references: [series.id]
	}),
	team_winnerId: one(teams, {
		fields: [games.winnerId],
		references: [teams.id],
		relationName: "games_winnerId_teams_id"
	}),
	playerPerformances: many(playerPerformances),
	gameDumps: many(gameDumps),
	teamPerformances: many(teamPerformances),
	draftLobbies: many(draftLobbies),
}));

export const teamsRelations = relations(teams, ({one, many}) => ({
	games_loserId: many(games, {
		relationName: "games_loserId_teams_id"
	}),
	games_winnerId: many(games, {
		relationName: "games_winnerId_teams_id"
	}),
	playerPerformances: many(playerPerformances),
	series_loserId: many(series, {
		relationName: "series_loserId_teams_id"
	}),
	series_winnerId: many(series, {
		relationName: "series_winnerId_teams_id"
	}),
	teamToSeries: many(teamToSeries),
	teamPerformances: many(teamPerformances),
	players: many(players, {
		relationName: "players_teamId_teams_id"
	}),
	player: one(players, {
		fields: [teams.captainId],
		references: [players.id],
		relationName: "teams_captainId_players_id"
	}),
	division: one(divisions, {
		fields: [teams.divisionId],
		references: [divisions.id]
	}),
}));

export const seriesRelations = relations(series, ({one, many}) => ({
	games: many(games),
	division: one(divisions, {
		fields: [series.divisionId],
		references: [divisions.id]
	}),
	team_loserId: one(teams, {
		fields: [series.loserId],
		references: [teams.id],
		relationName: "series_loserId_teams_id"
	}),
	team_winnerId: one(teams, {
		fields: [series.winnerId],
		references: [teams.id],
		relationName: "series_winnerId_teams_id"
	}),
	teamToSeries: many(teamToSeries),
}));

export const playerPerformancesRelations = relations(playerPerformances, ({one, many}) => ({
	division: one(divisions, {
		fields: [playerPerformances.divisionId],
		references: [divisions.id]
	}),
	game: one(games, {
		fields: [playerPerformances.gameId],
		references: [games.id]
	}),
	player: one(players, {
		fields: [playerPerformances.playerId],
		references: [players.id]
	}),
	team: one(teams, {
		fields: [playerPerformances.teamId],
		references: [teams.id]
	}),
	playerGameData: many(playerGameData),
}));

export const divisionsRelations = relations(divisions, ({many}) => ({
	playerPerformances: many(playerPerformances),
	series: many(series),
	teamPerformances: many(teamPerformances),
	teams: many(teams),
}));

export const playersRelations = relations(players, ({one, many}) => ({
	playerPerformances: many(playerPerformances),
	team: one(teams, {
		fields: [players.teamId],
		references: [teams.id],
		relationName: "players_teamId_teams_id"
	}),
	teams: many(teams, {
		relationName: "teams_captainId_players_id"
	}),
}));

export const gameDumpsRelations = relations(gameDumps, ({one}) => ({
	game: one(games, {
		fields: [gameDumps.gameId],
		references: [games.id]
	}),
}));

export const playerGameDataRelations = relations(playerGameData, ({one}) => ({
	playerPerformance: one(playerPerformances, {
		fields: [playerGameData.playerPerformanceId],
		references: [playerPerformances.id]
	}),
}));

export const teamToSeriesRelations = relations(teamToSeries, ({one}) => ({
	series: one(series, {
		fields: [teamToSeries.seriesId],
		references: [series.id]
	}),
	team: one(teams, {
		fields: [teamToSeries.teamId],
		references: [teams.id]
	}),
}));

export const teamPerformancesRelations = relations(teamPerformances, ({one, many}) => ({
	division: one(divisions, {
		fields: [teamPerformances.divisionId],
		references: [divisions.id]
	}),
	game: one(games, {
		fields: [teamPerformances.gameId],
		references: [games.id]
	}),
	team: one(teams, {
		fields: [teamPerformances.teamId],
		references: [teams.id]
	}),
	teamGameData: many(teamGameData),
}));

export const teamGameDataRelations = relations(teamGameData, ({one}) => ({
	teamPerformance: one(teamPerformances, {
		fields: [teamGameData.teamPerformanceId],
		references: [teamPerformances.id]
	}),
}));

export const draftLobbiesRelations = relations(draftLobbies, ({one}) => ({
	game: one(games, {
		fields: [draftLobbies.shortcode],
		references: [games.shortcode]
	}),
}));