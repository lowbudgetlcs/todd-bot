import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import { getTournamentCode } from "../commands/tournament";
import { createButton, createButtonData, parseButtonData } from "./button";


export async function handleSwitchSides(interaction: ButtonInteraction) {
  try {
    const data = parseButtonData(interaction.customId);
    
    if (interaction.user.id !== data.originalUserId) {
      await interaction.reply({
        content: "Only the person who generated the original code can switch sides.",
        ephemeral: true
      });
      return;
    }

    const team1 = data.metadata[0];
    const team2 = data.metadata[1];
    const switchTeams = [team2, team1];

    const confirmButtonData = createButtonData("generate_another_confirm", data.originalUserId, data.metadata);
    const confirmButton = createButton(confirmButtonData, "Generate Next Game", ButtonStyle.Success, '✅');

    const cancelButtonData = createButtonData("switch_sides", data.originalUserId, switchTeams);
    const cancelButton = createButton(cancelButtonData, "Switch Sides", ButtonStyle.Primary, '🔄');

    const buttonRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(confirmButton, cancelButton);

    const content = `Please confirm the new sides:\n` +
      `# Blue Side: ${team1}\n` +
      `# Red Side: ${team2}\n\n` +
      `Click Generate to generate code with these sides`;

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
    const data = parseButtonData(interaction.customId);
    const team1 = data.metadata[0];
    const team2 = data.metadata[1];
    const switchTeams = [team2, team1];
    if (interaction.user.id !== data.originalUserId) {
      await interaction.reply({
        content: "Only the person who generated the original code can generate another one.",
        ephemeral: true
      });
      return;
    }

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
    const generateButtonData = createButtonData("generate_another", data.originalUserId, data.metadata);
    const generateButton = createButton(generateButtonData, "Generate Next Game", ButtonStyle.Success, '⚔️');


    // const endSeriesButton = new ButtonBuilder()
    //   .setCustomId(`end_series:${team1}:${team2}:${originalUserId}`)
    //   .setLabel('End Series')
    //   .setStyle(ButtonStyle.Danger);

    const buttonRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(generateButton);

    // Send new message with tournament code and button
    await interaction.update({
      content: "Generating new tournament code...",
      components: [],
    });

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
    const data = parseButtonData(interaction.customId);
    if (interaction.user.id !== data.originalUserId) {
      await interaction.reply({
        content: "Only the person who generated the original code can generate another one.",
        ephemeral: true
      });
      return;
    }

    const generateButtonData = createButtonData("generate_another_confirm", data.originalUserId, data.metadata);
    const generateButton = createButton(generateButtonData, "Generate Next Game", ButtonStyle.Success, '⚔️');

    const team1 = data.metadata[0];
    const team2 = data.metadata[1];
    const switchTeams = [team2, team1];
    const switchButtonData = createButtonData("switch_sides", data.originalUserId, switchTeams);  
    const switchButton = createButton(switchButtonData, "Switch Sides",ButtonStyle.Primary, '🔄')  ;


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
      `Choose to generate with same sides or switch them`;

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
    const data = parseButtonData(interaction.customId);
    
    if (interaction.user.id !== data.originalUserId) {
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

