import { ButtonInteraction } from "discord.js";
import { 
    handleGenerateAnotherCode, 
    handleGenerateAnotherConfirm, 
    handleSwitchSidesConfirm, 
    handleEndSeries, 
    handleCancelSwitch 
} from "./commands/tournament";

export async function handleButtonInteraction(interaction: ButtonInteraction) {
    const customId = interaction.customId;

    if (customId.startsWith('generate_another:')) {
        await handleGenerateAnotherCode(interaction);
        return;
    }
    if (customId.startsWith('generate_another_confirm:')) {
        await handleGenerateAnotherConfirm(interaction);
        return;
    }
    if (customId.startsWith('switch_sides_confirm:')) {
        await handleSwitchSidesConfirm(interaction);
        return;
    }
    if (customId.startsWith('end_series:')) {
        await handleEndSeries(interaction);
        return;
    }
    if (customId.startsWith('cancel_switch:')) {
        await handleCancelSwitch(interaction);
        return;
    }
}