import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, MessageFlags } from 'discord.js';
import { createButton, createButtonData, parseButtonData } from '../button.ts';
import { safeDefer, safeInteractionError } from '../../interactionSafety.ts';
import {
  CUSTOM_MARKER,
  encodeReportTarget,
  highestPostedGameNumber,
  retireGameButtons,
  shareThreadScan,
} from '../../seriesControl.ts';
import type { ControlThread } from '../../seriesControl.ts';
import log from 'loglevel';

const logger = log.getLogger('recovery');
logger.setLevel('info');

const mayAct = (interaction: ButtonInteraction, originalUserId: string, enemyCaptainId: string) =>
  interaction.user.id === originalUserId || interaction.user.id === enemyCaptainId;

/**
 * "Go play a custom game" is minted onto two different kinds of message: the
 * public recovery row posted in-thread when a code fails outright, and the
 * private "Code not working?" menu. Only the latter should be edited in
 * place - editing the public row would fold a private-looking confirmation
 * into a message the other captain relies on, and would put "Cancel" a click
 * away from deleting it outright.
 */
const cameFromEphemeralMessage = (interaction: ButtonInteraction) =>
  interaction.message?.flags?.has(MessageFlags.Ephemeral) ?? false;

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
      // regenerate_confirm, not generate_another_confirm: reaching this button
      // means the captain has declared the current code dead, which is the only
      // thing that licenses removing its message from the thread.
      createButton(
        createButtonData('regenerate_confirm', data.originalUserId, seriesData),
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
    // Editing in place on the ephemeral menu is what stops the previous step
    // ("A replacement code does not affect the game number...") from being
    // left behind - see cameFromEphemeralMessage above.
    const opts = cameFromEphemeralMessage(interaction) ? { update: true } : { ephemeral: true };
    if (!(await safeDefer(interaction, opts))) return;

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
      // Which game the custom is being played for. The thread is the only
      // record: dennys assigns a number when the result is written, and a
      // custom consumes no tournament code on the way there.
      // Read the thread once for both the number and the sweep below it.
      const scan = shareThreadScan(thread as unknown as ControlThread);
      const gameNumber = Math.max(1, await highestPostedGameNumber(scan));

      // The code for this game is dead - that is what the captain just said by
      // choosing the custom - so its Report button goes now rather than staying
      // up to offer a second report of the game the custom is about to record.
      // Before the message below, so the button it carries survives the sweep.
      await retireGameButtons(scan, gameNumber);

      await thread.send({
        // CUSTOM_MARKER, not RECOVERY_MARKER: this button has to survive every
        // result recorded between now and the custom being reported, and the ⚠️
        // sweep retires its messages on the first one.
        content:
          `${CUSTOM_MARKER} A custom game is being played for **Game ${gameNumber}**. ` +
          'Report the winner here once it is done — remember the scoreboard screenshot.',
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            createButton(
              // report_custom, not report_result: a custom leaves no trace in
              // dennys, so the check that stops a duplicate report has nothing
              // to look at and would read another game's result instead. The
              // target carries no code for the same reason.
              createButtonData(
                'report_custom',
                data.originalUserId,
                seriesData,
                encodeReportTarget(null, gameNumber),
              ),
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
