import logging

# from src.bot import Bot
from src.modals.code_generation_modal import CodeGenerationModal

import discord, discord.ext.commands as commands
from discord import app_commands


def check_allowed_command(interaction: discord.Interaction) -> bool:
    accepted_roles = ["Captain", "Admin", "Sub-Team-Lead", "Dev"]
    authorized = [(x.name in accepted_roles) for x in interaction.user.roles]
    if len(authorized) > 0:
        return interaction.channel_id == 1206744483304316949 or interaction.channel_id == 796166735795060777
    raise discord.app_commands.CheckFailure


class Tournament(commands.Cog):
    def __init__(self, bot_i):
        logging.info("Loading Tournament cog")
        self.bot = bot_i
        self.tournaments = []

    @app_commands.command(
        name="create-tournament",
        description="Used to create a new season of LBLCS! Only usable by Developers.",
    )
    @app_commands.checks.has_role("Developer")
    async def generate_tournament(self, interaction: discord.Interaction):
        await interaction.response.send_message("Hello, world!")

    @app_commands.command(name='generate-tournament-code', description="Used to generate a tournament code!")
    @app_commands.check(check_allowed_command)
    async def tcode(self, interaction: discord.Interaction):
        """Command used by captains to generate a tournament code!
        Pipeline:
        1. Enter league, participating teams, and game #
        2. Check if a series is ongoing. If not, create one +
           generate an id and code. If it is, fetch the id
           and generate a code
        """
        logging.info("Code generation invoked")
        await interaction.response.send_modal(CodeGenerationModal(self.bot))
