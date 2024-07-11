
import { Client, Collection, Events, GatewayIntentBits, REST, Routes } from 'discord.js';
import { commands } from "./commands";
import { config } from "./config";
import { deployCommands } from "./deploy-commands";
import { createClient } from '@supabase/supabase-js'
import { Database } from './supabase/supabase';


// Create a new client instance
const client = new Client({ intents: ["Guilds", "GuildMessages", "DirectMessages"] });
const commandsData = Object.values(commands).map((command) => command.data);


const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);



const token = process.env.DISCORD_TOKEN;
const provider_id = process.env.PROVIDER_ID;
const tournament_id = process.env.TOURNAMENT_ID;
const tournament_code_endpoint = process.env.TOURNAMENT_CODE_ENDPOIN;


client.once("ready", () => {
	console.log("Discord bot is ready! 🤖");
	
});

client.on("guildCreate", async (guild) => {
	await deployCommands({ guildId: guild.id });
});
client.on("interactionCreate", async (interaction) => {
	if (!interaction.isCommand()) {
	  return;
	}
	const { commandName } = interaction;
	if (commands[commandName as keyof typeof commands]) {
	  commands[commandName as keyof typeof commands].execute(interaction);
	}
  });
  
  client.login(config.DISCORD_TOKEN);
