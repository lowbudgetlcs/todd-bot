import {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  CommandInteraction,
  StringSelectMenuInteraction
} from 'discord.js';
import { getEventGroups } from '../dennys.ts';
import { safeDefer } from '../interactionSafety.ts';

module.exports = {
  data: new SlashCommandBuilder().setName('set-current-event')
    .setDescription('Set the current event group for series creation'),
  async execute(interaction: CommandInteraction) {
    // Ack first: fetching event groups can outlast Discord's 3 second deadline.
    if (!(await safeDefer(interaction, { ephemeral: true }))) return;

    const eventGroups = await getEventGroups();
    if (!eventGroups.length) {
      await interaction.editReply({ content: 'No event groups found.' });
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

    await interaction.editReply({
      content: 'Select the event group to use for future series:',
      components: [row],
    });
  },
};

export async function handleEventGroupSelect(
  interaction: StringSelectMenuInteraction,
  { setCurrentEventGroupId }: { setCurrentEventGroupId: (id: number) => void },
) {
  const selectedId = parseInt(interaction.values[0]);
  const label = interaction.component.options.find(o => o.value === interaction.values[0])?.label;
  // Updates the live value and persists it, so a restart keeps this selection.
  setCurrentEventGroupId(selectedId);
  await interaction.update({
    content: `Current event group set to: **${label ?? selectedId}** (ID: ${selectedId})`,
    components: [],
  });
}