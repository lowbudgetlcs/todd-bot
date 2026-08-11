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
  ThreadAutoArchiveDuration,
} from 'discord.js';
import { buildThreadName, getDraftLinksMarkdown } from '../util.ts';
import { runGuarded, safeDefer, safeInteractionError } from '../interactionSafety.ts';
import { User } from '../interfaces.ts';
import { createButton, createButtonData, parseButtonData, seriesDataFits } from '../buttons/button.ts';
import { SeriesWithGames } from '../dennysSchemas.ts';
import {
  buildControlRow,
  buildGameReportRow,
  buildRecoveryRow,
  buildSeriesStatus,
  highestPostedGameNumber,
  postSeriesControl,
  RECOVERY_MARKER,
} from '../seriesControl.ts';
import { findSeriesForTeams, getEvent, getEvents, getEventWithTeams, getSeries, getSeriesId, getTeam, isRetryableRiotGatewayError, isRiotGatewayError, issueTournamentCode, nextGameNumber, Team } from '../dennys.ts';
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
    seriesId: 0,
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
      i.user.id === interaction.user.id && ['team1_select', 'team2_select', 'stage_select', 'series_select'].includes(parseButtonData(i.customId).tag),
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
  let pinnedSeriesId = seriesData.seriesId;
  const division = seriesData.divisionId;
  const tag = data.tag; 
  const enemyCaptainId = seriesData.enemyCaptainId;
  logger.info(`Parsed data - tag: ${tag}, team1: ${team1}, team2: ${team2}, division: ${division}, stage: ${stage}, enemyCaptainId: ${enemyCaptainId}`);
  if (tag === 'cancel') {
    logger.info("Removing sides");
    team1 = '' as unknown as number;
    team2 = '' as unknown as number;
    stage = "";
    pinnedSeriesId = 0;
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
  } else if (tag === 'series_select') {
    pinnedSeriesId = Number(values[0]);
  }

  // Changing any of these invalidates a series chosen against the old ones.
  if (tag === 'team1_select' || tag === 'team2_select' || tag === 'stage_select') {
    pinnedSeriesId = 0;
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
    seriesId: pinnedSeriesId,
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

  

  // Two teams can meet more than once in a stage, and nothing on the series
  // distinguishes them but the Bo. Resolve here rather than at confirm time, so
  // the choice is made before anything exists in dennys.
  const candidates = await findSeriesForTeams(Number(division), Number(team1), Number(team2), stage);
  if (candidates.length === 0) {
    await interaction.editReply({
      content: 'Failed to find a matching series for these teams.',
      components: [],
    });
    return;
  }

  // Same Bo means genuinely interchangeable to a code-issuing service, and a
  // "Bo3 / Bo3" dropdown reads as broken. Lowest id keeps it deterministic.
  const interchangeable = candidates.every(s => s.totalGames === candidates[0].totalGames);
  const chosen =
    candidates.find(s => s.id === pinnedSeriesId) ?? (interchangeable ? candidates[0] : null);

  const summary =
    `Blue Side: **${team1Name}**\n` + `Red Side: **${team2Name}**\n` + `Stage: **${stage}**`;

  if (!chosen) {
    const seriesDropdown = new StringSelectMenuBuilder()
      .setCustomId(createButtonData('series_select', user.id, seriesDataUpdated).serialize())
      .setPlaceholder('Select which series')
      .addOptions(
        candidates.map(s => ({
          label: `Best of ${s.totalGames}`,
          value: String(s.id),
          default: s.id === pinnedSeriesId,
        })),
      );
    await interaction.editReply({
      content:
        `${summary}\n\nThese teams have more than one series in this stage. ` +
        `Pick the one you are playing.`,
      components: [
        row1,
        row2,
        row3,
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(seriesDropdown),
      ],
    });
    return;
  }

  const resolved: SeriesData = { ...seriesDataUpdated, seriesId: chosen.id };

  const confirmButtonData = createButtonData('confirm', user.id, resolved);
  const confirm = createButton(confirmButtonData, 'Confirm', ButtonStyle.Success, '✅');

  const switchSidesButtonData = createButtonData('switch', user.id, resolved);
  const switchSides = createButton(
    switchSidesButtonData,
    'Switch Sides',
    ButtonStyle.Primary,
    '🔄',
  );
  const cancelButtonData = createButtonData('cancel', user.id, resolved);
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
    `# Stage: ${stage}\n` +
    `# Best of ${chosen.totalGames}`;
  await interaction.editReply({
    content,
    components: [confirmRow],
  });
}

