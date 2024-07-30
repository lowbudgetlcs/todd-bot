"use strict";var _=Object.create;var u=Object.defineProperty;var N=Object.getOwnPropertyDescriptor;var b=Object.getOwnPropertyNames;var v=Object.getPrototypeOf,w=Object.prototype.hasOwnProperty;var I=(o,e)=>{for(var n in e)u(o,n,{get:e[n],enumerable:!0})},V=(o,e,n,r)=>{if(e&&typeof e=="object"||typeof e=="function")for(let s of b(e))!w.call(o,s)&&s!==n&&u(o,s,{get:()=>e[s],enumerable:!(r=N(e,s))||r.enumerable});return o};var M=(o,e,n)=>(n=o!=null?_(v(o)):{},V(e||!o||!o.__esModule?u(n,"default",{value:o,enumerable:!0}):n,o));var p=require("discord.js");var l={};I(l,{data:()=>U,execute:()=>K});var E=require("discord.js");var f=M(require("dotenv")),y=require("@fightmegg/riot-api");f.default.config();var{DISCORD_TOKEN:g,DISCORD_CLIENT_ID:R,GUILD_ID:C,SUPABASE_URL:D,SUPABASE_KEY:P,RIOT_KEY:h}=process.env,x={debug:!1},S=new y.RiotAPI(String(h),x);console.log(S.account);if(!g||!R||!C||!D||!P)throw new Error("Missing environment variables");var t={DISCORD_TOKEN:g,DISCORD_CLIENT_ID:R,GUILD_ID:C,SUPABASE_URL:D,SUPABASE_KEY:P,rAPI:S};var m=require("@fightmegg/riot-api"),U=new E.SlashCommandBuilder().setName("ping").setDescription("Replies with Pong!");async function K(o){console.log("here");let e=await t.rAPI.tournamentStubV5.createProvider({body:{region:m.RiotAPITypes.TournamentV5.REGION.NA,url:""}});console.log(e);let n=await t.rAPI.tournamentStubV5.createTournament({body:{providerId:e}});console.log(String(n));let r=await t.rAPI.tournamentStubV5.createCodes({params:{count:1,tournamentId:n},body:{teamSize:5,pickType:m.RiotAPITypes.TournamentV5.PICKTYPE.TOURNAMENT_DRAFT,mapType:m.RiotAPITypes.TournamentV5.MAPTYPE.SUMMONERS_RIFT,spectatorType:m.RiotAPITypes.TournamentV5.SPECTATORTYPE.ALL,enoughPlayers:!0}});return console.log(r),o.reply(String(r.pop()))}var T={};I(T,{data:()=>L,execute:()=>Y});var A=require("discord.js");var i=require("@fightmegg/riot-api"),L=new A.SlashCommandBuilder().setName("tournament").setDescription("Replies with tournamentid!");async function Y(o){let e=await t.rAPI.tournamentStubV5.createProvider({body:{region:i.RiotAPITypes.TournamentV5.REGION.NA,url:""}}),n=await t.rAPI.tournamentStubV5.createTournament({body:{providerId:e}}),r=await t.rAPI.tournamentStubV5.createCodes({params:{count:1,tournamentId:n},body:{teamSize:5,pickType:i.RiotAPITypes.TournamentV5.PICKTYPE.TOURNAMENT_DRAFT,mapType:i.RiotAPITypes.TournamentV5.MAPTYPE.SUMMONERS_RIFT,spectatorType:i.RiotAPITypes.TournamentV5.SPECTATORTYPE.ALL,enoughPlayers:!0}});return o.reply(String(r.pop))}var a={ping:l,tournament:T};var c=require("discord.js");var k=Object.values(a).map(o=>o.data),G=new c.REST({version:"10"}).setToken(t.DISCORD_TOKEN);async function O({guildId:o}){try{console.log("Started refreshing application (/) commands."),await G.put(c.Routes.applicationGuildCommands(t.DISCORD_CLIENT_ID,o),{body:k}),console.log("Successfully reloaded application (/) commands.")}catch(e){console.error(e)}}var d=new p.Client({intents:["Guilds","GuildMessages","DirectMessages"]}),io=Object.values(a).map(o=>o.data),co=new p.REST({version:"10"}).setToken(t.DISCORD_TOKEN),po=process.env.DISCORD_TOKEN,uo=process.env.PROVIDER_ID,lo=process.env.TOURNAMENT_ID,To=process.env.TOURNAMENT_CODE_ENDPOIN;d.once("ready",()=>{console.log("Discord bot is ready! \u{1F916}")});d.on("guildCreate",async o=>{console.log("here"),await O({guildId:o.id})});d.on("interactionCreate",async o=>{if(!o.isCommand())return;let{commandName:e}=o;a[e]&&a[e].execute(o)});console.log(t.DISCORD_CLIENT_ID);d.login(t.DISCORD_TOKEN);
