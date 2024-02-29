import { Client, Events, GatewayIntentBits } from 'discord.js';
import { config } from 'dotenv';

// Import env vars
config();
config({ path: '.env.local' });

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, readyClient => {
  console.info(`We are ready to rumble! Logged in as ${readyClient.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN ?? "");
