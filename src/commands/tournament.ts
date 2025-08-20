import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ComponentType,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import { getDraftLinksMarkdown } from "../util";
 let divisionsMap = new Map();
      divisionsMap.set(1, "Division 1");
      divisionsMap.set(2, "Division 2");
import {  User } from "../interfaces";
import { createButton, createButtonData } from "../buttons/button";
export const command = {
  data: new SlashCommandBuilder()
    .setName("generate-tournament-code")
    .setDescription("Generate New Tournament Code"),
  execute: async(interaction: { reply: (arg0: { content: string; components: never[] | ActionRowBuilder<StringSelectMenuBuilder>[]; flags: string; withResponse?: boolean; }) => any; user:  User}) => {
    // Move your existing execute logic here
    if (divisionsMap.size == 0) {
      await interaction.reply({
        content: "No divisions found.",
        components: [],
        flags: "Ephemeral",
      });
      return;
    }
    
    const divisionDropdown = new StringSelectMenuBuilder()
      .setCustomId("division_select")
      .setPlaceholder("Select a Division")
      .addOptions(
        Array.from(divisionsMap.entries()).map(([key, value]) => ({
          label: value.toString(),
          value: key.toString(),
        }))
      );
    const divisionRow =
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        divisionDropdown
      );

    const response = await interaction.reply({
      content: "Please select a division:",
      components: [divisionRow],
      flags: "Ephemeral",
      withResponse: true,
    });
    // Since we're not making any NEW messages we'll have to pass this fella around to keep listening to him
    // As we traverse through each menu.
    const message = response.resource!.message;
    const collector =
      response.resource!.message!.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        filter: (i: { user: User; customId: string; }) =>
          i.user === interaction.user && i.customId == "division_select",
        time: 5 * 60 * 1000,
      });

    collector.on("collect", async (interaction: any) => {
      handleDivisionSelect(interaction, message);
    });
    return;


  },
};

async function grabTeamInfo(name: String) {
  // TODO: Call API
  return {"id": 1, "divisionId": 1, "name": "team1"}; // Placeholder for actual team fetching logic
}
//TODO: Remove this, its just testing info
async function grabTeam2Info(name: String) {
  // TODO: Call API
  return {"id": 2, "divisionId": 1, "name": "team2"}; // Placeholder for actual team fetching logic
}
const userState = new Map();

async function getTeamsByDivision(division: number) {
  // TODO: Call API
  return [{"name":"team1"}, {"name":"team2"}]; // Placeholder for actual team fetching logic
}

// TODO: we should NOT use any here if we know what it's going to be.
// i don't know what it is going to be LMFAO
async function handleDivisionSelect(interaction: any, message: any) {
  const { customId, values, user } = interaction;
  const divisionKey = parseInt(values[0]);
  const divisionName = divisionsMap.get(divisionKey);
  const teams = (await getTeamsByDivision(divisionKey)) || [];

  if (!teams.length) {
    await interaction.update({
      content: "No teams found for the selected division.",
      components: [],
    });
    userState.delete(user.id);
    return;
  }

  const team1Dropdown = new StringSelectMenuBuilder()
    .setCustomId("team1_select")
    .setPlaceholder("Select Team 1")
    .addOptions(teams.map((team) => ({ label: team.name, value: team.name })));

  const team2Dropdown = new StringSelectMenuBuilder()
    .setCustomId("team2_select")
    .setPlaceholder("Select Team 2")
    .addOptions(teams.map((team) => ({ label: team.name, value: team.name })));

  const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    team1Dropdown
  );
  const row2 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    team2Dropdown
  );

  userState.set(user.id, { divisionName, teams, team1: null, team2: null });

  const response = await interaction.update({
    content: `You selected the **${divisionName}** division. Now select your teams:`,
    components: [row1, row2],
  });
  setTimeout(
    () => {
      userState.delete(user.id);
      console.log(`User state for ${user.id} cleared due to inactivity.`);
    },
    5 * 60 * 1000
  );
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    filter: (i: { user: User; customId: string; }) =>
      i.user === interaction.user &&
      ["team1_select", "team2_select"].includes(i.customId),
    time: 5 * 60 * 1000,
  });

  collector.on("collect", async (interaction: any) => {
    handleTeamSelect(interaction);
  });
}

