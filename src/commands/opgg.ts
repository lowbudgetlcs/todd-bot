import { Interaction, StringSelectMenuBuilder, ActionRowBuilder, StringSelectMenuInteraction, SlashCommandBuilder } from "discord.js";
import { getTeamsByDivision } from "./tournnament"; // Assuming you have this for getting teams
import { db } from "../db/db";
import { players} from "../db/schema";
import { eq } from "drizzle-orm";

module.exports = {
  data: new SlashCommandBuilder()
  .setName("team-opgg")
  .setDescription("Generates Team op.gg link"),
  async execute(interaction) {
    // TODO: fix this 
    let x = 1+1;
  }
}

async function generateOpgg(teamId: number) {

    let data = await db.select().from(players).where((eq(players.teamId, teamId)));

    if (data.length === 0) {
        throw new Error('No players found for this team.');
    }
    let opggUrl = 'https://op.gg/multisearch/na?summoners=';

    // Concatenate each player’s summoner name to the OP.GG URL
    for (const player of data) {
      // Ensure the summoner name is encoded properly
      opggUrl += encodeURIComponent(player.summonerName!) + '%2C';
    }
    opggUrl = opggUrl.slice(0, -3);
    return opggUrl;
}

async function handleOpggCommand(interaction: Interaction, channelId: string, commandToggle: boolean, divisionsMap: Map<any, any>) {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, channelId: interactionChannelId } = interaction;

  // Ensure the command is valid and toggled on
  if (commandName === "team-opgg" && interactionChannelId === channelId && commandToggle) {
    const divisionDropdown = new StringSelectMenuBuilder()
      .setCustomId("division_select_opgg")
      .setPlaceholder("Select a Division")
      .addOptions(
        Array.from(divisionsMap.entries()).map(([key, value]) => ({
          label: value,
          value: key.toString(),
        }))
      );
    const divisionRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(divisionDropdown);

    await interaction.reply({
      content: "Please select a division to get the OP.GG information:",
      components: [divisionRow],
      ephemeral: true,
    });

    return;
  } else if (interactionChannelId !== channelId || !commandToggle) {
    const commandCheck = commandToggle
      ? ": Please do not use this command <3."
      : ": This is Turned Off <3";
    await interaction.reply({
      content: "Beep Boop, Beep Bop" + commandCheck,
      ephemeral: true,
    });
  }
}

async function handleDivisionSelectOpgg(interaction: StringSelectMenuInteraction, divisionsMap: Map<any, any>) {
  const { values, user } = interaction;
  const divisionKey = parseInt(values[0]);
  const divisionName = divisionsMap.get(divisionKey);
  const teams = await getTeamsByDivision(divisionKey) || [];

  if (!(await teams).length) {
    await interaction.update({
      content: "No teams found for the selected division.",
      components: [],
    });
    return;
  }

  const teamDropdown = new StringSelectMenuBuilder()
    .setCustomId("team_select_opgg")
    .setPlaceholder("Select a Team")
    .addOptions(teams.map((team) => ({ label: team.name, value: team.id.toString() })));

  const teamRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(teamDropdown);

  await interaction.update({
    content: `You selected the **${divisionName}** division. Now select your team:`,
    components: [teamRow],
  });
}

async function handleTeamSelectOpgg(interaction: StringSelectMenuInteraction) {
  const { values, user } = interaction;
  const selectedTeamId = values[0];

  // Run the generateOpgg function with the selected team ID
  try {
    const opggLink = await generateOpgg(parseInt(selectedTeamId));

    // Send the OP.GG link as a follow-up
    await interaction.update({
      content: `Here is the OP.GG link for the selected team: ${opggLink}`,
      components: [],
    });
  } catch (error) {
    console.error(error);
    await interaction.update({
      content: "An error occurred while generating the OP.GG link. Please try again later.",
      components: [],
    });
  }
}
