import { CommandInteraction, ModalBuilder, SlashCommandBuilder } from "discord.js";
import { config } from "../config";
import { RiotAPITypes } from "@fightmegg/riot-api";
import { checkTeams } from "./supabase";

export const data = new ModalBuilder()
  .setCustomId('codes')
  .setTitle('Tournament Codes');

export async function execute(team1: String, team2: String) {

  await checkTeams(team1, team2);
  return null;

  const provider = await config.rAPI.tournamentStubV5.createProvider({body: {
    region: RiotAPITypes.TournamentV5.REGION.NA,
    url: ""
  }});

  console.log(provider);
  const tournament_id = await config.rAPI.tournamentStubV5.createTournament({body: {
      providerId: provider
  }});
  
  console.log(tournament_id);
  const tournamentCode1 = await config.rAPI.tournamentStubV5.createCodes({params: {
      count: 1,
      tournamentId: tournament_id
  }, body: {
      teamSize: 5,
      pickType: RiotAPITypes.TournamentV5.PICKTYPE.TOURNAMENT_DRAFT,
      mapType: RiotAPITypes.TournamentV5.MAPTYPE.SUMMONERS_RIFT,
      spectatorType: RiotAPITypes.TournamentV5.SPECTATORTYPE.ALL,
      enoughPlayers: false
  }})

  console.log(tournamentCode1);
  return null;
}
