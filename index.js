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
    ChannelType, // Needed for specifying text channel type in command
    MessageFlags // Used for ephemeral replacement
} = require('discord.js');

// --- Configuration Constants from .env ---
const TOKEN = process.env.BOT_TOKEN;
const HOST_ID = process.env.SESSION_HOST_ID; 
const JUNIOR_STAFF_IDS = process.env.JUNIOR_STAFF_IDS ? process.env.JUNIOR_STAFF_IDS.split(',') : []; 
const TRAINEE_ID = process.env.TRAINEE_ID;
const SESSIONS_FILE = 'sessions.json'; // Persistent storage for ongoing sessions

// --- Client Setup ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers 
    ]
});

// --- Utility Functions ---

/**
 * Creates a unique session ID based on the channel ID and the current timestamp.
 * @param {string} channelId 
 * @returns {string}
 */
function generateSessionId(channelId) {
    return `${channelId}-${Date.now()}`;
}

/**
 * Loads the current active sessions from the JSON file.
 * @returns {Object} An object mapping session IDs to session data.
 */
function loadSessions() {
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
            return JSON.parse(data);
        }
        return {};
    } catch (error) {
        console.error('Error loading sessions:', error);
        return {};
    }
}

/**
 * Saves the current active sessions to the JSON file.
 * @param {Object} sessions 
 */
function saveSessions(sessions) {
    try {
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
    } catch (error) {
        console.error('Error saving sessions:', error);
    }
}

/**
 * Creates the Discord embed for a session.
 * @param {Object} session The session data.
 * @param {string} hostTag The Discord tag of the host.
 * @returns {EmbedBuilder}
 */
function createSessionEmbed(session, hostTag) {
    const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle(`Driving Session: ${session.title}`)
        .setDescription(`Hosted by: **${hostTag}**\nTime: **${session.time}**\n\nClick the buttons below to sign up!`)
        .addFields(
            { 
                name: 'DRIVERS', 
                value: session.drivers.length > 0 ? session.drivers.map(u => `<@${u.id}>`).join('\n') : 'No drivers signed up yet.', 
                inline: true 
            },
            { 
                name: 'JUNIOR STAFF', 
                value: session.juniorstaff.length > 0 ? session.juniorstaff.map(u => `<@${u.id}>`).join('\n') : 'No junior staff signed up yet.', 
                inline: true 
            },
            { 
                name: 'TRAINEES', 
                value: session.trainees.length > 0 ? session.trainees.map(u => `<@${u.id}>`).join('\n') : 'No trainees signed up yet.', 
                inline: true 
            }
        )
        .setTimestamp()
        .setFooter({ text: `Session ID: ${session.id}` });

    return embed;
}

/**
 * Creates the action row with sign-up buttons.
 * @param {string} sessionId The ID of the session.
 * @returns {ActionRowBuilder}
 */
function createSessionButtons(sessionId) {
    const driverButton = new ButtonBuilder()
        .setCustomId(`SIGNUP_${sessionId}_driver`)
        .setLabel('Sign up as Driver')
        .setStyle(ButtonStyle.Primary);

    const juniorStaffButton = new ButtonBuilder()
        .setCustomId(`SIGNUP_${sessionId}_juniorstaff`)
        .setLabel('Sign up as Junior Staff')
        .setStyle(ButtonStyle.Secondary);

    const traineeButton = new ButtonBuilder()
        .setCustomId(`SIGNUP_${sessionId}_trainee`)
        .setLabel('Sign up as Trainee')
        .setStyle(ButtonStyle.Success);
        
    const closeButton = new ButtonBuilder()
        .setCustomId(`CLOSE_${sessionId}_close`) // Action_SessionId_Role (Role is generic for close)
        .setLabel('Close Session')
        .setStyle(ButtonStyle.Danger);

    return new ActionRowBuilder().addComponents(driverButton, juniorStaffButton, traineeButton, closeButton);
}

// --- Button Interaction Handler ---

/**
 * Handles interactions from the sign-up and close buttons.
 * @param {import('discord.js').ButtonInteraction} interaction 
 */
