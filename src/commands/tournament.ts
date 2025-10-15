import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ComponentType,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { getDraftLinksMarkdown } from '../util.ts';
import { User } from '../interfaces.ts';
import { createButton, createButtonData, parseButtonData, ButtonData } from '../buttons/button.ts';
import { createGame, getEvent, getEvents, getEventWithTeams, getTeam, Team } from '../dennys.ts';
import log from 'loglevel';
import { SeriesData } from '../types/toddData.ts';

const logger = log.getLogger('tournament');
logger.setLevel('info');
async function grabTeams(divisionId: number): Promise<Team[]> {
  const event = (await getEventWithTeams(divisionId)) || null;
  const teams = event?.teams || [];
  return teams;
}
// TODO: we should NOT use any here if we know what it's going to be.
// i don't know what it is going to be LMFAO
export async function handleDivisionSelect(interaction: any, message: any) {
  logger.info('Handling division select interaction: ' + interaction.customId);
  const data = parseButtonData(interaction.customId);
  const seriesData = data.seriesData;
  const enemyCaptainId = seriesData.enemyCaptainId;
  logger.info('Enemy Captain ID: ' + enemyCaptainId);
  const {values} = interaction;
  const divisionKey = parseInt(values[0]);
  const divisionName = (await getEvent(divisionKey))?.name || 'Unknown Division';
  const teams = await grabTeams(divisionKey);
  if (!teams || teams.length === 0) {
    await interaction.update({
      content: 'No teams found for the selected division.',
      components: [],
    });
    return;
  }
  const seriesDataUpdated: SeriesData = {
    team1Id: "" as unknown as number,
    team2Id: "" as unknown as number,
    divisionId: divisionKey,
    enemyCaptainId: enemyCaptainId,
  };
  const customId1 = createButtonData('team1_select', interaction.user.id, seriesDataUpdated);
  const customId2 = createButtonData('team2_select', interaction.user.id, seriesDataUpdated);

  const team1Dropdown = new StringSelectMenuBuilder()
    .setCustomId(customId1.serialize())
    .setPlaceholder('Select Blue Side')
    .addOptions(teams.map(team => ({ label: team.name, value: String(team.id) })));

  const team2Dropdown = new StringSelectMenuBuilder()
    .setCustomId(customId2.serialize())
    .setPlaceholder('Select Red Side')
    .addOptions(teams.map(team => ({ label: team.name, value: String(team.id) })));

  const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(team1Dropdown);
  const row2 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(team2Dropdown);
  await interaction.update({
    content: `You selected the **${divisionName}** division. Now select your teams:`,
    components: [row1, row2],
  });
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    filter: (i: { user: User; customId: string }) =>
      i.user === interaction.user && ['team1_select', 'team2_select'].includes(parseButtonData(i.customId).tag),
    time: 5 * 60 * 1000,
  });

  collector.on('collect', async (interaction: any) => {
    logger.info('Collecting team select interaction:', interaction.customId);
    handleTeamSelect(interaction);
  });
}

export async function handleTeamSelect(interaction: any) {
  const { customId, lable, values, user } = interaction;
  let selectedTeam = '';
  const data = parseButtonData(interaction.customId);
  const seriesData = data.seriesData;
  let team1 = seriesData.team1Id;
  let team2 = seriesData.team2Id;
  let division = seriesData.divisionId;
  let tag = data.tag; 
  let enemyCaptainId = seriesData.enemyCaptainId;
  logger.info(`Parsed data - tag: ${tag}, team1: ${team1}, team2: ${team2}, division: ${division}, enemyCaptainId: ${enemyCaptainId}`);
  if (tag === 'cancel') {
    logger.info("Removing sides");
    team1 = '' as unknown as number;
    team2 = '' as unknown as number;
  } else if (tag === 'switch') {
    logger.info("Switching sides");
    let temp = team1;
    team1 = team2;
    team2 = temp;
  } else {
    selectedTeam = values[0];
  }


  if (tag === 'team1_select') {
    team1 = Number(selectedTeam);
  } else if (tag === 'team2_select') {
    team2 = Number(selectedTeam);
  }
  
  const teams:Team[] = await grabTeams(Number(division));

  const seriesDataUpdated: SeriesData = {
    team1Id: team1,
    team2Id: team2,
    divisionId: division,
    enemyCaptainId: enemyCaptainId,
  };

  const customId1 = createButtonData('team1_select', interaction.user.id, seriesDataUpdated);
  const customId2 = createButtonData('team2_select', interaction.user.id, seriesDataUpdated);
  const team1Dropdown = new StringSelectMenuBuilder()
    .setCustomId(customId1.serialize())
    .setPlaceholder('Select Blue side')
    .addOptions(
      teams.map(team => ({ label: team.name, value: String(team.id), default: (team.id) === team1 })),);

  const team2Dropdown = new StringSelectMenuBuilder()
    .setCustomId(customId2.serialize())
    .setPlaceholder('Select Red Side')
    .addOptions(
      teams.map(team => ({ label: team.name, value: String(team.id),  default: (team.id) === team2  })),);
  
  const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(team1Dropdown);
  const row2 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(team2Dropdown);
  const team1Name = teams.find(team => team.id === Number(team1))?.name || null;
  const team2Name = teams.find(team => team.id === Number(team2))?.name || null;

  logger.info(`Team 1: ${team1Name} ${team1}, Team 2: ${team2Name} ${team2}`);
  if (!(team1Name && team2Name)) {
    const content = `Blue Team: **${team1Name || 'Not Selected!'}**\nRed Team: **${team2Name || 'Not Selected!'}**`;
    await interaction.update({
      content,
      components: [row1, row2],
    });
    return;
  }

  

  const confirmButtonData = createButtonData('confirm', user.id, seriesDataUpdated);
  const confirm = createButton(confirmButtonData, 'Confirm', ButtonStyle.Success, '✅');

  const switchSidesButtonData = createButtonData('switch', user.id, seriesDataUpdated);
  const switchSides = createButton(
    switchSidesButtonData,
    'Switch Sides',
    ButtonStyle.Primary,
    '🔄',
  );
  const cancelButtonData = createButtonData('cancel', user.id, seriesDataUpdated);
  const cancel = createButton(cancelButtonData, 'Cancel', ButtonStyle.Danger, '❌');

  const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    confirm,
    switchSides,
    cancel,
  );

  const content =
    `Please confirm all looks right\n` +
    `# Blue Side: ${team1Name}\n` +
    `# Red Side: ${team2Name}`;
  await interaction.update({
    content,
    components: [confirmRow],
  });
}

