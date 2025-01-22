import {
  CacheType,
  CommandInteraction,
  Interaction,
  ModalBuilder,
  ModalSubmitInteraction,
  SlashCommandBuilder,
  StringSelectMenuInteraction,
} from "discord.js";
import { config } from "../config";
import { RiotAPITypes } from "@fightmegg/riot-api";
import { db } from "../db/db";
import { divisions, games, series, teams, teamToSeries } from "../db/schema";
import { and, or, sql, desc} from "drizzle-orm";
import { eq } from "drizzle-orm";
import {alias } from "drizzle-orm/pg-core"
import divisionMap from "../constants/constants";

export const data = new SlashCommandBuilder()
  .setName("generate-tournament-code")
  .setDescription("Generate Tournament Code");

async function grabTeamInfo(team: String) {
  let data = await db
    .select()
    .from(teams)
    .where(sql`lower(${teams.name}) = lower(${team})`);
  return data[0];
}

export async function getTeamsByDivision(division: number) {
  let data = await db.select().from(teams).where((eq(teams.divisionId, division)));
  return data;
}

async function checkSeries(team1Data: any, team2Data: any) {
  const team1 = alias(teamToSeries, "team1");
  const team2 = alias(teamToSeries, "team2");
  try{
  let response = await db
    .select({ seriesId: series.id }) // Specify the column(s) to retrieve
    .from(series)
    .innerJoin(
      team1 , // First join for team1
      and(eq(team1.seriesId, series.id), (eq(team1.teamId, team1Data.id))) // Match team1
    )
    .innerJoin(
      team2, // Second join for team2 with alias "st2"
      and(eq(team2.seriesId, series.id), (eq(team2.teamId, team2Data.id))) // Match team2 using alias
    )
    .where(eq(team1.seriesId, series.id)) // Ensure both teams are in the same series
    .limit(1); // Optionally limit to one result if needed

  return response[0];
  } catch(e){
    console.log(e);
    return null;
  }
}

export async function execute(team1: String, team2: String, interaction: StringSelectMenuInteraction<CacheType>) {
  let error = "";
  let tournamentCode1 = "";
  let game_number = 1;
  let division = 0;
  let team1Name = "";
  let team2Name = "";

  let team1Data = await grabTeamInfo(team1);
  let team2Data = await grabTeamInfo(team2);

  team1Name = team1.toString();
  team2Name = team2.toString();
  if (!team1Data || !team2Data) {
    error = `Are you sure ${!team1Data ? team1 : team2} is a real team?`;
    return {
      tournamentCode1,
      game_number,
      error,
      division,
      team1Name,
      team2Name,
    };
  }
  if (team1Data.id === team2Data.id) {
    error =
      "This is not One For All. No picking the same champs/teams";
    return {
      tournamentCode1,
      game_number,
      error,
      division,
      team1Name,
      team2Name,
    };
  }

  const seriesCheck = await checkSeries(team1Data, team2Data);
  if (!seriesCheck) {
    error = "There is no series for those two teams.";
    return {
      tournamentCode1,
      game_number,
      error,
      division,
      team1Name,
      team2Name,
    };
  }

  division = team1Data.divisionId;
  const series_id = seriesCheck.seriesId;
  const gameResult = await db
    .select({ gameNum: games.gameNum })
    .from(games)
    .where(eq(games.seriesId, series_id))
    .orderBy(desc(games.gameNum));

  if (gameResult && gameResult[0]) {
    game_number = gameResult[0].gameNum + 1;
  }
  if (game_number > 10) {
    error =
      "We do not allow more than 10 codes for a single series. Please make a ticket if you are having issues with your tournament codes.";
    return {
      tournamentCode1,
      game_number,
      error,
      division,
      team1Name,
      team2Name,
    };
  }

  const response = await db
    .select({
      tournamentId: divisions.tournamentId,
    })
    .from(divisions)
    .where(eq(divisions.id, team1Data.divisionId));

  const tournament_code = response[0]?.tournamentId;
  if (!tournament_code) {
    error = "Tournament code not found for the given division.";
    return {
      tournamentCode1,
      game_number,
      error,
      division,
      team1Name,
      team2Name,
    };
  }

  let riotResponse;
  try {
    let meta = JSON.stringify({ gameNum: game_number, seriesId: series_id });
    riotResponse = await config.rAPI.tournamentV5.createCodes({
      params: {
        count: 1,
        tournamentId: tournament_code,
      },
      body: {
        teamSize: 5,
        pickType: RiotAPITypes.TournamentV5.PICKTYPE.TOURNAMENT_DRAFT,
        mapType: RiotAPITypes.TournamentV5.MAPTYPE.SUMMONERS_RIFT,
        spectatorType: RiotAPITypes.TournamentV5.SPECTATORTYPE.ALL,
        enoughPlayers: false,
        metadata: meta,
      },
    });
    tournamentCode1 = riotResponse[0];
  } catch (e: any) {
    error = "Something went wrong on Riot's end. Please make a ticket.";
    return {
      tournamentCode1,
      game_number,
      error,
      division,
      team1Name,
      team2Name,
    };
  }
  try {
    await db.transaction(async (tx) => {
      await tx.insert(games).values({
        shortcode: tournamentCode1,
        seriesId: series_id,
        gameNum: game_number,
      });
    });
  } catch (e: any) {
    error =
      "Something went wrong with saving the code: " +
      tournamentCode1 +
      " . Please make a ticket.";
    return {
      tournamentCode1,
      game_number,
      error,
      division,
      team1Name,
      team2Name,
    };
  }

  let division_name = divisionMap.get(division);
  let discordResponse =
    "## " +
    division_name +
    "\n" +
    "**__" +
    team1Name +
    "__** vs **__" +
    team2Name +
    "__**\n" +
    "Game " +
    game_number! +
    " Code: `" +
    tournamentCode1 +
    "`";
  if (game_number! > 5)
    discordResponse = discordResponse.concat(
      "\nYou are above the needed codes for your series. If you are experiencing issues, please open an admit ticket. <@247886805821685761>",
    );
  return {
    discordResponse,
    game_number,
    error,
    division,
    team1Name,
    team2Name,
  }
}