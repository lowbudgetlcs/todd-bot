import { CommandInteraction, ModalBuilder, SlashCommandBuilder } from "discord.js";
import { config } from "../config";
import { RiotAPITypes } from "@fightmegg/riot-api";
import { db } from "../db/db";
import { divisions, games, series, teams } from "../db/schema";
import { and, or, sql, desc } from "drizzle-orm";
import {eq} from 'drizzle-orm';

export const data = new SlashCommandBuilder().setName('generate-tournament-code').setDescription('Generate Tournament Code');


async function grabTeamInfo(team: String) {
    let data = await db.select().from(teams).where(sql`lower(${teams.name}) = lower(${team})`);
    return data[0];
}
  
async function checkTeams(team1: String, team2: String){
  let error = "";

    let team1Data = await grabTeamInfo(team1);
    let team2Data = await grabTeamInfo(team2);

    if(team1Data == null) {
      error="Are you sure "+team1+" is a real team?";
      return {data: {team1: null, team2: null, error: error}};
    }
    if(team2Data == null) {
      error="Are you sure "+team2+" is a real team?";
      return {data: {team1: null, team2: null, error: error}};
    }

    if(team1Data.id == team2Data.id) {
      error="Yeah I'm not really sure what to tell you chief. You're not better than yourself";
      return {data: {team1: null, team2: null, error: error}};
    }


    if(team1Data.division_id == team2Data.division_id && team1Data.group_id == team2Data.group_id)
    {
      return {data: {team1: team1Data, team2: team2Data, error}};
    }

    else{
      error="Silly Goose, these teams can't play against each other!";
      return {data: {team1: null, team2: null, error: error}};
    }

}

async function checkSeries(team1: any, team2: any){

  const {first, second} = team1.id > team2.id? {first: team1.id, second: team2.id}: {first: team2.id, second: team1.id};

  let response = await db.select({seriesId: series.id }).from(series).where(and(eq(series.team1_id, first),eq(series.team2_id, second)));


  return response;
}


export async function execute(team1: String, team2: String) {

  let error = "";
  let tournamentCode1="";
  let game_number = 1;


  let teamInfo = await checkTeams(team1, team2);

  
  if(teamInfo?.data.error!=""){
    error = teamInfo?.data.error!;
    return {tournamentCode1, game_number, error};
  }
  let response = await db.select({providerId: divisions.provider_id, tournamentId: divisions.tournament_id}).from(divisions).where(eq(divisions.id, teamInfo.data.team1!.division_id));

  let tournament_code = response[0].tournamentId;


  let series_check = (await checkSeries(teamInfo.data.team1, teamInfo.data.team2));
  
  if(series_check[0]==undefined){
    error = "There is no series for those two teams.";
    return {tournamentCode1, game_number, error};
  }

  let series_id = series_check[0].seriesId;
  let game_result = await db.select({gameNum: games.game_num}).from(games).where(eq(games.series_id, series_id)).orderBy(desc(games.game_num));


  if(game_result!=undefined && game_result[0]!=undefined)
    game_number = game_result[0].gameNum!+1;

  if(game_number>10){
    error = "We do not allow more than 10 codes for a single series. Please make a ticket if you are having issues with your tournament codes.";
    return {tournamentCode1, game_number, error};
  }
  
  let meta = JSON.stringify({game_num: game_number, series_id: series_id});
  let riotResponse = await config.rAPI.tournamentV5.createCodes({params: {
      count: 1,
      tournamentId: tournament_code
  }, body: {
      teamSize: 5,
      pickType: RiotAPITypes.TournamentV5.PICKTYPE.TOURNAMENT_DRAFT,
      mapType: RiotAPITypes.TournamentV5.MAPTYPE.SUMMONERS_RIFT,
      spectatorType: RiotAPITypes.TournamentV5.SPECTATORTYPE.ALL,
      enoughPlayers: false,
      metadata: meta
  }})
  tournamentCode1 = riotResponse[0];
  await db.insert(games).values({short_code: tournamentCode1[0], series_id: series_id, game_num: game_number});

  return {tournamentCode1, game_number, error};
}
