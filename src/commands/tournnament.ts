import {
  ActionRowBuilder,
  CacheType,
  ComponentType,
  Interaction,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from "discord.js";
import { db } from "../db/db";
import { divisions, games, series, teams, teamToSeries } from "../db/schema";
import { and, sql, desc, eq} from "drizzle-orm";
import {alias } from "drizzle-orm/pg-core"
import { config } from "../config";
import { RiotAPITypes } from "@fightmegg/riot-api/dist/esm/@types";
import { DatabaseUtil } from "../util";

module.exports = {
  data: new SlashCommandBuilder()
  .setName("generate-tournament-code")
  .setDescription("Generate Tournament Code"),
  async execute(interaction) {

    
    let divisionsMap = DatabaseUtil.Instance.divisionsMap;

    if(divisionsMap.size==0) {
      await interaction.reply({
        content: "No divisions found.",
        components: [],
        flags: "Ephemeral",
      });
      return;
    }
    const divisionDropdown = new StringSelectMenuBuilder()
      .setCustomId("division_select")
      .setPlaceholder("Select a Division")
      .addOptions(
        Array.from(divisionsMap.entries()).map(([key, value]) => ({
          label: value.toString(),
          value: key.toString(),
        }))
      );
    const divisionRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(divisionDropdown);

    const response = await interaction.reply({
      content: "Please select a division:",
      components: [divisionRow],
      flags: "Ephemeral",
      withResponse: true
    });
    // Since we're not making any NEW messages we'll have to pass this fella around to keep listening to him
    // As we traverse through each menu.
    const message = response.resource!.message;
    const collector = response.resource!.message!.createMessageComponentCollector(
      {
        componentType: ComponentType.StringSelect,
        filter: (i) => i.user === interaction.user && i.customId == "division_select",
        time: 5 * 60 * 1000,
      }
    );

    collector.on('collect', async (interaction) =>{
      handleDivisionSelect(interaction, message);
    } );
    return;  
  }
}

async function grabTeamInfo(team: String) {
  let data = await db
    .select()
    .from(teams)
    .where(sql`lower(${teams.name}) = lower(${team})`);
  return data[0];
}
const userState = new Map();

async function getTeamsByDivision(division: number) {
  let data = await db.select().from(teams).where((eq(teams.divisionId, division)));
  return data;
}

async function checkSeries(team1Data: any, team2Data: any) {
  const team1 = alias(teamToSeries, "team1");
  const team2 = alias(teamToSeries, "team2");
  try{
  let response = await db
    .select({ seriesId: series.id }) // Specify the column(s) to retrieve
    .from(series)
    .innerJoin(
      team1 , // First join for team1
      and(eq(team1.seriesId, series.id), (eq(team1.teamId, team1Data.id))) // Match team1
    )
    .innerJoin(
      team2, // Second join for team2 with alias "st2"
      and(eq(team2.seriesId, series.id), (eq(team2.teamId, team2Data.id))) // Match team2 using alias
    )
    .where(eq(team1.seriesId, series.id)) // Ensure both teams are in the same series
    .limit(1); // Optionally limit to one result if needed

  return response[0];
  } catch(e){
    console.log(e);
    return null;
  }
}
// TODO: we should NOT use any here if we know what it's going to be.
// i don't know what it is going to be LMFAO
async function handleDivisionSelect(interaction: any, message: any) {
  const { customId, values, user } = interaction;
  let divisionsMap = DatabaseUtil.Instance.divisionsMap;
  const divisionKey = parseInt(values[0]);
  const divisionName = divisionsMap.get(divisionKey);
  const teams = await getTeamsByDivision(divisionKey) || [];

  if (!teams.length) {
    await interaction.update({
      content: "No teams found for the selected division.",
      components: [],
    });
    userState.delete(user.id);
    return;
  }

  const team1Dropdown = new StringSelectMenuBuilder()
    .setCustomId("team1_select")
    .setPlaceholder("Select Team 1")
    .addOptions(teams.map((team) => ({ label: team.name, value: team.name })));

  const team2Dropdown = new StringSelectMenuBuilder()
    .setCustomId("team2_select")
    .setPlaceholder("Select Team 2")
    .addOptions(teams.map((team) => ({ label: team.name, value: team.name })));

  const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(team1Dropdown);
  const row2 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(team2Dropdown);

  userState.set(user.id, { divisionName, teams, team1: null, team2: null });

  const response = await interaction.update({
    content: `You selected the **${divisionName}** division. Now select your teams:`,
    components: [row1, row2],
  });
  setTimeout(() => {
    userState.delete(user.id);
    console.log(`User state for ${user.id} cleared due to inactivity.`);
  }, 5 * 60 * 1000); 
  const collector = message.createMessageComponentCollector(
    {
      componentType: ComponentType.StringSelect,
      filter: (i) => i.user === interaction.user && ["team1_select", "team2_select"].includes(i.customId),
      time: 5 * 60 * 1000,
    }
  );

  collector.on('collect', async (interaction) =>{
    handleTeamSelect(interaction);
  } );
}

async function handleTeamSelect(interaction: any) {
  const { customId, values, user } = interaction;
  let divisionsMap = DatabaseUtil.Instance.divisionsMap;

  const selectedTeam = values[0];
  const isTeam1 = customId === "team1_select";

  const state = userState.get(user.id);
  if (!state) {
    await interaction.update({
      content: "Error: Unable to retrieve state. Please restart the interaction.",
      components: [],
    });
    return;
  }

  if (isTeam1) {
    state.team1 = selectedTeam;
  } else {
    state.team2 = selectedTeam;
  }

  const team1Dropdown = new StringSelectMenuBuilder()
    .setCustomId("team1_select")
    .setPlaceholder("Select Team 1")
    .addOptions(
      state.teams.map((team: { name: any; }) => ({
        label: team.name,
        value: team.name,
        default: state.team1 === team.name
      }))
    );

  const team2Dropdown = new StringSelectMenuBuilder()
    .setCustomId("team2_select")
    .setPlaceholder("Select Team 2")
    .addOptions(
      state.teams.map((team: { name: any; }) => ({
        label: team.name,
        value: team.name,
        default: state.team2 === team.name
      }))
    );

  const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(team1Dropdown);
  const row2 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(team2Dropdown);

  if (!(state.team1 && state.team2)) {
    const content = `You selected **${state.team1 || "Team 1 not selected"}** for Team 1 and **${state.team2 || "Team 2 not selected"}** for Team 2.`;
    await interaction.update({
      content,
      components: [row1, row2],
    });
    return;
  }

  try {
    const tournamentCode = await getTournamentCode(state.team1, state.team2, interaction, divisionsMap);
    const response = tournamentCode.error.length > 0 ? tournamentCode.error : tournamentCode.discordResponse;

    if (tournamentCode.error.length > 0) {
      // Handle error: Update original interaction
      await interaction.update({
        content: response,
        components: [],
      });
    } else {
      // Handle success: Update and follow up
      await interaction.update({
        content: "Your teams have been selected. Generating tournament code...",
        components: [],
      });
      await interaction.followUp({
        content: response,
        ephemeral: false,
      });
    }

    userState.delete(user.id);
  } catch (error) {
    console.error(error);
    await interaction.update({
      content: "An error occurred while generating the tournament code. Please try again later.",
      components: [],
    });
    userState.delete(user.id);
  }
}

async function getTournamentCode(team1: String, team2: String, interaction: StringSelectMenuInteraction<CacheType>, divisionsMap: Map<any, any>) {
  let error = "";
  let tournamentCode1 = "";
  let game_number = 1;
  let division = 0;
  let team1Name = "";
  let team2Name = "";

  let team1Data = await grabTeamInfo(team1);
  let team2Data = await grabTeamInfo(team2);

  team1Name = team1.toString();
  team2Name = team2.toString();
  if (!team1Data || !team2Data) {
    error = `Are you sure ${!team1Data ? team1 : team2} is a real team?`;
    return {
      tournamentCode1,
      game_number,
      error,
      division,
      team1Name,
      team2Name,
    };
  }
  if (team1Data.id === team2Data.id) {
    error =
      "This is not One For All. No picking the same champs/teams";
    return {
      tournamentCode1,
      game_number,
      error,
      division,
      team1Name,
      team2Name,
    };
  }

  const seriesCheck = await checkSeries(team1Data, team2Data);
  if (!seriesCheck) {
    error = "There is no series for those two teams.";
    return {
      tournamentCode1,
      game_number,
      error,
      division,
      team1Name,
      team2Name,
    };
  }

  division = team1Data.divisionId;
  const series_id = seriesCheck.seriesId;
  const gameResult = await db
    .select({ gameNum: games.gameNum })
    .from(games)
    .where(eq(games.seriesId, series_id))
    .orderBy(desc(games.gameNum));

  if (gameResult && gameResult[0]) {
    game_number = gameResult[0].gameNum + 1;
  }
  if (game_number > 10) {
    error =
      "We do not allow more than 10 codes for a single series. Please open an URGENT admin ticket if you are having issues with your tournament codes.";
    return {
      tournamentCode1,
      game_number,
      error,
      division,
      team1Name,
      team2Name,
    };
  }

  const response = await db
    .select({
      tournamentId: divisions.tournamentId,
    })
    .from(divisions)
    .where(eq(divisions.id, team1Data.divisionId));

  const tournament_code = response[0]?.tournamentId;
  if (!tournament_code) {
    error = "Tournament code not found for the given division.";
    return {
      tournamentCode1,
      game_number,
      error,
      division,
      team1Name,
      team2Name,
    };
  }

  let riotResponse;
  try {
    let meta = JSON.stringify({ gameNum: game_number, seriesId: series_id });
    riotResponse = await config.rAPI.tournamentV5.createCodes({
      params: {
        count: 1,
        tournamentId: tournament_code,
      },
      body: {
        teamSize: 5,
        pickType: RiotAPITypes.TournamentV5.PICKTYPE.TOURNAMENT_DRAFT,
        mapType: RiotAPITypes.TournamentV5.MAPTYPE.SUMMONERS_RIFT,
        spectatorType: RiotAPITypes.TournamentV5.SPECTATORTYPE.ALL,
        enoughPlayers: false,
        metadata: meta,
      },
    });
    tournamentCode1 = riotResponse[0];
  } catch (e: any) {
    error = "Something went wrong on Riot's end. Please make an URGENT admin ticket.";
    return {
      tournamentCode1,
      game_number,
      error,
      division,
      team1Name,
      team2Name,
    };
  }
  try {
    await db.transaction(async (tx) => {
      await tx.insert(games).values({
        shortcode: tournamentCode1,
        seriesId: series_id,
        gameNum: game_number,
      });
    });
  } catch (e: any) {
    error =
      "Something went wrong with saving the code: " +
      tournamentCode1 +
      " . Please make an URGENT admin ticket.";
    return {
      tournamentCode1,
      game_number,
      error,
      division,
      team1Name,
      team2Name,
    };
  }
  // tournamentCode1 = "5";
  
  let division_name = divisionsMap.get(division);
  let discordResponse =
    "## " +
    division_name +
    "\n" +
    "**__" +
    team1Name +
    "__** vs **__" +
    team2Name +
    "__**\n" +
    "Game " +
    game_number! +
    " Code: `" +
    tournamentCode1 +
    "`";
  if (game_number! > 5)
    discordResponse = discordResponse.concat(
      "\nYou have generated more codes than required for this series. If you are experiencing issues, please open an URGENT admin ticket. ", //<@247886805821685761>",
    );
  return {
    discordResponse,
    game_number,
    error,
    division,
    team1Name,
    team2Name,
  }
}
