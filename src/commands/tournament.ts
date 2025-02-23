import {
  ActionRowBuilder,
  CacheType,
  ComponentType,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from "discord.js";
import { db } from "../db/db";
import { divisions, games, series, teams, teamToSeries } from "../db/schema";
import { and, sql, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { config } from "../config";
import { RiotAPITypes } from "@fightmegg/riot-api/dist/esm/@types";
import { DatabaseUtil } from "../util";

module.exports = {
  data: new SlashCommandBuilder()
    .setName("generate-tournament-code")
    .setDescription("Generate Tournament Code"),
  async execute(interaction) {
    let divisionsMap = DatabaseUtil.Instance.divisionsMap;

    if (divisionsMap.size == 0) {
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
    const divisionRow =
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        divisionDropdown
      );

    const response = await interaction.reply({
      content: "Please select a division:",
      components: [divisionRow],
      flags: "Ephemeral",
      withResponse: true,
    });
    // Since we're not making any NEW messages we'll have to pass this fella around to keep listening to him
    // As we traverse through each menu.
    const message = response.resource!.message;
    const collector =
      response.resource!.message!.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        filter: (i) =>
          i.user === interaction.user && i.customId == "division_select",
        time: 5 * 60 * 1000,
      });

    collector.on("collect", async (interaction) => {
      handleDivisionSelect(interaction, message);
    });
    return;
  },
};

async function grabTeamInfo(name: String) {
  let data = await db
    .select({ id: teams.id, divisionId: teams.divisionId })
    .from(teams)
    .where(sql`lower(${teams.name}) = lower(${name})`);
  return data[0];
}
const userState = new Map();

async function getTeamsByDivision(division: number) {
  let data = await db
    .select()
    .from(teams)
    .where(eq(teams.divisionId, division));
  return data;
}

async function checkSeries(team1Data: any, team2Data: any) {
  const st1 = alias(teamToSeries, "st1");
  const st2 = alias(teamToSeries, "st2");
  try {
    let response = await db
      .select({ seriesId: series.id }) // Specify the column(s) to retrieve
      .from(series)
      .innerJoin(
        st1, // First join for team1
        eq(st1.seriesId, series.id) // Match team1
      )
      .innerJoin(
        st2, // Second join for team2 with alias "st2"
        eq(st2.seriesId, series.id) // Match team2 using alias
      )
      .where(and(eq(st1.teamId, team1Data.id), eq(st2.teamId, team2Data.id))) // Ensure both teams are in the same series
      .limit(1); // Optionally limit to one result if needed

    return response[0];
  } catch (e) {
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
  const teams = (await getTeamsByDivision(divisionKey)) || [];

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

  const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    team1Dropdown
  );
  const row2 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    team2Dropdown
  );

  userState.set(user.id, { divisionName, teams, team1: null, team2: null });

  const response = await interaction.update({
    content: `You selected the **${divisionName}** division. Now select your teams:`,
    components: [row1, row2],
  });
  setTimeout(
    () => {
      userState.delete(user.id);
      console.log(`User state for ${user.id} cleared due to inactivity.`);
    },
    5 * 60 * 1000
  );
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    filter: (i) =>
      i.user === interaction.user &&
      ["team1_select", "team2_select"].includes(i.customId),
    time: 5 * 60 * 1000,
  });

  collector.on("collect", async (interaction) => {
    handleTeamSelect(interaction);
  });
}

async function handleTeamSelect(interaction: any) {
  const { customId, values, user } = interaction;
  let divisionsMap = DatabaseUtil.Instance.divisionsMap;

  const selectedTeam = values[0];
  const isTeam1 = customId === "team1_select";

  const state = userState.get(user.id);
  if (!state) {
    await interaction.update({
      content:
        "Error: Unable to retrieve state. Please restart the interaction.",
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
      state.teams.map((team: { name: any }) => ({
        label: team.name,
        value: team.name,
        default: state.team1 === team.name,
      }))
    );

  const team2Dropdown = new StringSelectMenuBuilder()
    .setCustomId("team2_select")
    .setPlaceholder("Select Team 2")
    .addOptions(
      state.teams.map((team: { name: any }) => ({
        label: team.name,
        value: team.name,
        default: state.team2 === team.name,
      }))
    );

  const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    team1Dropdown
  );
  const row2 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    team2Dropdown
  );

  if (!(state.team1 && state.team2)) {
    const content = `You selected **${state.team1 || "Team 1 not selected"}** for Team 1 and **${state.team2 || "Team 2 not selected"}** for Team 2.`;
    await interaction.update({
      content,
      components: [row1, row2],
    });
    return;
  }

  try {
    const tournamentCode = await getTournamentCode(
      state.team1,
      state.team2,
      interaction,
      divisionsMap
    );
    if (tournamentCode.error != null) {
      // Handle error: Update original interaction
      await interaction.update({
        content: tournamentCode.error,
        components: [],
      });
    } else {
      await interaction.update({
        content: "Your teams have been selected. Generating tournament code...",
        components: [],
      });
      await interaction.followUp({
        content: tournamentCode.discordResponse?.toString(),
        ephemeral: false,
      });
    }
  } catch (error) {
    console.error(error);
    await interaction.update({
      content:
        "An error occurred while generating the tournament code. Please try again later.",
      components: [],
    });
  } finally {
    userState.delete(user.id);
  }
}

