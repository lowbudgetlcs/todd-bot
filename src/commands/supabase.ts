import { CommandInteraction, SlashCommandBuilder } from "discord.js";
import { Database } from "../supabase/supabase";
import { createClient } from "@supabase/supabase-js";
import { config } from "../config";

const supabase = createClient<Database>(
    config.SUPABASE_URL,
   config.SUPABASE_KEY
)
  
// export const data = new SlashCommandBuilder()
//   .setName("supabaseTest")
//   .setDescription("Replies with test connection to supabase!");

// export async function execute(interaction: CommandInteraction) {
//     const { data, error } = await supabase
//   .from('countries')
//   .select()
//   return interaction.reply("Pong!");
// }