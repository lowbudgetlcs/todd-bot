
import { ActionRowBuilder, Client, Collection, Events, GatewayIntentBits, ModalActionRowComponentBuilder, ModalBuilder, REST, Routes, TextInputBuilder, TextInputStyle } from 'discord.js';
import { commands } from "./commands";
import { config } from "./config";
import {execute} from "./commands/tournnament";
import { TIMEOUT } from 'dns/promises';
import { deployCommands } from './deploy-commands';

// Create a new client instance
const client = new Client({ intents: ["Guilds", "GuildMessages", "DirectMessages"] });
const commandsData = Object.values(commands).map((command) => command.data);
const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);

const token = process.env.DISCORD_TOKEN;
const provider_id = process.env.PROVIDER_ID;
const guild_id = process.env.GUILD_ID;
const tournament_id = process.env.TOURNAMENT_ID;
const tournament_code_endpoint = process.env.TOURNAMENT_CODE_ENDPOIN;


client.once("ready", async () => {
	console.log("Discord bot is ready! 🤖");
	// await deployCommands({ guildId:  guild_id!});
});

client.on("guildCreate", async (guild) => {
	console.log("deploy commands please")
  });

client.on(Events.InteractionCreate, async interaction => {
	if (!interaction.isChatInputCommand()) return;

	if (interaction.commandName === 'genertate-tournament-code') {
		// Create the modal
		console.log(interaction.guildId)
		const modal = new ModalBuilder()
			.setCustomId('genertate-tournament-code')
			.setTitle('Tournament Codes');

		// Create the text input components
		const team1 = new TextInputBuilder()
			.setCustomId('team1')
			.setLabel("First team input")
			.setStyle(TextInputStyle.Short);

		const team2 = new TextInputBuilder()
			.setCustomId('team2')
			.setLabel("Second team input")
			.setStyle(TextInputStyle.Short);

		const firstActionRow = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(team1);
		const secondActionRow = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(team2);

		modal.addComponents(firstActionRow, secondActionRow);

		// Show the modal to the user
		await interaction.showModal(modal);
	}
});

client.on(Events.InteractionCreate, async interaction => {
	console.log(interaction.guildId);
	if (!interaction.isModalSubmit()) return;

	if(true){
	// Get the data entered by the user
		const team1 = interaction.fields.getTextInputValue('team1');
		const team2 = interaction.fields.getTextInputValue('team2');
		
		var tournament_code = await execute(team1, team2);
		interaction.reply({content: "The "+(tournament_code?.game_number!+1)+" Code for your series is ```"+tournament_code?.tournamentCode1+"```"});
	}
});

client.login(config.DISCORD_TOKEN);