async function handleButtonInteraction(interaction) {
    if (!interaction.isButton()) return;

    // Acknowledge the interaction immediately to prevent timeout errors (DiscordAPIError[10062])
    // The final confirmation to the user will be an ephemeral reply via editReply.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(e => {
        // Log a warning if deferral fails, but continue if possible.
        if (e.code === 10062) return; // Ignore "Unknown interaction" error on deferral
        console.warn(`Button Deferal failed for ${interaction.customId}. Interaction might be stale.`, e);
    });

    const [action, sessionId, roleToSignFor] = interaction.customId.split('_');
    const member = interaction.member;
    const currentSessions = loadSessions();
    let currentSession = currentSessions[sessionId];

    if (!currentSession) {
        return interaction.editReply({ content: '❌ This session is no longer active or the ID is invalid.' });
    }

    // Function to check if a user has a required role (using the environment variables)
    const hasRequiredRole = (role) => {
        switch(role) {
            case 'driver':
                return true; 
            case 'juniorstaff':
                // Check if the member has the HOST_ID role OR any of the JUNIOR_STAFF_IDS
                return member.roles.cache.has(HOST_ID) || JUNIOR_STAFF_IDS.some(id => member.roles.cache.has(id));
            case 'trainee':
                return member.roles.cache.has(TRAINEE_ID);
            default:
                return false;
        }
    };

    if (action === 'CLOSE') {
        if (member.id !== currentSession.hostId && !member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.editReply({ content: '❌ Only the host or an Administrator can close this session.' });
        }
        
        // Remove session from data store
        delete currentSessions[sessionId];
        saveSessions(currentSessions);

        // Edit the original message to reflect closure and disable buttons
        const closeEmbed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle(`Session Closed: ${currentSession.title}`)
            .setDescription(`The session hosted by <@${currentSession.hostId}> has been closed.`)
            .setTimestamp();

        try {
            // Find the original message and update it
            await interaction.message.edit({ 
                embeds: [closeEmbed], 
                components: [] // Remove all buttons
            });

            return interaction.editReply({ content: '✅ Session successfully closed.' });

        } catch (error) {
            console.error('Error closing session:', error);
            return interaction.editReply({ content: '❌ Failed to close and update the message. Check bot permissions.' });
        }
    }

    if (action === 'SIGNUP') {
        const rosterCategory = roleToSignFor === 'juniorstaff' ? 'juniorstaff' : roleToSignFor + 's'; // e.g., 'driver' -> 'drivers'

        // --- 1. Role Check (Basic Check for Non-Drivers) ---
        if (roleToSignFor !== 'driver' && !hasRequiredRole(roleToSignFor)) {
             return interaction.editReply({ content: `❌ You do not have the required role to sign up as a **${roleToSignFor.toUpperCase()}**.` });
        }

        // Check if user is already signed up in any category
        const isAlreadySignedUp = Object.keys(currentSession).some(key => 
            Array.isArray(currentSession[key]) && currentSession[key].some(u => u.id === member.id)
        );

        if (isAlreadySignedUp) {
            return interaction.editReply({ content: '⚠️ You are already signed up for this session in another role. To change, please ask the host to remove you first.' });
        }

        // --- 2. Add to Roster ---
        if (!currentSession[rosterCategory] || !Array.isArray(currentSession[rosterCategory])) {
            console.warn(`Roster category '${rosterCategory}' missing or invalid in session ${sessionId}. Initializing as empty array.`);
            currentSession[rosterCategory] = []; 
        }
        
        currentSession[rosterCategory].push({ id: member.id, tag: member.user.tag });

        // Update the data store
        currentSessions[sessionId] = currentSession;
        saveSessions(currentSessions);

        // --- 3. Update the Message Embed ---\r\n
        const hostTag = await client.users.fetch(currentSession.hostId).then(user => user.tag).catch(() => 'Unknown Host');
        const updatedEmbed = createSessionEmbed(currentSession, hostTag);

        try {
            // Edit the original message (from interaction.message) with the updated embed
            // This is the message the user clicked the button on
            await interaction.message.edit({ embeds: [updatedEmbed], components: interaction.message.components });

            // Final confirmation to the user who clicked the button via editReply
            return interaction.editReply({ content: `✅ You have successfully signed up as a **${roleToSignFor.toUpperCase()}**!` });

        } catch (error) {
            console.error('Error signing up and updating message:', error);
            // If the original message edit fails, the user still gets confirmation via editReply.
            return interaction.editReply({ content: '❌ Failed to update the session roster. Please try again.' });
        }
    }
}


