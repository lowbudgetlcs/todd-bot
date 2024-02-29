const { Client, Events, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, readyClient => {
  console.info(`We are ready to rumble! Logged in as ${readyClient.user.tag}`);
});

client.login(process.env.token ?? "");
