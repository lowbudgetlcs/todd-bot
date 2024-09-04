import {GuildMemberRoleManager, SlashCommandBuilder} from "discord.js"
import { config } from "../config";

export const data = new SlashCommandBuilder().setName('command-toggle').setDescription('Switches Tournament Code Off');

export async function checkRole(roles:any){
    for(var i=0; i<config.ADMIN_ROLES.length; i++){
        for(var j=0; j<roles.length; j++){
            if(config.ADMIN_ROLES[i]===(roles[j].name))
                return true;
        }
    }
    return false;
}