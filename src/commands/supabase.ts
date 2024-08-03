import { CommandInteraction, SlashCommandBuilder } from "discord.js";
import { Database, Tables, Enums } from "../supabase/database.types";
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../utils/supabase'
import { config } from "../config";
import { drizzle } from 'drizzle-orm/postgres-js'

// import { db } from "../db";
import { teams } from "../supabase/schema";
import postgres from "postgres";



async function grabTeamInfo(team: String, supabase: any) {

    const client = postgres("postgresql://postgres.fxfjuvhcuqivdwmrnqpa:t0YPao$dQJWjRDI1@aws-0-us-east-1.pooler.supabase.com:5432/postgres");
    console.log(client);
    const db = drizzle(client);
    console.log(db);
    const allUsers = await db.select().from(teams);
    console.log(allUsers);


    return null;
}
  
export async function checkTeams(team1: String, team2: String){
    // const {data, error} = await supabase.from('teams').select();
    // console.log(error);

    const team1Data = await grabTeamInfo(team1, supabase);
    // const team2Data = await grabTeamInfo(team1, supabase);
    // console.log(team1Data);
    // console.log(team2Data);
}
// export const data = new SlashCommandBuilder()
//   .setName("supabaseTest")
//   .setDescription("Replies with test connection to supabase!");

// export async function execute(interaction: CommandInteraction) {
//     const { data, error } = await supabase
//   .from('countries')
//   .select()
//   return interaction.reply("Pong!");
// }