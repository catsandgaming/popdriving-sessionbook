import discord
from discord.ext import commands
from dotenv import load_dotenv
import os
import asyncio
import threading
from flask import Flask

# --- Configuration ---
# Load environment variables from .env file
load_dotenv()
TOKEN = os.getenv('TOKEN')
# Render provides the port via the PORT environment variable
PORT = int(os.environ.get('PORT', 8080))

# --- Discord Bot Setup ---
# Define bot intents (permissions)
# Needed for commands, voice states, and server interactions
intents = discord.Intents.default()
intents.message_content = True
intents.voice_states = True
intents.guilds = True

# Initialize the bot
bot = commands.Bot(command_prefix='!', intents=intents)

async def load_cogs():
    """Dynamically loads all Python files (cogs) in the cogs directory."""
    print("Starting cog loading...")
    for filename in os.listdir('./cogs'):
        if filename.endswith('.py') and filename != '__init__.py':
            try:
                # Load the cog, removing the '.py' extension
                await bot.load_extension(f'cogs.{filename[:-3]}')
                print(f"✅ Successfully loaded cog: {filename[:-3]}")
            except Exception as e:
                print(f"❌ Failed to load cog {filename[:-3]}: {e}")

@bot.event
async def on_ready():
    """Event triggered when the bot is connected and ready."""
    print(f'\n--- Logged in as {bot.user} (ID: {bot.user.id}) ---')
    
    # 1. Load Cogs
    await load_cogs()
    
    # 2. Sync Slash Commands (CRITICAL for commands to appear in Discord)
    try:
        synced = await bot.tree.sync()
        print(f"🚀 Synced {len(synced)} slash commands.")
    except Exception as e:
        print(f"⚠️ Failed to sync slash commands: {e}")

    print('-------------------------------------------')
    print('Bot is fully operational!')
    print('-------------------------------------------')


# --- Web Server for Uptime Monitoring (Render/Heroku/etc.) ---
app = Flask(__name__)

@app.route('/')
def home():
    """A simple endpoint for the uptime monitor to ping."""
    return "Discord Bot is running!", 200

def run_server():
    """Starts the Flask web server in a non-blocking way."""
    print(f"Web server thread started, listening on port {PORT}")
    # Setting host='0.0.0.0' is required for Render/Docker environments
    app.run(host='0.0.0.0', port=PORT)

# --- Main Entry Point ---
if __name__ == '__main__':
    if not TOKEN:
        print("🔴 ERROR: TOKEN not found. Please check your .env file.")
    else:
        # Start the Flask web server in a separate thread
        server_thread = threading.Thread(target=run_server)
        server_thread.start()
        
        # Start the Discord Bot (runs in the main thread)
        bot.run(TOKEN)