import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ComponentType,
  Message,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from 'discord.js';
import { buildThreadName, getDraftLinksMarkdown } from '../util.ts';
import { runGuarded, safeDefer, safeInteractionError } from '../interactionSafety.ts';
import { User } from '../interfaces.ts';
import { createButton, createButtonData, parseButtonData, seriesDataFits } from '../buttons/button.ts';
import { getEvent, getEvents, getEventWithTeams, getSeries, getSeriesId, getTeam, issueTournamentCode, nextGameNumber, Team } from '../dennys.ts';
import log from 'loglevel';
import { SeriesData } from '../types/toddData.ts';

const logger = log.getLogger('tournament');
logger.setLevel('info');
async function grabTeams(divisionId: number): Promise<Team[]> {
  const event = (await getEventWithTeams(divisionId)) || null;
  const teams = event?.teams || [];
  return teams;
}
/**
 * `message` is what `editReply` handed back when the division dropdown was
 * posted - we only keep it to hang the next collector off, and it is the same
 * message the team/stage dropdowns replace.
 */
export async function handleDivisionSelect(
  interaction: StringSelectMenuInteraction,
  message: Message,
) {
  logger.info('Handling division select interaction: ' + interaction.customId);
  const data = parseButtonData(interaction.customId);
  const seriesData = data.seriesData;
  const enemyCaptainId = seriesData.enemyCaptainId;
  logger.info('Enemy Captain ID: ' + enemyCaptainId);
  const {values} = interaction;
  const divisionKey = parseInt(values[0]);
  // Ack before hitting dennys, otherwise a slow response expires the token.
  if (!(await safeDefer(interaction, { update: true }))) return;
  const divisionEvent = await getEvent(divisionKey);
  const divisionName = divisionEvent?.name || 'Unknown Division';
  const stages = divisionEvent?.eventStages || [];
  if (stages.length === 0) {
    await interaction.editReply({
      content: 'No stages found for the selected division.',
      components: [],
    });
    return;
  }
  const teams = await grabTeams(divisionKey);
  if (!teams || teams.length === 0) {
    await interaction.editReply({
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
    stage: ""
  };
  const customId1 = createButtonData('team1_select', interaction.user.id, seriesDataUpdated);
  const customId2 = createButtonData('team2_select', interaction.user.id, seriesDataUpdated);
  const customId3 = createButtonData('stage_select', interaction.user.id, seriesDataUpdated);

  const team1Dropdown = new StringSelectMenuBuilder()
    .setCustomId(customId1.serialize())
    .setPlaceholder('Select Blue Side')
    .addOptions(teams.map(team => ({ label: team.name, value: String(team.id) })));

  const team2Dropdown = new StringSelectMenuBuilder()
    .setCustomId(customId2.serialize())
    .setPlaceholder('Select Red Side')
    .addOptions(teams.map(team => ({ label: team.name, value: String(team.id) })));

  const stageDropdown = new StringSelectMenuBuilder()
    .setCustomId(customId3.serialize())
    .setPlaceholder('Select Stage')
    .addOptions(stages.map(stage => ({ label: stage, value: stage })));

  const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(team1Dropdown);
  const row2 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(team2Dropdown);
  const row3 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(stageDropdown);
  await interaction.editReply({
    content: `You selected the **${divisionName}** division. Now select Blue Side, Red Side, and Stage:`,
    components: [row1, row2, row3],
  });
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    filter: (i: { user: User; customId: string }) =>
      i.user.id === interaction.user.id && ['team1_select', 'team2_select', 'stage_select'].includes(parseButtonData(i.customId).tag),
    time: 5 * 60 * 1000,
  });

  collector.on('collect', async (interaction: StringSelectMenuInteraction) => {
    logger.info('Collecting team select interaction:', interaction.customId);
    // Must be awaited inside a guard - an un-awaited reject here took the bot down.
    await runGuarded(interaction, 'team_select', () => handleTeamSelect(interaction));
  });
}

/**
 * Re-renders the selection step. Reached two ways: from the three dropdowns,
 * and from the Switch Sides / Cancel buttons that `getButtonHandler` routes
 * here - which is why the parameter is a union. Only the dropdown path carries
 * `values`; the buttons act purely on the tag.
 */
