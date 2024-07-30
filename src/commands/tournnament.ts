import { CommandInteraction, SlashCommandBuilder } from "discord.js";
import { config } from "../config";
import { RiotAPITypes } from "@fightmegg/riot-api";

export const data = new SlashCommandBuilder()
  .setName("tournament")
  .setDescription("Replies with tournamentid!");

export async function execute(interaction: CommandInteraction) {

  const provider = await config.rAPI.tournamentStubV5.createProvider({body: {
    region: RiotAPITypes.TournamentV5.REGION.NA,
    url: ""
  }});

  const tournament_id = await config.rAPI.tournamentStubV5.createTournament({body: {
      providerId: provider
  }});
  
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
  return interaction.reply(String(tournamentCode1.pop));
}