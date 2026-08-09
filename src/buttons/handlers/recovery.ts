import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle } from 'discord.js';
import { createButton, createButtonData, parseButtonData } from '../button.ts';
import { safeDefer, safeInteractionError } from '../../interactionSafety.ts';
import log from 'loglevel';

const logger = log.getLogger('recovery');
logger.setLevel('info');

const mayAct = (interaction: ButtonInteraction, originalUserId: string, enemyCaptainId: string) =>
  interaction.user.id === originalUserId || interaction.user.id === enemyCaptainId;

async function refuse(interaction: ButtonInteraction) {
  await interaction.reply({
    content: 'Only the two captains in this series can do that.',
    ephemeral: true,
  });
}

/**
 * A dead code and a code that never generated need the same exits. Gating the
 * custom path on "Riot is down" strands captains whose code technically works
 * but is unusable.
 */
export async function handleCodeNotWorking(interaction: ButtonInteraction) {
  try {
    const data = parseButtonData(interaction.customId);
    const seriesData = data.seriesData;
    if (!mayAct(interaction, data.originalUserId, seriesData.enemyCaptainId)) return refuse(interaction);
    if (!(await safeDefer(interaction, { ephemeral: true }))) return;

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      createButton(
        createButtonData('generate_another_confirm', data.originalUserId, seriesData),
        'Generate a new one',
        ButtonStyle.Primary,
        '🔄',
      ),
      createButton(
        createButtonData('play_custom', data.originalUserId, seriesData),
        'Go play a custom game',
        ButtonStyle.Secondary,
        '⚠️',
      ),
      createButton(
        createButtonData('cancel_flow', data.originalUserId, seriesData),
        'Cancel',
        ButtonStyle.Secondary,
        '❌',
      ),
    );

    await interaction.editReply({
      content:
        'A replacement code does not affect the game number — a code nobody played does not count.\n' +
        'If Riot will not give you a working one, play a custom instead.',
      components: [row],
    });
  } catch (error) {
    logger.error(error);
    await safeInteractionError(interaction, 'There was an error opening the recovery options.');
  }
}

/** Confirms before committing, because a custom costs the captains their stats. */
export async function handlePlayCustom(interaction: ButtonInteraction) {
  try {
    const data = parseButtonData(interaction.customId);
    const seriesData = data.seriesData;
    if (!mayAct(interaction, data.originalUserId, seriesData.enemyCaptainId)) return refuse(interaction);
    if (!(await safeDefer(interaction, { ephemeral: true }))) return;

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      createButton(
        createButtonData('play_custom_confirm', data.originalUserId, seriesData),
        "Yes, we're playing a custom",
        ButtonStyle.Danger,
        '✅',
      ),
      createButton(
        createButtonData('cancel_flow', data.originalUserId, seriesData),
        'Cancel',
        ButtonStyle.Secondary,
        '❌',
      ),
    );

    await interaction.editReply({
      content:
        'Are you sure? A custom game is not tracked by Riot, so there are **no stats** for it.\n' +
        'Take a screenshot of the final scoreboard — you will need it for the post-game form.',
      components: [row],
    });
  } catch (error) {
    logger.error(error);
    await safeInteractionError(interaction, 'There was an error opening the custom game prompt.');
  }
}

/**
 * Posts the way back into the normal flow. This message is not a control
 * message and is never replaced: the custom is played over the next half hour,
 * and the button has to survive however many codes are issued meanwhile.
 */
export async function handlePlayCustomConfirm(interaction: ButtonInteraction) {
  try {
    const data = parseButtonData(interaction.customId);
    const seriesData = data.seriesData;
    if (!mayAct(interaction, data.originalUserId, seriesData.enemyCaptainId)) return refuse(interaction);
    if (!(await safeDefer(interaction, { update: true }))) return;

    logger.info(
      `Custom game started by ${interaction.user.id} for series ${seriesData.seriesId}`,
    );

    await interaction.editReply({
      content: 'Play the custom, then use the button in the thread to report who won.',
      components: [],
    });

    const thread = interaction.channel;
    if (thread && 'send' in thread) {
      await thread.send({
        content:
          '⚠️ A custom game is being played for this series. ' +
          'Report the winner here once it is done — remember the scoreboard screenshot.',
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            createButton(
              createButtonData('report_result', data.originalUserId, seriesData),
              'We finished the custom game',
              ButtonStyle.Success,
              '✅',
            ),
          ),
        ],
      });
    }
  } catch (error) {
    logger.error(error);
    await safeInteractionError(interaction, 'There was an error starting the custom game flow.');
  }
}
