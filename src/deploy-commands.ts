import { REST, Routes, RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";
import { config } from "./config";

const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);

type DeployCommandsProps = {
  guildId: string;
};

export async function deployCommands({ guildId }: DeployCommandsProps, commands: RESTPostAPIChatInputApplicationCommandsJSONBody[]) {
  try {
    console.log("Started refreshing application (/) commands.");
    await rest
      .put(Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, guildId), {
        body: [],
      })
      .then(() => console.log("Successfully deleted all guild commands."))
      .catch(console.error);

    console.log(commands);
    await rest.put(
      Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, guildId),
      {
        body: commands,
      },
    );

    console.log("Successfully reloaded application (/) commands.");
  } catch (error) {
    console.error(error);
  }
}
