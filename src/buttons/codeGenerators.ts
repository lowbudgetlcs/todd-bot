import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import { getTournamentCode } from "../commands/tournament";

export async function handleCancelSwitch(interaction: ButtonInteraction) {
  try {
    const [_, team1, team2, originalUserId] = interaction.customId.split(':');
    
    if (interaction.user.id !== originalUserId) {
      await interaction.reply({
        content: "Only the person who generated the original code can perform this action.",
        ephemeral: true
      });
      return;
    }

    const generateButton = createButton("Generate Same Sides", "generate_another_confirm", team1, team2, originalUserId, ButtonStyle.Success, '⚔️');

    const switchButton = createButton("Switch Sides", "switch_sides_confirm", team2, team1, originalUserId, ButtonStyle.Primary, '🔄')  ;


    // const endSeriesButton = new ButtonBuilder()
    //   .setCustomId(`end_series:${team1}:${team2}:${originalUserId}`)
    //   .setLabel('End Series')
    //   .setStyle(ButtonStyle.Danger);

    const buttonRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(generateButton, switchButton);

    const content = `Current team sides:\n` +
      `# Blue Side: ${team1}\n` +
      `# Red Side: ${team2}\n\n` +
      `Choose to generate with same sides or switch them:`;

    // Use update to modify existing message when canceling
    await interaction.update({
      content: content,
      components: [buttonRow]
    });
  } catch (error) {
    console.error(error);
    await interaction.followUp({
      content: 'There was an error handling the cancellation.',
      ephemeral: true
    });
  }
}

export async function handleSwitchSidesConfirm(interaction: ButtonInteraction) {
  try {
    const [_, team1, team2, originalUserId] = interaction.customId.split(':');
    
    if (interaction.user.id !== originalUserId) {
      await interaction.reply({
        content: "Only the person who generated the original code can switch sides.",
        ephemeral: true
      });
      return;
    }

    const confirmButton =  createButton("Confirm Sides", "generate_another_confirm", team1, team2, originalUserId, ButtonStyle.Success, '✅');

    const cancelButton = createButton("Cancel Switch", "cancel_switch", team2, team1, originalUserId, ButtonStyle.Danger, '❌');

    const buttonRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(confirmButton, cancelButton);

    const content = `Please confirm the new sides:\n` +
      `# Blue Side: ${team1}\n` +
      `# Red Side: ${team2}\n\n` +
      `Click Confirm to generate code with these sides:`;

    // Use update to modify existing message for switch/cancel flow
    await interaction.update({
      content: content,
      components: [buttonRow],
    });
  } catch (error) {
    console.error(error);
    await interaction.followUp({
      content: 'There was an error preparing the side switch confirmation.',
      ephemeral: true
    });
  }
}

export async function handleGenerateAnotherConfirm(interaction: ButtonInteraction) {
  try {
    const [_, team1, team2, originalUserId] = interaction.customId.split(':');
    
    if (interaction.user.id !== originalUserId) {
      await interaction.reply({
        content: "Only the person who generated the original code can generate another one.",
        ephemeral: true
      });
      return;
    }

    await interaction.update({
      content: "Generating new tournament code...",
      components: [],
    });

    const tournamentCode = await getTournamentCode(
      team1,
      team2,
      interaction
    );

    if (tournamentCode.error) {
      await interaction.followUp({
        content: tournamentCode.error,
        ephemeral: true
      });
      return;
    }

    // Create generate another button
    const generateButton = createButton("Generate Next Game", "generate_another", team1, team2, originalUserId, ButtonStyle.Success, '⚔️');


    // const endSeriesButton = new ButtonBuilder()
    //   .setCustomId(`end_series:${team1}:${team2}:${originalUserId}`)
    //   .setLabel('End Series')
    //   .setStyle(ButtonStyle.Danger);

    const buttonRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(generateButton);

    // Send new message with tournament code and button
    await interaction.followUp({
      content: tournamentCode.discordResponse?.toString(),
      components: [buttonRow],
      ephemeral: false
    });

  } catch (error) {
    console.error(error);
    await interaction.followUp({
      content: 'There was an error generating a new tournament code.',
      ephemeral: true
    });
  }
}

export async function handleGenerateAnotherCode(interaction: ButtonInteraction) {
  try {
    const [_, team1, team2, originalUserId] = interaction.customId.split(':');
    if (interaction.user.id !== originalUserId) {
      await interaction.reply({
        content: "Only the person who generated the original code can generate another one.",
        ephemeral: true
      });
      return;
    }

    const generateButton = createButton("Generate Same Sides", "generate_another_confirm", team1, team2, originalUserId, ButtonStyle.Success, '⚔️');

    const switchButton = createButton("Switch Sides", "switch_sides_confirm", team2, team1, originalUserId, ButtonStyle.Primary, '🔄')  ;


    // const endSeriesButton = new ButtonBuilder()
    //   .setCustomId(`end_series:${team1}:${team2}:${originalUserId}`)
    //   .setLabel('End Series')
    //   .setStyle(ButtonStyle.Danger)
    //   .setEmoji('🏁');

    const buttonRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(generateButton, switchButton);

    const content = `Current team sides:\n` +
      `# Blue Side: ${team1}\n` +
      `# Red Side: ${team2}\n\n` +
      `Choose to generate with same sides or switch them:`;

    // Use reply for new message when generating another code
    await interaction.reply({
      content: content,
      components: [buttonRow],
      ephemeral: true
    });
  } catch (error) {
    console.error(error);
    await interaction.followUp({
      content: 'There was an error preparing the team selection.',
      ephemeral: true
    });
  }
}

export async function handleEndSeries(interaction: ButtonInteraction) {
  try {
    const [_, team1, team2, originalUserId] = interaction.customId.split(':');
    
    if (interaction.user.id !== originalUserId) {
      await interaction.reply({
        content: "Only the person who generated the original code can end this series.",
        ephemeral: true
      });
      return;
    }

    await interaction.update({
      content: interaction.message.content,
      components: [], // Remove all buttons
    });


  } catch (error) {
    console.error(error);
    await interaction.followUp({
      content: 'There was an error ending the series.',
      ephemeral: true
    });
  }
}

function createButton(label: string, customId: string, team1: string, team2: string, 
  originalUserId: string, style: ButtonStyle, emoji: string) {
  return new ButtonBuilder()
    .setCustomId(`${customId}:${team1}:${team2}:${originalUserId}`)
    .setLabel(label)
    .setStyle(style)
    .setEmoji(emoji);
}