export async function handleTeamSelect(interaction: any) {
  const { customId, values, user } = interaction;
  let selectedTeam = "";

  const state = userState.get(user.id);
  console.log(customId);
  if (customId.substring(0,customId.indexOf(':')) === ("cancel"))
  {
    state.team1 = ""
    state.team2 = ""
  } else if (customId.substring(0,customId.indexOf(':')) === ("switch"))
  {
    const temp = state.team1;
    state.team1 = state.team2;
    state.team2 = temp;
  } else {
    selectedTeam = values[0]
  }

  if (!state) {
    await interaction.update({
      content:
        "Error: Unable to retrieve state. Please restart the interaction.",
      components: [],
    });
    return;
  }

  if (customId === "team1_select") {
    state.team1 = selectedTeam;
  } else if (customId === "team2_select"){
    state.team2 = selectedTeam;
  }

  const team1Dropdown = new StringSelectMenuBuilder()
    .setCustomId("team1_select")
    .setPlaceholder("Select Team 1")
    .addOptions(
      state.teams.map((team: { name: string }) => ({
        label: team.name,
        value: team.name,
        default: state.team1 === team.name,
      }))
    );

  const team2Dropdown = new StringSelectMenuBuilder()
    .setCustomId("team2_select")
    .setPlaceholder("Select Team 2")
    .addOptions(
      state.teams.map((team: { name: string }) => ({
        label: team.name,
        value: team.name,
        default: state.team2 === team.name,
      }))
    );

  const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    team1Dropdown
  );
  const row2 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    team2Dropdown
  );

  if (!(state.team1 && state.team2)) {
    const content = `You selected **${state.team1 || "Team 1 not selected"}** for Team 1 and **${state.team2 || "Team 2 not selected"}** for Team 2.`;
    await interaction.update({
      content,
      components: [row1, row2],
    });
    return;
  }

  const confirmButtonData = createButtonData("confirm", user.id, [state.team1, state.team2]);
  const confirm = createButton(confirmButtonData, "Confirm", ButtonStyle.Success, '✅');

  const switchSidesButtonData = createButtonData("switch", user.id, [state.team2, state.team1]);
  const switchSides = createButton(switchSidesButtonData, "Switch Sides", ButtonStyle.Primary, '🔄');
  const cancelButtonData = createButtonData("cancel", user.id, [state.team1, state.team2]);
  const cancel = createButton(cancelButtonData, "Cancel", ButtonStyle.Danger, '❌');  


  const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    confirm,
    switchSides,
    cancel
  );

  const content = `Please confirm all looks right\n` +
  `# Blue Side: ${state.team1}\n` +
  `# Red Side: ${state.team2}`;
  await interaction.update({
    content,
    components: [confirmRow],
  });
}

export async function handleBothTeamSubmission(interaction: ButtonInteraction)
{
  const { user } = interaction;

  const state = userState.get(user.id)
  try {
    const tournamentCode = await getTournamentCode(
      state.team1,
      state.team2,
      interaction
    );
    if (tournamentCode.error != null) {
      // Handle error: Update original interaction
      await interaction.update({
        content: tournamentCode.error,
        components: [],
      });
    } else {
      await interaction.update({
        content: "Your teams have been selected. Generating tournament code...",
        components: [],
      });

      const generateButtonData = createButtonData("generate_another", user.id, [state.team1, state.team2]);
      const generateButton = createButton(generateButtonData, "Generate Next Game", ButtonStyle.Success, '⚔️');

      const buttonRow = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(generateButton);

      await interaction.followUp({
        content: tournamentCode.discordResponse?.toString()!,
        components: [buttonRow],
        ephemeral: false,
      });
    }
  } catch (error) {
    console.error(error);
    await interaction.update({
      content:
        "An error occurred while generating the tournament code. Please try again later.",
      components: [],
    });
  } finally {
    userState.delete(user.id);
  }
}

