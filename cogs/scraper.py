import discord
from discord import app_commands
from discord.ext import commands
from src.models.user import User
import logging


class Scraper(commands.Cog):
    def __init__(self, bot):
        logging.info("Loading scraper cog")
        self.bot = bot

    async def read_members(self):
        users = []
        guild = self.bot.get_guild(self.bot.guild_id)
        role = self.bot.get_role("816783440803921961")
        members = role.members
        for member in members:
            print(member)
            users.append(User(member.id, member.name, member.display_name))
        print(users)

    @app_commands.command(name="sync-users", description="Used to sync users!")
    @app_commands.checks.has_role("Developer")
    async def sync_users(self, interaction: discord.Interaction):
        logging.info("Syncing users")
        await self.read_members
