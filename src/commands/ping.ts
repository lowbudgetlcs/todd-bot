import { CommandInteraction, InteractionResponse, SlashCommandBuilder } from "discord.js";
import { config } from "../config";
import { RiotAPITypes } from "@fightmegg/riot-api";
export const data = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Replies with Pong!");

export async function execute(interaction: CommandInteraction) : Promise<InteractionResponse<boolean>>{
  console.log("here");
  const provider = await config.rAPI.tournamentStubV5.createProvider({body: {
    region: RiotAPITypes.TournamentV5.REGION.NA,
    url: ""
  }});
  
  console.log(provider);
  const tournament_id = await config.rAPI.tournamentStubV5.createTournament({body: {
      providerId: provider
  }});
  console.log(String(tournament_id));
  const tournamentCode1 = await config.rAPI.tournamentStubV5.createCodes({params: {
      count: 1,
      tournamentId: tournament_id
  }, body: {
      teamSize: 5,
      pickType: RiotAPITypes.TournamentV5.PICKTYPE.TOURNAMENT_DRAFT,
      mapType: RiotAPITypes.TournamentV5.MAPTYPE.SUMMONERS_RIFT,
      spectatorType: RiotAPITypes.TournamentV5.SPECTATORTYPE.ALL,
      enoughPlayers: true
  }})
  console.log(tournamentCode1);
  return interaction.reply(String(tournamentCode1.pop()));
}