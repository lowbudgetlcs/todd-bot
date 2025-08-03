import {
    ActionRowBuilder,
    CacheType,
    ComponentType,
    PermissionFlagsBits,
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
  // import { DatabaseUtil } from "../util";

  let divisionsMap = new Map();
      divisionsMap.set(1, "Division 1");
      divisionsMap.set(2, "Division 2");
  // TODO: SINCE THIS SHARES A LOT OF CODE WITH TOURNAMENT.CS SHOULD REFACTOR AND PUT COMMON CODE
  module.exports = {
    data: new SlashCommandBuilder()
      .setName("create-series")
      .setDescription("Create a series for a matchup")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    async execute(interaction) {
      // let divisionsMap = DatabaseUtil.Instance.divisionsMap;

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
  
  // TODO: we should NOT use any here if we know what it's going to be.
  // i don't know what it is going to be LMFAO
  async function handleDivisionSelect(interaction: any, message: any) {
    const { customId, values, user } = interaction;

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
        let team1Data = await grabTeamInfo(state.team1);
        let team2Data = await grabTeamInfo(state.team2);
        // imagine doing a db call xD
        // const newSeriesId = await db.insert(series).values({ divisionId: team1Data.divisionId }).returning({ insertedId: series.id });
        // await db.transaction(async (tx) => {
        //     await tx.insert(teamToSeries).values({teamId: team1Data.id, seriesId: newSeriesId[0].insertedId});
        //     await tx.insert(teamToSeries).values({teamId: team2Data.id, seriesId: newSeriesId[0].insertedId});
        // });
        await interaction.update({
            content: "Series has been made!",
            components: [],
        });
    } catch (error) {
      console.error(error);
      await interaction.update({
        content:
          "An error occurred while generating the series. Please contact dev team.",
        components: [],
      });
    } finally {
      userState.delete(user.id);
    }
  }
  
  