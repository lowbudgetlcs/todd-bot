import { relations } from "drizzle-orm/relations";
import {
  teams,
  series,
  games,
  results,
  players,
  divisions,
  standings,
  schedules,
  accounts,
} from "./schema";

export const seriesRelations = relations(series, ({ one, many }) => ({
  team_winner_id: one(teams, {
    fields: [series.winner_id],
    references: [teams.id],
    relationName: "series_winner_id_teams_id",
  }),
  team_team1_id: one(teams, {
    fields: [series.team1_id],
    references: [teams.id],
    relationName: "series_team1_id_teams_id",
  }),
  team_team2_id: one(teams, {
    fields: [series.team2_id],
    references: [teams.id],
    relationName: "series_team2_id_teams_id",
  }),
  games: many(games),
  schedules: many(schedules),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  series_winner_id: many(series, {
    relationName: "series_winner_id_teams_id",
  }),
  series_team1_id: many(series, {
    relationName: "series_team1_id_teams_id",
  }),
  series_team2_id: many(series, {
    relationName: "series_team2_id_teams_id",
  }),
  games_loser_id: many(games, {
    relationName: "games_loser_id_teams_id",
  }),
  games_winner_id: many(games, {
    relationName: "games_winner_id_teams_id",
  }),
  player: one(players, {
    fields: [teams.captain_id],
    references: [players.id],
    relationName: "teams_captain_id_players_id",
  }),
  division: one(divisions, {
    fields: [teams.division_id],
    references: [divisions.id],
  }),
  standings: many(standings),
  players: many(players, {
    relationName: "players_team_id_teams_id",
  }),
}));

export const gamesRelations = relations(games, ({ one }) => ({
  team_loser_id: one(teams, {
    fields: [games.loser_id],
    references: [teams.id],
    relationName: "games_loser_id_teams_id",
  }),
  result: one(results, {
    fields: [games.result_id],
    references: [results.id],
  }),
  series: one(series, {
    fields: [games.series_id],
    references: [series.id],
  }),
  team_winner_id: one(teams, {
    fields: [games.winner_id],
    references: [teams.id],
    relationName: "games_winner_id_teams_id",
  }),
}));

export const resultsRelations = relations(results, ({ many }) => ({
  games: many(games),
}));

export const playersRelations = relations(players, ({ one, many }) => ({
  teams: many(teams, {
    relationName: "teams_captain_id_players_id",
  }),
  team: one(teams, {
    fields: [players.team_id],
    references: [teams.id],
    relationName: "players_team_id_teams_id",
  }),
  accounts: many(accounts),
}));

export const divisionsRelations = relations(divisions, ({ many }) => ({
  teams: many(teams),
  schedules: many(schedules),
}));

export const standingsRelations = relations(standings, ({ one }) => ({
  team: one(teams, {
    fields: [standings.team_id],
    references: [teams.id],
  }),
}));

export const schedulesRelations = relations(schedules, ({ one }) => ({
  series: one(series, {
    fields: [schedules.series_id],
    references: [series.id],
  }),
  division: one(divisions, {
    fields: [schedules.division_id],
    references: [divisions.id],
  }),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  player: one(players, {
    fields: [accounts.player_id],
    references: [players.id],
  }),
}));
