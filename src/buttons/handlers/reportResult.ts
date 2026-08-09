import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle } from 'discord.js';
import { createButton, createButtonData, parseButtonData } from '../button.ts';
import { getSeries, getTeam, reportSeriesResult } from '../../dennys.ts';
import { buildControlRow, buildSeriesStatus, postSeriesControl } from '../../seriesControl.ts';
import { safeDefer, safeInteractionError } from '../../interactionSafety.ts';
import log from 'loglevel';

const logger = log.getLogger('reportResult');
logger.setLevel('info');

const mayAct = (interaction: ButtonInteraction, originalUserId: string, enemyCaptainId: string) =>
  interaction.user.id === originalUserId || interaction.user.id === enemyCaptainId;

/** Opens the winner picker. The report itself happens on the next click. */
export async function handleReportResult(interaction: ButtonInteraction) {
  try {
    const data = parseButtonData(interaction.customId);
    const seriesData = data.seriesData;
    if (!mayAct(interaction, data.originalUserId, seriesData.enemyCaptainId)) {
      await interaction.reply({
        content: 'Only the two captains in this series can report a result.',
        ephemeral: true,
      });
      return;
    }

    if (!(await safeDefer(interaction, { ephemeral: true }))) return;

    const [team1, team2] = await Promise.all([
      getTeam(seriesData.team1Id),
      getTeam(seriesData.team2Id),
    ]);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      createButton(
        createButtonData('report_team1_won', data.originalUserId, seriesData),
        `${team1.name} won`,
        ButtonStyle.Primary,
        '🟦',
      ),
      createButton(
        createButtonData('report_team2_won', data.originalUserId, seriesData),
        `${team2.name} won`,
        ButtonStyle.Danger,
        '🟥',
      ),
      createButton(
        createButtonData('cancel_flow', data.originalUserId, seriesData),
        'Cancel',
        ButtonStyle.Secondary,
        '❌',
      ),
    );

    await interaction.editReply({
      content: 'Who won this game?',
      components: [row],
    });
  } catch (error) {
    logger.error(error);
    await safeInteractionError(interaction, 'There was an error opening the result form.');
  }
}

/**
 * Records the winner and refreshes the thread.
 *
 * The request names a winner and nothing else. Todd knows the shortcode it
 * issued and must not send it: with two codes outstanding it cannot tell which
 * one the lobby was made with, and naming the wrong one records a second game
 * for the same match. Dennys asks Riot instead, and only falls back to this
 * claim when Riot has no record.
 */
async function report(interaction: ButtonInteraction, winner: 'team1' | 'team2') {
  try {
    const data = parseButtonData(interaction.customId);
    const seriesData = data.seriesData;
    if (!mayAct(interaction, data.originalUserId, seriesData.enemyCaptainId)) {
      await interaction.reply({
        content: 'Only the two captains in this series can report a result.',
        ephemeral: true,
      });
      return;
    }

    if (!(await safeDefer(interaction, { update: true }))) return;

    const winnerTeamId = winner === 'team1' ? seriesData.team1Id : seriesData.team2Id;
    // A captain can report a winner Riot does not corroborate, and the blast
    // radius is series routing. Staff need to know who said so.
    logger.info(
      `Result reported by ${interaction.user.id} for series ${seriesData.seriesId}: team ${winnerTeamId} won`,
    );

    await reportSeriesResult(seriesData.seriesId, { winnerTeamId });

    const [series, team1, team2] = await Promise.all([
      getSeries(seriesData.seriesId),
      getTeam(seriesData.team1Id),
      getTeam(seriesData.team2Id),
    ]);

    await interaction.editReply({ content: 'Result recorded.', components: [] });

    const thread = interaction.channel;
    if (thread) {
      await postSeriesControl(
        thread as unknown as Parameters<typeof postSeriesControl>[0],
        buildSeriesStatus(series, [
          { id: team1.id, name: team1.name },
          { id: team2.id, name: team2.name },
        ]),
        [buildControlRow(data.originalUserId, seriesData, series)],
      );
    }
  } catch (error) {
    logger.error(error);
    await safeInteractionError(interaction, 'There was an error recording that result.');
  }
}

export const handleReportTeam1Won = (interaction: ButtonInteraction) => report(interaction, 'team1');
export const handleReportTeam2Won = (interaction: ButtonInteraction) => report(interaction, 'team2');
