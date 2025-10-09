const { REST, Routes, SlashCommandBuilder } = require('discord.js');
// Load environment variables from .env file
require('dotenv').config();

// Get the Discord token, client ID, and guild ID from environment variables
// IMPORTANT: You must set these three variables in your bot's environment (.env file or hosting provider).
const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

// Define the slash commands
const commands = [
    new SlashCommandBuilder()
        .setName('sessionbook')
        .setDescription('Creates a new driving session and opens sign-ups.')
        // CRITICAL: Adding the required options here tells Discord to prompt the user for them.
        .addStringOption(option =>
            option.setName('time')
                .setDescription('The time the session will start (e.g., 18:00 UTC)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('duration')
                .setDescription('The expected duration of the session (e.g., 2 hours)')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('host')
                .setDescription('Optional: Mention the host if different from yourself.')
                .setRequired(false))
];

// Initialize REST client
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

// Deployment function
(async () => {
    try {
        console.log(`Started refreshing ${commands.length} application (/) commands.`);

        // This method fully refreshes all commands in the guild with the current set.
        const data = await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: commands },
        );

        console.log(`Successfully reloaded ${data.length} application (/) commands.`);
    } catch (error) {
        // Catch and log any errors
        console.error('Error deploying slash commands:', error);
        console.error('Please ensure DISCORD_TOKEN, CLIENT_ID, and GUILD_ID are set correctly in your environment.');
    }
})();