export async function handleTeamSelect(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
) {
  const { user } = interaction;
  const values = interaction.isStringSelectMenu() ? interaction.values : [];
  const data = parseButtonData(interaction.customId);
  const seriesData = data.seriesData;
  let team1 = seriesData.team1Id;
  let team2 = seriesData.team2Id;
  let stage = seriesData.stage;
  const division = seriesData.divisionId;
  const tag = data.tag; 
  const enemyCaptainId = seriesData.enemyCaptainId;
  logger.info(`Parsed data - tag: ${tag}, team1: ${team1}, team2: ${team2}, division: ${division}, stage: ${stage}, enemyCaptainId: ${enemyCaptainId}`);
  if (tag === 'cancel') {
    logger.info("Removing sides");
    team1 = '' as unknown as number;
    team2 = '' as unknown as number;
    stage = "";
  } else if (tag === 'switch') {
    logger.info("Switching sides");
    const temp = team1;
    team1 = team2;
    team2 = temp;
  }


  if (tag === 'team1_select') {
    team1 = Number(values[0]);
  } else if (tag === 'team2_select') {
    team2 = Number(values[0]);
  } else if (tag === 'stage_select') {
    stage = values[0] || "";
  }

  // Ack before hitting dennys, otherwise a slow response expires the token.
  if (!(await safeDefer(interaction, { update: true }))) return;

  const teams:Team[] = await grabTeams(Number(division));
  const divisionEvent = await getEvent(Number(division));
  const stages = divisionEvent?.eventStages || [];
  if (stages.length === 0) {
    await interaction.editReply({
      content: 'No stages found for the selected division.',
      components: [],
    });
    return;
  }

  const seriesDataUpdated: SeriesData = {
    team1Id: team1,
    team2Id: team2,
    divisionId: division,
    enemyCaptainId: enemyCaptainId,
    stage
  };

  // Every button later in this flow carries this same series context, so this
  // is the last point where refusing costs nothing. Past it, the failure would
  // land on the Confirm button built after the game already exists in dennys.
  if (!seriesDataFits(interaction.user.id, seriesDataUpdated)) {
    logger.error(
      `Series context too long for a custom_id - division ${division}, teams ${team1}/${team2}, stage "${stage}"`,
    );
    await interaction.editReply({
      content:
        `The stage **${stage}** has too long a name for Todd to track this series. ` +
        `Please create a dev ticket.`,
      components: [],
    });
    return;
  }

  const customId1 = createButtonData('team1_select', interaction.user.id, seriesDataUpdated);
  const customId2 = createButtonData('team2_select', interaction.user.id, seriesDataUpdated);
  const customId3 = createButtonData('stage_select', interaction.user.id, seriesDataUpdated);
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

  const stageDropdown = new StringSelectMenuBuilder()
    .setCustomId(customId3.serialize())
    .setPlaceholder('Select Stage')
    .addOptions(
      stages.map((eventStage) => ({ label: eventStage, value: eventStage, default: eventStage === stage })),
    );
  
  const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(team1Dropdown);
  const row2 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(team2Dropdown);
  const row3 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(stageDropdown);
  const team1Name = teams.find(team => team.id === Number(team1))?.name || null;
  const team2Name = teams.find(team => team.id === Number(team2))?.name || null;

  logger.info(`Team 1: ${team1Name} ${team1}, Team 2: ${team2Name} ${team2}, Stage: ${stage}`);
  if (!(team1Name && team2Name && stage)) {
    const content =
      `Blue Team: **${team1Name || 'Not Selected!'}**\n` +
      `Red Team: **${team2Name || 'Not Selected!'}**\n` +
      `Stage: **${stage || 'Not Selected!'}**`;
    await interaction.editReply({
      content,
      components: [row1, row2, row3],
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
    `# Red Side: ${team2Name}\n` +
    `# Stage: ${stage}`;
  await interaction.editReply({
    content,
    components: [confirmRow],
  });
}

export async function handleBothTeamSubmission(interaction: ButtonInteraction) {
  const { user } = interaction;
  const data = parseButtonData(interaction.customId);
  const seriesData = data.seriesData;
  logger.info(`Handle Both Team Submission - tag: ${data.tag}, team1: ${seriesData.team1Id}, team2: ${seriesData.team2Id}, division: ${seriesData.divisionId}, stage: ${seriesData.stage}, enemyCaptainId: ${seriesData.enemyCaptainId}`);

  // This path makes several sequential dennys calls and is by far the most
  // likely to exceed Discord's 3 second ack deadline. Defer up front.
  if (!(await safeDefer(interaction, { update: true }))) return;

  // Re-checked here because this button may have been minted before the check
  // above existed. Creating the game first and only then discovering the
  // "Generate Next Game" button won't serialize leaves a series stranded.
  if (!seriesDataFits(user.id, seriesData)) {
    logger.error(
      `Series context too long for a custom_id - refusing before the code is issued. Stage "${seriesData.stage}"`,
    );
    await interaction.editReply({
      content:
        `The stage **${seriesData.stage}** has too long a name for Todd to track this series. ` +
        `Please create a dev ticket.`,
      components: [],
    });
    return;
  }

  try {
    const tournamentCode = await getTournamentCode(seriesData.team1Id, seriesData.team2Id, seriesData.divisionId, seriesData.stage, interaction, seriesData.enemyCaptainId, true);
    if (tournamentCode.error != null) {
      // Handle error: Update original interaction
      await interaction.editReply({
        content: tournamentCode.error,
        components: [],
      });
    } else {
      await interaction.editReply({
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

      // data.metadata[3] = tournamentCode.tournamentCodeId.toString();
      // logger.info(data.metadata);
      // const regenerateButtonData = createButtonData("regenerate_code", data.originalUserId, data.metadata);
      // const regenerateButton = createButton(regenerateButtonData, "Code Not Work?", ButtonStyle.Secondary, '❓');

      const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(generateButton);
      const discordResponse =
          `## ${tournamentCode.divisionName} - ${tournamentCode.stageName || 'UNKNOWN_STAGE'}\n` +
          `**__${tournamentCode.team1Name}__ v.s. __${tournamentCode.team2Name}__**\n\n` +
          `Series Created By: <@${user.id}>`;
      const publicMessage = await interaction.followUp({
        content: discordResponse,
        ephemeral: false,
      });

      // Create a thread from the public message
      const now = new Date();
      const dateString = now.toISOString().split('T')[0];
      // buildThreadName keeps us under Discord's 100 char cap; team names with
      // special characters are already repaired upstream in dennys.ts.
      const threadName = buildThreadName(
        tournamentCode.team1Name,
        tournamentCode.team2Name,
        dateString,
      );
      logger.info(`Creating thread: ${threadName}`);
      const thread = await publicMessage.startThread({
        name: threadName,
        autoArchiveDuration: 60, // in minutes
        reason: `Draft links thread for tournament code ${tournamentCode.shortcode}`,
      });

      const links = tournamentCode.draftLinks?.toString().concat("<@"+seriesData.enemyCaptainId+">") || null;
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
  } catch (error) {
    logger.error('Failed to generate tournament code:', error);
    // safeInteractionError picks a channel that is still valid instead of
    // blindly calling update() on a token that may already be gone.
    await safeInteractionError(
      interaction,
      'An error occurred while generating the tournament code. Please try again later.',
    );
  }
}

// TODO: Fix this as to not need to send interaction
export async function getTournamentCode(
  team1: number,
  team2: number,
  divisionId: number,
  stage: string,
  interaction: ButtonInteraction,
  enemyCaptainId: string,
  first: boolean
): Promise<{
  discordResponse: string | null;
  draftLinks: string | null;
  shortcode: string | null;
  gameNumber: number;
  error: string | null;
  divisionId: number | null;
  divisionName?: string;
  stageName?: string;
  team1Name: string;
  team2Name: string;
  // The code's id, not a game's - since 1.4.0 a game exists only once a result
  // is written. This is the handle reportSeriesResult takes.
  tournamentCodeId: number;
  totalGames: number;
}> {
  //TODO: Call api with this informatio nand let it handle all this logic
  const division  = divisionId? Number(divisionId) : null
  const divisionEvent = division ? await getEvent(division) : null;
  const selectedStage = stage || divisionEvent?.eventStages?.[0] || null;
  logger.info(`Generating tournament code for teams ${team1} and ${team2} in division ${division} stage ${selectedStage}`);
  if (!selectedStage) {
    return {
      discordResponse: null,
      draftLinks: null,
      shortcode: null,
      gameNumber: 0,
      error: 'No event stage is configured for this division.',
      divisionId: division,
      team1Name: team1.toString(),
      team2Name: team2.toString(),
      tournamentCodeId: 0,
      totalGames: 0,
    };
  }
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
      tournamentCodeId: 0,
      totalGames:0
    };
  }
  logger.info(`Fetching teams: ${team1}, ${team2}`);
  const team1Data = await getTeam(Number(team1));
  const team2Data = await getTeam(Number(team2));
  const team1Name = team1Data?.name || 'Unknown Team 1';
  const team2Name = team2Data?.name || 'Unknown Team 2';
  logger.info(`Fetched teams - Team 1: ${team1Data?.id}  ${team1Data?.name}, Team 2: ${team2Data?.id}  ${team2Data?.name}`);
  const seriesId = await getSeriesId(division!, team1, team2, selectedStage);
  if (!seriesId) {
    return {
      discordResponse: null,
      draftLinks: null,
      shortcode: null,
      gameNumber: 0,
      error: 'Failed to find a matching series for these teams.',
      divisionId: division,
      team1Name,
      team2Name,
      tournamentCodeId: 0,
      totalGames: 0
    };
  }

  // One lookup by id for both figures. They previously came from two independent
  // resolutions by team pair, so the code could be booked against one series
  // while the Bo count and draft links came from another (todd-bot#97).
  //
  // Ahead of the code for the same reason the custom_id check above is: a code
  // is a real Riot artifact, so anything that can fail cheaply fails first.
  const series = await getSeries(seriesId);
  const gameNumber = nextGameNumber(series);
  const totalGames = series.totalGames;

  const code = await issueTournamentCode(seriesId, team1Data!, team2Data!);
  const shortcode = code.shortcode;

  const division_name = divisionEvent?.name || 'Unknown Division';
  const member = await interaction.guild!.members.fetch(interaction.user.id);
  const draftLinkMarkdown = first? (await getDraftLinksMarkdown(team1Data.name, team2Data.name, shortcode, totalGames)) + '\n': '';
  const sideShow = `# Game ${gameNumber} \n 🟦 __**${team1Name}**__ v.s.  __**${team2Name}**__ 🟥\n`;
  const gameCode: string = `\nCode: \`\`\`${shortcode}\`\`\`\n`;
  const generatedBy : string = `Game Generated By: <@${member.id}>\n`;
  const opposingCapt: string = `Enemy Captain: <@${enemyCaptainId}>\n`;
  const discordResponse = sideShow.concat(gameCode).concat(generatedBy).concat(opposingCapt);

  return {
    discordResponse,
    shortcode,
    draftLinks: draftLinkMarkdown,
    gameNumber,
    error: null,
    divisionId: division,
    divisionName: division_name,
    stageName: selectedStage,
    team1Name,
    team2Name,
    tournamentCodeId: code.id,
    totalGames
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
  execute: async (interaction: any, currentEventGroupId: number | null) => {
    logger.info('Executing /start-series command');
    logger.info(`current event id in tournament: ${currentEventGroupId}`);

    // Ack before touching dennys so a slow /events call can't expire the token.
    if (!(await safeDefer(interaction, { ephemeral: true }))) return;

    if (currentEventGroupId === null) {
      await interaction.editReply({
        content: 'Event group ID is not set. Please create a dev ticket.',
        components: [],
      });
      return;
    }
    const divisionsMap = await getEvents(currentEventGroupId);
    if (divisionsMap.length === 0) {
      await interaction.editReply({
        content: 'No divisions found.',
        components: [],
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
      stage: ""
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

    // editReply returns the message directly, so we no longer need withResponse.
    const message = await interaction.editReply({
      content: 'Please select a division:',
      components: [divisionRow],
    });
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      // Match on the parsed tag, not the raw id: custom_ids carry the compressed
      // wire code ('d'), so a startsWith on the readable name never matches and
      // the select goes unacked until Discord's 3s deadline kills it.
      filter: (i: { user: User; customId: string }) =>
        i.user.id === interaction.user.id && parseButtonData(i.customId).tag === 'division_select',
      time: 5 * 60 * 1000,
    });

    collector.on('collect', async (interaction: any) => {
      logger.info(`Collecting division select interaction: ${interaction.customId}`);
      // Awaited inside a guard - an un-awaited reject here took the bot down.
      await runGuarded(interaction, 'division_select', () =>
        handleDivisionSelect(interaction, message),
      );
    });
    return;
  }
};
 // Exporting the object with all functions and command
