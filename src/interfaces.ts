import { ActionRowBuilder, StringSelectMenuBuilder } from "discord.js";

  export interface User {
    id: string;
    username: string;
  }

  export interface InteractionBasic {
    customId: string;
    user: User;
    guild: any;
    update: (arg0: { content: string; components: never[] | ActionRowBuilder<any>[]; flags?: string; withResponse?: boolean }) => Promise<void>;
    followUp: (arg0: { content: string; components?: never[] | ActionRowBuilder<any>[]; flags?: string; withResponse?: boolean, ephemeral: boolean }) => Promise<void>;
  }
  export interface InteractionReply {
    resource: any;
    content: string;
    components: never[] | ActionRowBuilder<StringSelectMenuBuilder>[];
    flags: string;
    withResponse?: boolean;
  }

