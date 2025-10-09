@@ -1,21 +1,21 @@
// --- PHASE 3: BOT SETUP AND COMMANDS (index.js) ---

// Load environment variables (like the BOT_TOKEN and Role IDs) from the .env file
require('dotenv').config();
const fs = require('fs');
// Include the standard HTTP module needed for the Render web server
const http = require('http'); 
const { 
    Client, 
    GatewayIntentBits, 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    PermissionsBitField, 
    MessageFlags, // Used for ephemeral replacement
    Collection 
} = require('discord.js');

// --- Configuration Constants from .env ---
@@ -348,6 +348,16 @@
            // --- 2. Gather Command Options (Only Time and Duration) ---
            const time = options.getString('time');
            const duration = options.getString('duration');
            
            // --- DEFENSIVE CHECK AGAINST STALE COMMANDS ---
            if (!time || !duration) {
                console.error('Command failed to retrieve options. Time or Duration is missing.', { time, duration });
                return interaction.editReply({ 
                    content: '❌ Command Error: The system failed to read the **Time** or **Duration** fields. Please ensure you are using the command that shows **Time** and **Duration** as required inputs. You might need to refresh Discord (Ctrl+R/Cmd+R).', 
                    ephemeral: true 
                });
            }
            
            const channelId = interaction.channelId; 
            const hostId = member.id;

@@ -392,21 +402,6 @@
                console.error('Error sending session message or saving data:', error);
                return interaction.editReply({ content: '❌ An error occurred while posting the session. Please check bot permissions and try again.' });
            
        }
    } else if (interaction.isButton()) {
        await handleButtonInteraction(interaction);
@@ -432,22 +427,16 @@
                .setDescription('The expected length of the session (e.g., 1 hour, 30 minutes)')
                .setRequired(true));



    // Array of commands we want to exist
    const commandsToRegister = [sessionBookCommand]; // Only the correct command

    try {
        console.log('Attempting to aggressively clean up and register global commands...');

        // This command set operation clears ALL existing global commands and replaces them.
        await client.application.commands.set(commandsToRegister);

        console.log('Global command /sessionbook registered successfully. Please hard refresh Discord (Ctrl+R/Cmd+R).');

        // Log the final state of commands for console verification
        const finalCommands = await client.application.commands.fetch();

























































































































































































































































































































































































