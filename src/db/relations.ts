import { relations } from "drizzle-orm/relations";
import { players, accounts, series, games, teams, results, performances, divisions, schedules, standings } from "./schema";

export const accountsRelations = relations(accounts, ({one}) => ({
	player: one(players, {
		fields: [accounts.player_id],
		references: [players.id]
	}),
}));

export const playersRelations = relations(players, ({one, many}) => ({
	accounts: many(accounts),
	performances: many(performances),
	team: one(teams, {
		fields: [players.team_id],
		references: [teams.id],
		relationName: "players_team_id_teams_id"
	}),
	teams: many(teams, {
		relationName: "teams_captain_id_players_id"
	}),
}));

export const gamesRelations = relations(games, ({one, many}) => ({
	series: one(series, {
		fields: [games.series_id],
		references: [series.id]
	}),
	team_loser_id: one(teams, {
		fields: [games.loser_id],
		references: [teams.id],
		relationName: "games_loser_id_teams_id"
	}),
	result: one(results, {
		fields: [games.result_id],
		references: [results.id]
	}),
	team_winner_id: one(teams, {
		fields: [games.winner_id],
		references: [teams.id],
		relationName: "games_winner_id_teams_id"
	}),
	performances: many(performances),
}));

export const seriesRelations = relations(series, ({one, many}) => ({
	games: many(games),
	schedules: many(schedules),
	team_team1_id: one(teams, {
		fields: [series.team1_id],
		references: [teams.id],
		relationName: "series_team1_id_teams_id"
	}),
	team_team2_id: one(teams, {
		fields: [series.team2_id],
		references: [teams.id],
		relationName: "series_team2_id_teams_id"
	}),
}));

export const teamsRelations = relations(teams, ({one, many}) => ({
	games_loser_id: many(games, {
		relationName: "games_loser_id_teams_id"
	}),
	games_winner_id: many(games, {
		relationName: "games_winner_id_teams_id"
	}),
	performances: many(performances),
	players: many(players, {
		relationName: "players_team_id_teams_id"
	}),
	series_team1_id: many(series, {
		relationName: "series_team1_id_teams_id"
	}),
	series_team2_id: many(series, {
		relationName: "series_team2_id_teams_id"
	}),
	standings: many(standings),
	division: one(divisions, {
		fields: [teams.division_id],
		references: [divisions.id]
	}),
	player: one(players, {
		fields: [teams.captain_id],
		references: [players.id],
		relationName: "teams_captain_id_players_id"
	}),
}));

export const resultsRelations = relations(results, ({many}) => ({
	games: many(games),
}));

export const performancesRelations = relations(performances, ({one}) => ({
	team: one(teams, {
		fields: [performances.team_id],
		references: [teams.id]
	}),
	player: one(players, {
		fields: [performances.player_id],
		references: [players.id]
	}),
	game: one(games, {
		fields: [performances.game_id],
		references: [games.id]
	}),
}));

export const schedulesRelations = relations(schedules, ({one}) => ({
	division: one(divisions, {
		fields: [schedules.division_id],
		references: [divisions.id]
	}),
	series: one(series, {
		fields: [schedules.series_id],
		references: [series.id]
	}),
}));

export const divisionsRelations = relations(divisions, ({many}) => ({
	schedules: many(schedules),
	teams: many(teams),
}));

export const standingsRelations = relations(standings, ({one}) => ({
	team: one(teams, {
		fields: [standings.team_id],
		references: [teams.id]
	}),
}));