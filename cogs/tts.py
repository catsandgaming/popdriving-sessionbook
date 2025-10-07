import discord
from discord.ext import commands
from gtts import gTTS
import os

class TTS(commands.Cog):
    """
    A Cog to handle Text-to-Speech commands in a Discord voice channel.
    """
    def __init__(self, bot):
        self.bot = bot
        # Define the temporary path for saving the generated audio file
        self.AUDIO_FILE = "tts_output.mp3"

    @commands.command(name='tts', help='Joins your voice channel and says the given text.')
    async def tts_command(self, ctx, *, text: str):
        """
        Generates TTS audio, joins the user's voice channel, plays the audio,
        and then disconnects, cleaning up the audio file afterwards.
        """
        # 1. Check if the user is in a voice channel
        if not ctx.author.voice:
            return await ctx.send("You need to be in a voice channel to use this command!")

        # 2. Join the voice channel
        channel = ctx.author.voice.channel
        
        # Disconnect if the bot is already in a channel in this guild
        if ctx.voice_client:
            await ctx.voice_client.disconnect()

        voice_client = await channel.connect()

        try:
            # 3. Generate TTS audio
            await ctx.send(f"Generating audio for: `{text}`")
            
            # The tld='com' ensures a standard Google voice is used
            tts = gTTS(text=text, lang='en', tld='com') 
            tts.save(self.AUDIO_FILE)

            # 4. Play the audio
            # FFmpeg is required here to stream the audio file
            source = discord.PCMVolumeTransformer(discord.FFmpegPCMAudio(self.AUDIO_FILE))
            voice_client.play(source, after=lambda e: print(f'Player error: {e}') if e else None)

            # Wait until the audio is done playing
            while voice_client.is_playing():
                await discord.utils.sleep_until(voice_client.is_playing() == False)
                
        except Exception as e:
            print(f"An error occurred: {e}")
            await ctx.send("An error occurred during TTS or playback. Check console for details (make sure FFmpeg is installed and in PATH).")
        
        finally:
            # 5. Cleanup and disconnect
            if voice_client and voice_client.is_connected():
                await voice_client.disconnect()
            
            if os.path.exists(self.AUDIO_FILE):
                os.remove(self.AUDIO_FILE)
            
            print(f"Cleanup complete for command: {text}")


# Setup function required for the main bot file to load the cog
async def setup(bot):
    await bot.add_cog(TTS(bot))