type SeriesHeader = Pick<
  Awaited<ReturnType<typeof getTournamentCode>>,
  'divisionName' | 'stageName' | 'team1Name' | 'team2Name' | 'shortcode'
>;

/**
 * Posts the public series header and opens its thread, then puts `first` inside
 * it. Reached from both the success path and the Riot-outage path: a series with
 * no code still needs somewhere to live, or there is nowhere to report from.
 */
async function openSeriesThread(
  interaction: ButtonInteraction,
  userId: string,
  header: SeriesHeader,
  first: { content: string; components?: ActionRowBuilder<ButtonBuilder>[]; flags?: number },
) {
  const publicMessage = await interaction.followUp({
    content:
      `## ${header.divisionName} - ${header.stageName || 'UNKNOWN_STAGE'}\n` +
      `**__${header.team1Name}__ v.s. __${header.team2Name}__**\n\n` +
      `Series Created By: <@${userId}>`,
    ephemeral: false,
  });

  const dateString = new Date().toISOString().split('T')[0];
  // buildThreadName keeps us under Discord's 100 char cap; team names with
  // special characters are already repaired upstream in dennys.ts.
  const threadName = buildThreadName(header.team1Name, header.team2Name, dateString);
  logger.info(`Creating thread: ${threadName}`);
  const thread = await publicMessage.startThread({
    name: threadName,
    // The longest Discord offers - one hour, one day, three days and one week
    // are the only values it accepts, and archiving cannot be turned off.
    //
    // The timer runs from the last message rather than from creation, so an
    // active series never archives on its own. This is for the gaps: an
    // emergency pause can leave a thread quiet for hours, and it should still be
    // in the channel's thread list when play resumes. Archiving is not a dead
    // end either - an unlocked thread accepts a message and unarchives itself.
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    reason: `Series thread for ${header.team1Name} vs ${header.team2Name}`,
  });

  await thread.send(first);
  return thread;
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
    const tournamentCode = await getTournamentCode({
      team1Id: seriesData.team1Id,
      team2Id: seriesData.team2Id,
      divisionId: seriesData.divisionId,
      stage: seriesData.stage,
      seriesId: seriesData.seriesId,
      interaction,
      enemyCaptainId: seriesData.enemyCaptainId,
      first: true,
    });
    if (tournamentCode.riotUnavailable) {
      // The series still gets a thread. A series played entirely on customs has
      // to live somewhere, and without one there is nowhere to report from.
      await interaction.editReply({
        content: 'Riot would not issue a code. Continuing in a thread.',
        components: [],
      });
      await interaction.deleteReply();
      await openSeriesThread(interaction, user.id, tournamentCode, {
        content: `${RECOVERY_MARKER} ${tournamentCode.error}`,
        components: [
          buildRecoveryRow(
            user.id,
            { ...seriesData, seriesId: tournamentCode.seriesId },
            tournamentCode.retryable,
          ),
        ],
      });
    } else if (tournamentCode.error != null) {
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

      // Pinned here, at the one point the series is known: every later press
      // reads it back out rather than resolving from the team pair again.
      const pinnedSeries: SeriesData = { ...seriesData, seriesId: tournamentCode.seriesId };
      const links = tournamentCode.draftLinks?.toString().concat("<@"+seriesData.enemyCaptainId+">") || null;
      logger.info(`Draft Links: ${links}`);
      const thread = await openSeriesThread(interaction, user.id, tournamentCode, {
        content: links!,
        flags: 1 << 2,
      });

      // The report button lives here rather than on the control message, so it
      // can name the code it is reporting - see buildGameReportRow.
      await thread.send({
        content: tournamentCode.discordResponse?.toString() || "",
        components: [
          buildGameReportRow(
            user.id,
            pinnedSeries,
            tournamentCode.tournamentCodeId,
            tournamentCode.gameNumber,
          ),
        ],
      });

      // Controls go last and stay last, so the newest state is always at the
      // bottom of the thread rather than scrolled away above the codes.
      if (tournamentCode.series) {
        await postSeriesControl(
          thread as unknown as Parameters<typeof postSeriesControl>[0],
          buildSeriesStatus(tournamentCode.series, [
            { id: seriesData.team1Id, name: tournamentCode.team1Name },
            { id: seriesData.team2Id, name: tournamentCode.team2Name },
          ]),
          [buildControlRow(user.id, pinnedSeries, tournamentCode.series)],
        );
      }
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
export type TournamentCodeRequest = {
  team1Id: number;
  team2Id: number;
  divisionId: number;
  stage: string;
  /** Pinned series, or 0 to resolve it from the team pair. */
  seriesId: number;
  interaction: ButtonInteraction;
  enemyCaptainId: string;
  /** Only the first game of a series gets draft links. */
  first: boolean;
  /**
   * The captain declared the existing code dead, so this code takes its slot
   * rather than the next one. Without it, a replacement would advance the game
   * number - the thing the recovery flow promises it will not do.
   */
  replacement?: boolean;
};

export async function getTournamentCode({
  team1Id: team1,
  team2Id: team2,
  divisionId,
  stage,
  seriesId: pinnedSeriesId,
  interaction,
  enemyCaptainId,
  first,
  replacement = false,
}: TournamentCodeRequest): Promise<{
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
  /** The resolved series, for callers building buttons that must pin it. */
  seriesId: number;
  /** The series as read after the code was issued, or null on an error path. */
  series: SeriesWithGames | null;
  /** Riot, not us, refused the code. The custom-game path is the way forward. */
  riotUnavailable: boolean;
  /** Only meaningful with riotUnavailable: whether pressing again is worth it. */
  retryable: boolean;
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
      seriesId: 0,
      series: null,
      riotUnavailable: false,
      retryable: false,
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
      seriesId: 0,
      series: null,
      riotUnavailable: false,
      retryable: false,
      totalGames:0
    };
  }
  logger.info(`Fetching teams: ${team1}, ${team2}`);
  const team1Data = await getTeam(Number(team1));
  const team2Data = await getTeam(Number(team2));
  const team1Name = team1Data?.name || 'Unknown Team 1';
  const team2Name = team2Data?.name || 'Unknown Team 2';
  logger.info(`Fetched teams - Team 1: ${team1Data?.id}  ${team1Data?.name}, Team 2: ${team2Data?.id}  ${team2Data?.name}`);
  // Once pinned, the series never gets looked up by team pair again. Re-resolving
  // is what let a completed series hand the next code to the wrong one.
  const seriesId = pinnedSeriesId || (await getSeriesId(division!, team1, team2, selectedStage));
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
      seriesId: 0,
      series: null,
      riotUnavailable: false,
      retryable: false,
      totalGames: 0
    };
  }

  let code;
  try {
    code = await issueTournamentCode(seriesId, team1Data!, team2Data!);
  } catch (error) {
    // Riot refusing is not a lookup failure, and telling a captain "no such
    // series" when Riot is down leaves them with nothing to try.
    if (!isRiotGatewayError(error)) throw error;
    const retryable = isRetryableRiotGatewayError(error);
    logger.error(`Riot could not issue a code for series ${seriesId}:`, error);
    return {
      discordResponse: null,
      draftLinks: null,
      shortcode: null,
      gameNumber: 0,
      error: retryable
        ? 'Riot is not answering right now. Try again in a moment, or play a custom game.'
        : 'Riot refused to create a code for this game. Playing a custom is the way forward.',
      divisionId: division,
      divisionName: divisionEvent?.name,
      stageName: selectedStage,
      team1Name,
      team2Name,
      tournamentCodeId: 0,
      totalGames: 0,
      seriesId,
      series: null,
      riotUnavailable: true,
      retryable,
    };
  }
  const shortcode = code.shortcode;

  // Read the series *after* issuing, not before. Issuing a code makes dennys pull
  // any played game it has not heard about yet, so a lookup that runs first
  // reports the pre-pull count - which reads as "# Game 1" forever whenever a
  // Riot callback went missing.
  //
  // One lookup covers both figures. They previously came from two independent
  // resolutions by team pair, so the code could be booked against one series
  // while the Bo count and draft links came from another (todd-bot#97).
  const series = await getSeries(seriesId);
  const totalGames = series.totalGames;

  // Recorded results are the floor, not the answer. They only move when a
  // result is written, so generating twice without reporting would stamp the
  // same number on both codes. What the thread already shows is the missing
  // half: the slot the last code went out for.
  //
  // Both are combined with max() rather than trusting the thread outright, so a
  // thread with no code messages - a series that has only ever played customs,
  // or a scan that failed - still lands on a sane number.
  const baseline = nextGameNumber(series);
  const posted = first
    ? 0
    : await highestPostedGameNumber(
        interaction.channel as unknown as Parameters<typeof highestPostedGameNumber>[0],
      );
  const gameNumber = Math.max(baseline, replacement ? posted : posted + 1);

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
    seriesId,
    series,
    riotUnavailable: false,
    retryable: false,
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
      seriesId: 0,
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
