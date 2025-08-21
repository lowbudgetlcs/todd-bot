import { Interaction, StringSelectMenuBuilder, ActionRowBuilder, StringSelectMenuInteraction, SlashCommandBuilder, InteractionReplyOptions, MessagePayload, ComponentType } from "discord.js";

module.exports = {
  data: new SlashCommandBuilder()
  .setName("team-opgg")
  .setDescription("Generates Team op.gg link"),
  async execute(interaction : Interaction) {
    throw "Not Implemented";
  }
}
    // if (!interaction.isChatInputCommand()) return;

//     let divisionsMap = DatabaseUtil.Instance.divisionsMap;
//     // console.log(divisionsMap)
//     if(divisionsMap.size==0) {
//       await interaction.reply({
//         content: "No divisions found.",
//         components: [],
//         flags: "Ephemeral",
//       });
//       return;
//     }
//     const divisionDropdown = new StringSelectMenuBuilder()
//       .setCustomId("division_select_opgg")
//       .setPlaceholder("Select a Division")
//       .addOptions(
//         Array.from(divisionsMap.entries()).map(([key, value]) => ({
//           label: value,
//           value: key.toString(),
//         }))
//       );
//     const divisionRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(divisionDropdown);
//     const response = await interaction.reply(
//       {
//       content: "Please select a division to get the OP.GG information:",
//       components: [divisionRow],
//       flags: "Ephemeral",
//       withResponse: true
//     });
//     // https://discordjs.guide/popular-topics/collectors.html#basic-reaction-collector
//     // https://www.youtube.com/watch?v=MDdt35tXYEA
//     // Note: that withResponse we can collect the callback message by using resource
//     // console.log("hello i am testing this feature", divisionMessage.resource?.message == null)
//     const collector = response.resource!.message!.createMessageComponentCollector(
//       {
//         componentType: ComponentType.StringSelect,
//         filter: (i) => i.user === interaction.user && i.customId == "division_select_opgg",
//         time: 60_000,
//       }
//     );

//     collector.on('collect', async (interaction) =>{
//       handleDivisionSelectOpgg(interaction, Number(interaction.values.at(0)!) );
//     } );
//     return;  
//   }
// }

// async function generateOpgg(teamId: number) {

//     let data = await db.select().from(players).where((eq(players.teamId, teamId)));

//     if (data.length === 0) {
//         throw new Error('No players found for this team.');
//     }
//     let opggUrl = 'https://op.gg/multisearch/na?summoners=';

//     // Concatenate each player’s summoner name to the OP.GG URL
//     for (const player of data) {
//       // Ensure the summoner name is encoded properly
//       opggUrl += encodeURIComponent(player.summonerName!) + '%2C';
//     }
//     opggUrl = opggUrl.slice(0, -3);
//     return opggUrl;
// }

// async function handleOpggCommand(interaction: Interaction, channelId: string, commandToggle: boolean, divisionsMap: Map<any, any>) {
// }

// async function handleDivisionSelectOpgg(interaction: StringSelectMenuInteraction, division: number) {
//   let divisionsMap = DatabaseUtil.Instance.divisionsMap;
//   const divisionName = divisionsMap.get(division);
//   const teams = await getTeamsByDivision(division) || [];

//   if (!(await teams).length) {
//     await interaction.update({
//       content: "No teams found for the selected division.",
//       components: [],
//     });
//     return;
//   }

//   const teamDropdown = new StringSelectMenuBuilder()
//     .setCustomId("team_select_opgg")
//     .setPlaceholder("Select a Team")
//     .addOptions(teams.map((team) => ({ label: team.name, value: team.id.toString() })));

//   const teamRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(teamDropdown);

//   const response = await interaction.update({
//     content: `You selected the **${divisionName}** division. Now select your team:`,
//     components: [teamRow],
//     withResponse: true
//   });

//   const collector = response.resource!.message!.createMessageComponentCollector(
//     {
//       componentType: ComponentType.StringSelect,
//       filter: (i) => i.user === interaction.user && i.customId === "team_select_opgg",
//       time: 60_000,
//     }
//   );

//   collector.on('collect', async (interaction) =>{
//     handleTeamSelectOpgg(interaction, interaction.values.at(0)!);
//   } );
// }

// async function handleTeamSelectOpgg(interaction: StringSelectMenuInteraction, selectedTeamId : string) {
//   // Run the generateOpgg function with the selected team ID
//   try {
//     const opggLink = await generateOpgg(parseInt(selectedTeamId));

//     // Send the OP.GG link as a follow-up
//     await interaction.update({
//       content: `Here is the OP.GG link for the selected team: ${opggLink}`,
//       components: [],
//     });
//   } catch (error) {
//     console.error(error);
//     await interaction.update({
//       content: "An error occurred while generating the OP.GG link. Please try again later.",
//       components: [],
//     });
//   }
// }

// TODO: Denny's no longer has summoner names, will need to query Dennys for PUID and then hit riot API to get summoner name