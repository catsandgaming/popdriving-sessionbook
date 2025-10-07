import discord
from discord.ext import commands
from dotenv import load_dotenv
import os
import asyncio

# Load environment variables from .env file
load_dotenv()
TOKEN = os.getenv('TOKEN')

# Define bot intents (permissions)
# We need 'message_content' to read the command text, 
# 'voice_states' to know which channel the user is in,
# and 'guilds' to interact with the server.
intents = discord.Intents.default()
intents.message_content = True
intents.voice_states = True
intents.guilds = True

# Initialize the bot with a command prefix
bot = commands.Bot(command_prefix='!', intents=intents)

async def load_cogs():
    """Dynamically loads all Python files (cogs) in the cogs directory."""
    for filename in os.listdir('./cogs'):
        if filename.endswith('.py'):
            try:
                # Load the cog, removing the '.py' extension
                await bot.load_extension(f'cogs.{filename[:-3]}')
                print(f"Successfully loaded cog: {filename[:-3]}")
            except Exception as e:
                print(f"Failed to load cog {filename[:-3]}: {e}")

@bot.event
async def on_ready():
    """Event triggered when the bot is connected and ready."""
    print(f'Logged in as {bot.user} (ID: {bot.user.id})')
    print('-------------------------------------------')
    # Load cogs only after the bot is ready
    await load_cogs()
    print('Bot is fully operational!')
    
# Main entry point to run the bot
if __name__ == '__main__':
    if not TOKEN:
        print("ERROR: TOKEN not found. Please check your .env file.")
    else:
        # Run the bot
        bot.run(TOKEN)