// --- Main Interaction Handler ---
client.on('interactionCreate', async interaction => {
    
    if (interaction.isChatInputCommand()) {
        const { commandName, options } = interaction;
        
        if (commandName === 'sessionbook') {
            
            // CRITICAL FIX for DiscordAPIError[10062]: Unknown interaction
            // Deferral is the first network call to Discord, preventing the 3-second timeout.
            try {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral }); 
            } catch (e) {
                // If deferral fails (e.g., interaction already timed out), prevent the process crash.
                if (e.code === 10062) {
                    console.error('CRITICAL: Slash command deferral failed (Timeout/Unknown Interaction).');
                    return; // Stop processing this interaction
                }
                console.error('Error deferring command reply:', e);
                return;
            }

            // --- 1. Permission Check ---
            // Only allow users with the Host ID or Administrator permission to run the command
            const member = interaction.member;
            if (member.id !== HOST_ID && !member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.editReply({ content: '❌ You do not have permission to book a session.' });
            }

            // --- 2. Gather Command Options ---
            const title = options.getString('title');
            const time = options.getString('time');
            // The channel is the channel the command was run in by default.
            const channelId = interaction.channelId; 
            const hostId = member.id;
            
            // --- 3. Create Session Data ---
            const sessionId = generateSessionId(channelId);
            const newSession = {
                id: sessionId,
                title: title,
                time: time,
                channelId: channelId,
                hostId: hostId,
                drivers: [],
                juniorstaff: [],
                trainees: [],
                messageId: null // To be filled after the message is sent
            };

            // --- 4. Send Message and Get Message ID ---
            const hostTag = member.user.tag;
            const embed = createSessionEmbed(newSession, hostTag);
            const components = createSessionButtons(sessionId);

            try {
                // Send the actual session post to the channel
                const message = await interaction.channel.send({
                    embeds: [embed],
                    components: [components]
                });

                // Update the session object with the message ID
                newSession.messageId = message.id;

                // --- 5. Save Session ---
                const currentSessions = loadSessions();
                currentSessions[sessionId] = newSession;
                saveSessions(currentSessions);
                
                // --- 6. Final Command Confirmation ---
                return interaction.editReply({ 
                    content: `✅ Session **${title}** successfully booked. See the post in <#${channelId}>.`, 
                });

            } catch (error) {
                console.error('Error sending session message or saving data:', error);
                // If the message send fails, try to edit the deferral reply with the error.
                return interaction.editReply({ content: '❌ An error occurred while posting the session. Please check bot permissions and try again.' });
            }
        }
    } else if (interaction.isButton()) {
        // Handle button interactions
        await handleButtonInteraction(interaction);
    }
});


// --- Slash Command Definition and Registration ---

// Renamed from 'ready' to 'clientReady' to address the deprecation warning
client.on('clientReady', async () => { 
    console.log(`Bot is logged in as ${client.user.tag}!`);

    // Define the slash command
    const sessionBookCommand = new SlashCommandBuilder()
        .setName('sessionbook')
        .setDescription('Books a new driving session and posts it to the current channel.')
        .addStringOption(option =>
            option.setName('title')
                .setDescription('The title/location of the session (e.g., Highway Practice, City Driving)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('time')
                .setDescription('The time and date of the session (e.g., 20:00 UTC, Today 3 PM PST)')
                .setRequired(true));

    // Register the command
    try {
        await client.application.commands.set([sessionBookCommand]);
        console.log('Slash command /sessionbook registered successfully.');
    } catch (error) {
        console.error('Failed to register slash commands:', error);
    }
});


// --- Web Server for Render Health Check ---
// Render requires a running web server on the specified port.
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running\n');
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
    console.log(`Web server listening on port ${port}`);
});


// Log the bot in
client.login(TOKEN);
