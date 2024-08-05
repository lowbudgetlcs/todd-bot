
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
const channel_id = process.env.CHANNEL_ID;


client.once("ready", async () => {
	console.log("Discord bot is ready! 🤖");
	await deployCommands({ guildId:  guild_id!});
});

client.on("guildCreate", async (guild) => {
	console.log("deploy commands please")
  });

client.on(Events.InteractionCreate, async interaction => {
	if (!interaction.isChatInputCommand()) return;


	if (interaction.commandName == 'generate-tournament-code' && interaction.channelId == channel_id) {

		const modal = new ModalBuilder()
			.setCustomId('generate-tournament-code')
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
	else {
		interaction.reply({ content: 'Please do not use this command in this way <3', ephemeral: true });
	}

});

client.on(Events.InteractionCreate, async interaction => {
	if (!interaction.isModalSubmit()) return;

	await interaction.deferReply({ephemeral: true});

	// Get the data entered by the user
	const team1 = interaction.fields.getTextInputValue('team1');
	const team2 = interaction.fields.getTextInputValue('team2');

	const divisionMap = new Map();
	divisionMap.set(1, "ECONOMY");
	divisionMap.set(2, "COMMERCIAL");
	divisionMap.set(3, "FINANCIAL");
	divisionMap.set(4, "EXECUTIVE");
	divisionMap.set(5, "TEST");

	var tournament_code;
	try {
		tournament_code = await execute(team1, team2);
	}
	catch(e){
		interaction.followUp({content: "Error, contact ruuffian.", ephemeral: true});
		return;
	}
	if(tournament_code?.error!=""){
		interaction.followUp({content: tournament_code?.error, ephemeral: true});
	}
	else{
		let division_name = divisionMap.get(tournament_code?.division);
		let group_name = tournament_code?.group;
		let response = "## "+ division_name + " - Group "+group_name+ "\n"+"**__"+tournament_code.team1Name+"__** vs **__"+tournament_code.team2Name+"__**\n"+"Game "+(tournament_code?.game_number!)+" Code: ```"+tournament_code?.tournamentCode1 + "```";
		if(tournament_code?.game_number!>5)
			response = response.concat("\nYou are above the needed codes for your series. If you are experiencing issues, please open an admit ticket. <@247886805821685761>");
		interaction.followUp({content: response});
	}
});

client.login(config.DISCORD_TOKEN);
