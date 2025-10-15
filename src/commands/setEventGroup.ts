import {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  CommandInteraction,
  StringSelectMenuInteraction
} from 'discord.js';
import { getEventGroups } from '../dennys.ts';

module.exports = {
  data: new SlashCommandBuilder().setName('set-current-event')
    .setDescription('Set the current event group for series creation'),
  async execute(interaction: CommandInteraction) {
    const eventGroups = await getEventGroups();
    if (!eventGroups.length) {
      await interaction.reply({ content: 'No event groups found.', ephemeral: true });
      return;
    }

    const options = eventGroups.map(group => ({
      label: group.name,
      value: group.id.toString(),
    }));

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('select_event_group')
      .setPlaceholder('Choose an event group')
      .addOptions(options);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    await interaction.reply({
      content: 'Select the event group to use for future series:',
      components: [row],
      ephemeral: true,
    });
  },
};

export async function handleEventGroupSelect(interaction: StringSelectMenuInteraction, {setCurrentEventGroupId }: {setCurrentEventGroupId: (id: number) => void }) {
  const selectedId = parseInt(interaction.values[0]);
  setCurrentEventGroupId(selectedId);
  await interaction.update({
    content: `Current event group set to ID: ${selectedId}`,
    components: [],
  });
}