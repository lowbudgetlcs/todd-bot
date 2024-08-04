import { CommandInteraction, ModalBuilder, SlashCommandBuilder } from "discord.js";
import { config } from "../config";
import { RiotAPITypes } from "@fightmegg/riot-api";
import { db } from "../db/db";
import { divisions, games, series, teams } from "../db/schema";
import { and, or, sql, desc } from "drizzle-orm";
import {eq} from 'drizzle-orm';


export const data = new ModalBuilder()
  .setCustomId('genertate-tournament-code')
  .setTitle('Tournament Codes');


async function grabTeamInfo(team: String) {
    let data = await db.select().from(teams).where(sql`lower(${teams.name}) = lower(${team})`);
    return data[0];
}
  
async function checkTeams(team1: String, team2: String){

    let team1Data = await grabTeamInfo(team1);
    let team2Data = await grabTeamInfo(team2);

    if(team1Data == undefined || team2Data ==undefined) {
      return null;
    }
    if(team1Data.division_id == team2Data.division_id && team1Data.group_id == team2Data.group_id)
    {
      return {data: {team1Data, team2Data}};
    }

    return null;
}

async function checkSeries(team1: any, team2: any){

  const {first, second} = team1.id > team2.id? {first: team1.id, second: team2.id}: {first: team2.id, second: team1.id};

  let response = await db.select({seriesId: series.id }).from(series).where(and(eq(series.team1_id, first),eq(series.team2_id, second)));


  return response[0];
}


export async function execute(team1: String, team2: String) {

  let teamInfo = await checkTeams(team1, team2);
  if(teamInfo?.data.team1Data == null) {
    //error handle later
    return null;
  }

  let response = await db.select({providerId: divisions.provider_id, tournamentId: divisions.tournament_id}).from(divisions).where(eq(divisions.id, teamInfo.data.team1Data.division_id));
  let provider = response[0].providerId;
  let tournament_code = response[0].tournamentId;


  let series_id = (await checkSeries(teamInfo.data.team1Data, teamInfo.data.team2Data)).seriesId;
  let game_result = await db.select({gameNum: games.game_num}).from(games).where(eq(games.series_id, series_id)).orderBy(desc(games.game_num));
  let game_number = 0;

  console.log(game_result);

  if(game_result!=undefined && game_result[0]!=undefined)
    game_number = game_result[0].gameNum!+1;

  const tournamentCode1 = await config.rAPI.tournamentStubV5.createCodes({params: {
      count: 1,
      tournamentId: tournament_code
  }, body: {
      teamSize: 5,
      pickType: RiotAPITypes.TournamentV5.PICKTYPE.TOURNAMENT_DRAFT,
      mapType: RiotAPITypes.TournamentV5.MAPTYPE.SUMMONERS_RIFT,
      spectatorType: RiotAPITypes.TournamentV5.SPECTATORTYPE.ALL,
      enoughPlayers: false,
      metadata: "game_num: "+game_number+", series_id:"+series_id
  }})
  console.log(tournamentCode1[0]);

  await db.insert(games).values({short_code: tournamentCode1[0], series_id: series_id, game_num: game_number});

  return {tournamentCode1, game_number};
}