async function getTournamentCode(
  team1: string,
  team2: string,
  interaction: StringSelectMenuInteraction<CacheType>,
  divisionsMap: Map<any, any>
): Promise<{
  discordResponse: string | null;
  shortcode: string | null;
  gameNumber: number;
  error: string | null;
  divisionId: number | null;
  team1: string;
  team2: string;
}> {
  let gameNumber = 1;
  let team1Data = await grabTeamInfo(team1);
  let team2Data = await grabTeamInfo(team2);

  if (!team1Data || !team2Data) {
    return {
      shortcode: null,
      gameNumber,
      error: `Are you sure ${!team1Data ? team1 : team2} is a real team?`,
      divisionId: null,
      team1,
      team2,
    };
  }
  if (team1Data.id === team2Data.id) {
    return {
      shortcode: null,
      gameNumber,
      error: "This is not One For All. No picking the same champs/teams",
      divisionId: team1Data.divisionId,
      team1,
      team2,
    };
  }

  const seriesCheck = await checkSeries(team1Data, team2Data);
  if (!seriesCheck) {
    return {
      shortcode: null,
      gameNumber,
      error: "There is no series for those two teams.",
      divisionId: team1Data.divisionId,
      team1,
      team2,
    };
  }

  const seriesId = seriesCheck.seriesId;
  const gameResult = await db
    .select({ gameNum: games.gameNum })
    .from(games)
    .where(eq(games.seriesId, seriesId))
    .orderBy(desc(games.gameNum));

  if (gameResult && gameResult[0]) {
    gameNumber = gameResult[0].gameNum + 1;
  }
  if (gameNumber > 10) {
    return {
      shortcode: null,
      gameNumber,
      error:
        "We do not allow more than 10 codes for a single series. Please open an URGENT admin ticket if you are having issues with your tournament codes.",
      divisionId: team1Data.divisionId,
      team1,
      team2,
    };
  }

  const response = await db
    .select({
      tournamentId: divisions.tournamentId,
    })
    .from(divisions)
    .where(eq(divisions.id, team1Data.divisionId ?? 0));

  const tid = response[0]?.tournamentId;
  if (!tid) {
    return {
      shortcode: null,
      gameNumber,
      error: "Tournament code not found for the given division.",
      divisionId: team1Data.divisionId,
      team1,
      team2,
    };
  }

  let shortcode;
  try {
    let meta = JSON.stringify({ gameNum: gameNumber, seriesId: seriesId });
    const riotResponse = await config.rAPI.tournamentV5.createCodes({
      params: {
        count: 1,
        tournamentId: tid,
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
    shortcode = riotResponse[0];
  } catch (e: any) {
    return {
      shortcode: null,
      gameNumber,
      error:
        "Something went wrong on Riot's end. Please make an URGENT admin ticket.",
      divisionId: team1Data.divisionId,
      team1,
      team2,
    };
  }
  // shortcode = "NA003";
  try {
    await db.transaction(async (tx) => {
      const res = await tx
        .insert(games)
        .values({
          shortcode,
          seriesId,
          gameNum: gameNumber,
        })
        .returning({ gameId: games.id });
      if (!res) {
        console.log(`Game insert failed:\n 
          Series ID: '${seriesId}'\n
          TCode: '${shortcode}'\n
          Game Num: '${gameNumber}'\n`);
      } else {
        console.log(`Inserted '${res[0].gameId}' for series '${seriesId}'.`);
      }
    });
  } catch (e: any) {
    console.log(e);
    return {
      shortcode,
      gameNumber,
      error:
        "Something went wrong with saving the code: " +
        shortcode +
        " . Please make an URGENT admin ticket.",
      divisionId: team1Data.divisionId,
      team1,
      team2,
    };
  }

  let division_name = divisionsMap.get(team1Data.divisionId);
  const member = await interaction.guild!.members.fetch(interaction.user.id);
  const nickname = member.nickname || member.user.displayName;

  let discordResponse =
    `## ${division_name}\n` +
    `**__${team1}__** vs **__${team2}__**\n` +
    `Game ${gameNumber} Code: \`\`\`${shortcode}\`\`\`\n` +
    `Generated By: \`${nickname}\``;
  if (gameNumber! > 5)
    discordResponse = discordResponse.concat(
      "\nYou have generated more codes than required for this series. If you are experiencing issues, please open an URGENT admin ticket. " //<@247886805821685761>",
    );
  return {
    discordResponse,
    shortcode,
    gameNumber,
    error: null,
    divisionId: team1Data.divisionId,
    team1,
    team2,
  };
}
