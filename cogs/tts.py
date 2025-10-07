import discord
from discord.ext import commands
from discord import app_commands

class TTSTest(commands.Cog):
    """Temporary Cog to check if the file can be loaded."""
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @app_commands.command(name="check_tts", description="Temporary command to confirm TTS cog is loading.")
    async def check_tts(self, interaction: discord.Interaction):
        await interaction.response.send_message("TTS Cog Loaded Successfully!", ephemeral=True)

async def setup(bot: commands.Bot):
    """Adds the cog to the bot."""
    await bot.add_cog(TTSTest(bot))