// TODO: Fix this as to not need to send interaction
export async function getTournamentCode(
  team1: string,
  team2: string,
  interaction: ButtonInteraction
): Promise<{
  discordResponse: string | null;
  shortcode: string | null;
  gameNumber: number;
  error: string | null;
  divisionId: number | null;
  team1: string;
  team2: string;
}> {
  //TODO: Call api with this informatio nand let it handle all this logic
  let gameNumber = 1;
  let team1Data = await grabTeamInfo(team1);
  let team2Data = await grabTeam2Info(team2);

  if (!team1Data || !team2Data) {
    return {
      discordResponse: null,
      shortcode: null,
      gameNumber,
      error: `Are you sure ${!team1Data ? team1 : team2} is a real team?`,
      divisionId: null,
      team1,
      team2,
    };
  }
  if (team1Data.id === team2Data.id) {
    return {
      discordResponse: null,
      shortcode: null,
      gameNumber,
      error: "This is not One For All. No picking the same champs/teams",
      divisionId: team1Data.divisionId,
      team1,
      team2,
    };
  }

  const seriesCheck = {"seriesId": 0}; // Placeholder for actual series check logic
  if (!seriesCheck) {
    return {
      discordResponse: null,
      shortcode: null,
      gameNumber,
      error: "There is no series for those two teams.",
      divisionId: team1Data.divisionId,
      team1,
      team2,
    };
  }

  const seriesId = seriesCheck.seriesId;
  // Going to be removed later
  // const gameResult = await db
  //   .select({ gameNum: games.gameNum })
  //   .from(games)
  //   .where(eq(games.seriesId, seriesId))
  //   .orderBy(desc(games.gameNum));

  // if (gameResult && gameResult[0]) {
  //   gameNumber = gameResult[0].gameNum + 1;
  // }
  if (gameNumber > 10) {
    return {
      discordResponse: null,
      shortcode: null,
      gameNumber,
      error:
        "We do not allow more than 10 codes for a single series. Please open an URGENT admin ticket if you are having issues with your tournament codes.",
      divisionId: team1Data.divisionId,
      team1,
      team2,
    };
  }

  // const response = await db
  //   .select({
  //     tournamentId: divisions.tournamentId,
  //   })
  //   .from(divisions)
  //   .where(eq(divisions.id, team1Data.divisionId ?? 0));

  // const tid = response[0]?.tournamentId;
  // if (!tid) {
  //   return {
  //     discordResponse: null,
  //     shortcode: null,
  //     gameNumber,
  //     error: "Tournament code not found for the given division.",
  //     divisionId: team1Data.divisionId,
  //     team1,
  //     team2,
  //   };
  const tid = 1; // Placeholder for actual tournament ID logic
  let shortcode = "SHORTCODE_PLACEHOLDER"; // Placeholder for actual shortcode generation logic
  try {
    let meta = JSON.stringify({ gameNum: gameNumber, seriesId: seriesId });
    // const riotResponse = await config.rAPI.tournamentV5.createCodes({
    //   params: {
    //     count: 1,
    //     tournamentId: tid,
    //   },
    //   body: {
    //     teamSize: 5,
    //     pickType: RiotAPITypes.TournamentV5.PICKTYPE.TOURNAMENT_DRAFT,
    //     mapType: RiotAPITypes.TournamentV5.MAPTYPE.SUMMONERS_RIFT,
    //     spectatorType: RiotAPITypes.TournamentV5.SPECTATORTYPE.ALL,
    //     enoughPlayers: false,
    //     metadata: meta,
    //   },
    // });
    // shortcode = riotResponse[0];
    
  } catch (e: unknown) {
    return {
      discordResponse: null,
      shortcode: null,
      gameNumber,
      error:
        "Something went wrong on Riot's end. Please make an URGENT admin ticket.",
      divisionId: team1Data.divisionId,
      team1,
      team2,
    };
  }
  // let datetime = new Date();
  // shortcode = "NA005"+datetime.getSeconds();

  // WOW, ITS LIKE THE API WILL DO THIS NOW. CRAZYYYYY
  // try {
  //   const res = await db.transaction(async (tx) => {
  //     return await tx
  //       .insert(games)
  //       .values({
  //         shortcode,
  //         seriesId,
  //         gameNum: gameNumber,
  //       })
  //       .returning({ gameId: games.id });
  //   });
  //   if (res.length === 0) {
  //     console.log(`Game insert failed:\n 
  //         Series ID: '${seriesId}'\n
  //         TCode: '${shortcode}'\n
  //         Game Num: '${gameNumber}'\n`);
  //   } else {
  //     console.log(`Inserted '${res[0].gameId}' for series '${seriesId}'.`);
  //   }
  // } catch (e: any) {
  //   console.log(e);
  //   return {
  //     discordResponse: null,
  //     shortcode,
  //     gameNumber,
  //     error:
  //       "Something went wrong with saving the code: " +
  //       shortcode +
  //       " . Please make an URGENT admin ticket.",
  //     divisionId: team1Data.divisionId,
  //     team1,
  //     team2,
  //   };
  // }

  let division_name = divisionsMap.get(team1Data.divisionId);
  const member = await interaction.guild!.members.fetch(interaction.user.id);
  const draftLinkMarkdown = await getDraftLinksMarkdown(team1, team2, shortcode) + '\n';

  let discordResponse =
    `## ${division_name}\n` +
    `**__*${team1}*__ vs __*${team2}*__**\n` +
    `Game ${gameNumber} Code: \`\`\`${shortcode}\`\`\`\n` +
    draftLinkMarkdown +
    `Generated By: <@${member.id}>`;
  // TODO: reusing series codes in playoffs is making this message a bit obsolete
  // if (gameNumber! > 5)
  //   discordResponse = discordResponse.concat(
  //     "\nYou have generated more codes than required for this series. If you are experiencing issues, please open an URGENT admin ticket. " //<@247886805821685761>",
  //   );
  return {
    discordResponse,
    shortcode,
    gameNumber,
    error: null,
    divisionId: team1Data.divisionId,
    team1,
    team2,
  };
}