export async function handleBothTeamSubmission(interaction: ButtonInteraction) {
  const { user } = interaction;
  const data = parseButtonData(interaction.customId);
  const seriesData = data.seriesData;
  logger.info(`Handle Both Team Submission - tag: ${data.tag}, team1: ${seriesData.team1Id}, team2: ${seriesData.team2Id}, division: ${seriesData.divisionId}, enemyCaptainId: ${seriesData.enemyCaptainId}`);
  try {
    const tournamentCode = await getTournamentCode(seriesData.team1Id, seriesData.team2Id, seriesData.divisionId, interaction, seriesData.enemyCaptainId);
    if (tournamentCode.error != null) {
      // Handle error: Update original interaction
      await interaction.update({
        content: tournamentCode.error,
        components: [],
      });
    } else {
      await interaction.update({
        content: 'Your teams have been selected. Generating tournament code...',
        components: [],
      });

      await interaction.deleteReply();

      const generateButtonData = createButtonData('generate_another', user.id, seriesData);
      const generateButton = createButton(
        generateButtonData,
        'Generate Next Game',
        ButtonStyle.Success,
        '⚔️',
      );

      // data.metadata[3] = tournamentCode.gameId.toString(); 
      // logger.info(data.metadata);
      // const regenerateButtonData = createButtonData("regenerate_code", data.originalUserId, data.metadata);
      // const regenerateButton = createButton(regenerateButtonData, "Code Not Work?", ButtonStyle.Secondary, '❓');

      const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(generateButton);
      let discordResponse =
          `## ${tournamentCode.divisionName}\n` +
          `**__${tournamentCode.team1Name}__ v.s. __${tournamentCode.team2Name}__**\n\n` +
          `Series Created By: <@${user.id}>`;
      const publicMessage = await interaction.followUp({
        content: discordResponse,
        ephemeral: false,
      });

      if(tournamentCode.gameNumber===1) {
// Create a thread from the public message
        const thread = await publicMessage.startThread({
          name: `${tournamentCode.team1Name} vs ${tournamentCode.team2Name}`,
          autoArchiveDuration: 60, // in minutes
          reason: `Draft links thread for tournament code ${tournamentCode.shortcode}`,
        });

        let links = tournamentCode.draftLinks?.toString().concat("<@"+seriesData.enemyCaptainId+">") || null;
        logger.info(`Draft Links: ${links}`);
        // Post the draft links in the thread
        await thread.send({
          content: links!,
          flags: 1 << 2,
          components: [buttonRow],
        });
        
        await thread.send({
          content: tournamentCode.discordResponse?.toString() || "",
        });
      }
    }
  } catch (error) {
    console.error(error);
    await interaction.update({
      content: 'An error occurred while generating the tournament code. Please try again later.',
      components: [],
    });
  } 
      }

// TODO: Fix this as to not need to send interaction
export async function getTournamentCode(
  team1: number,
  team2: number,
  divisionId: number,
  interaction: ButtonInteraction,
  enemyCaptainId: string
): Promise<{
  discordResponse: string | null;
  draftLinks: string | null;
  shortcode: string | null;
  gameNumber: number;
  error: string | null;
  divisionId: number | null;
  divisionName?: string;
  team1Name: string;
  team2Name: string;
  gameId: number;
}> {
  //TODO: Call api with this informatio nand let it handle all this logic
  const division  = divisionId? Number(divisionId) : null
  logger.info(`Generating tournament code for teams ${team1} and ${team2} in division ${division}`);
  if (team1 === team2) {
    return {
      discordResponse: null,
      draftLinks: null,
      shortcode: null,
      gameNumber: 0,
      error: 'This is not One For All. No picking the same champs/teams',
      divisionId: division,
      team1Name: team1.toString(),
      team2Name: team2.toString(),
      gameId:0
    };
  }
  logger.info(`Fetching teams: ${team1}, ${team2}`);
  const team1Data = await getTeam(Number(team1));
  const team2Data = await getTeam(Number(team2));
  const team1Name = team1Data?.name || 'Unknown Team 1';
  const team2Name = team2Data?.name || 'Unknown Team 2';
  logger.info(`Fetched teams - Team 1: ${team1Data?.id}  ${team1Data?.name}, Team 2: ${team2Data?.id}  ${team2Data?.name}`);
  const game = await createGame(team1Data!, team2Data!);
  const gameNumber = game.number || 1; // Assuming gameNumber is part of the Game object
  let shortcode = game.shortcode;
  if (!game) {
    return {
      discordResponse: null,
      draftLinks: null,
      shortcode: null,
      gameNumber: gameNumber,
      error: 'Failed to create game. Please try again later.',
      divisionId: division,
      team1Name,
      team2Name,
      gameId:0
    };
  }
 
  let division_name = division? (await getEvent(division))?.name || 'Unknown Division': 'Unknown Division';
  const member = await interaction.guild!.members.fetch(interaction.user.id);
  const draftLinkMarkdown = gameNumber===1? (await getDraftLinksMarkdown(team1Data.name, team2Data.name, shortcode)) + '\n': "";
  const gameId = game.id || 0;
  let sideShow = `# Game ${gameNumber} \n 🟦 __**${team1Name}**__ v.s.  __**${team2Name}**__ 🟥\n`;
  let gameCode: string = `\nCode: \`\`\`${shortcode}\`\`\`\n`;
  let generatedBy : string = `Game Generated By: <@${member.id}>\n`;
  let opposingCapt: string = `Enemy Captain: <@${enemyCaptainId}>\n`;
  let discordResponse = sideShow.concat(gameCode).concat(generatedBy).concat(opposingCapt);

  return {
    discordResponse,
    shortcode,
    draftLinks: draftLinkMarkdown,
    gameNumber,
    error: null,
    divisionId: division,
    divisionName: division_name,
    team1Name,
    team2Name,
    gameId
  };
}
module.exports =  {
  data:  new SlashCommandBuilder()
    .setName('start-series')
    .setDescription('Generate New Series')
    .addUserOption(option =>
      option.setName('opposing_captain')
        .setDescription('The Enemy Team Captain')
        .setRequired(true)),
  execute: async (interaction: {
    reply: (arg0: {
      content: string;
      components: never[] | ActionRowBuilder<StringSelectMenuBuilder>[];
      flags: string;
      withResponse?: boolean;
    }) => any;
    user: User;
    options: { getUser: (arg0: string) => User };
  }, currentEventGroupId: number | null
    ) => {
    logger.info('Executing /start-series command');
    console.log("current event id in tournament:", currentEventGroupId);
    if (currentEventGroupId === null) {
      await interaction.reply({
        content: 'Event group ID is not set. Please create a dev ticket.',
        components: [],
        flags: 'Ephemeral',
      });
      return;
    }
    const divisionsMap = await getEvents(currentEventGroupId);
    if (divisionsMap.length === 0) {
      await interaction.reply({
        content: 'No divisions found.',
        components: [],
        flags: 'Ephemeral',
      });
      return;
    }

    const enemyCaptain = interaction.options.getUser('opposing_captain');
    logger.info('Enemy Captain: ' + (enemyCaptain ? enemyCaptain.id : 'None'));
    const seriesData : SeriesData = {
      team1Id: "" as unknown as number,
      team2Id: "" as unknown as number,
      divisionId: 0,
      enemyCaptainId: enemyCaptain.id,
    };
    // Show division select menu
    const customId = createButtonData('division_select', interaction.user.id, seriesData);
    logger.info('Created customId for division select: ' + customId.serialize());
    const divisionDropdown = new StringSelectMenuBuilder()
      .setCustomId(customId.serialize())
      .setPlaceholder('Select a Division')
      .addOptions(
        Array.from(divisionsMap).map(event => ({
          label: event.name,
          value: event.id.toString(),
        })),
      );
    const divisionRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      divisionDropdown,
    );

    const response = await interaction.reply({
      content: 'Please select a division:',
      components: [divisionRow],
      flags: 'Ephemeral',
      withResponse: true,
    });
    const message = response.resource!.message;
    const collector = response.resource!.message!.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      filter: (i: { user: User; customId: string }) =>
        i.user === interaction.user && i.customId.startsWith('division_select'),
      time: 5 * 60 * 1000,
    });

    collector.on('collect', async (interaction: any) => {
      console.log('Collecting division select interaction:', interaction.customId);
      handleDivisionSelect(interaction, message);
    });
    return;
  }
};
 // Exporting the object with all functions and command
