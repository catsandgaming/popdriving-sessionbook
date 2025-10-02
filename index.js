// --- PHASE 3: BOT SETUP AND COMMANDS (index.js) ---

// Load environment variables (like the BOT_TOKEN and Role IDs) from the .env file
require('dotenv').config();
const fs = require('fs');
// Include the standard HTTP module needed for the Replit web server
const http = require('http'); 
const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, PermissionsBitField, StringSelectMenuBuilder } = require('discord.js');

// --- Configuration Constants from .env ---
// NOTE: These variables are loaded directly from the Canvas content you finalized.
const TOKEN = process.env.BOT_TOKEN;
const HOST_ID = process.env.SESSION_HOST_ID; 
// JUNIOR_STAFF_IDS is read as a comma-separated string and split into an array.
const JUNIOR_STAFF_IDS = process.env.JUNIOR_STAFF_IDS ? process.env.JUNIOR_STAFF_IDS.split(',') : []; 
const TRAINEE_ID = process.env.TRAINEE_ID;
const SESSIONS_FILE = 'sessions.json'; // Persistent storage for ongoing sessions

// --- Client Setup ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers // Crucial for reading and checking user roles
    ]
});

// --- Utility Functions ---

/**
 * Creates a simple web server required by Render for monitoring uptime.
 */
function createWebServer() {
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Bot is running and operational.');
    });

    const port = process.env.PORT || 10000;
    server.listen(port, () => {
        console.log(`Web server running on port ${port} (Required for Render uptime).`);
    });
}

/**
 * Loads session data from the persistent JSON file.
 * @returns {object} The sessions object, or an empty object if file not found/invalid.
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
 * Saves session data to the persistent JSON file.
 * @param {object} sessions The sessions object to save.
 */
function saveSessions(sessions) {
    try {
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
    } catch (error) {
        console.error('Error saving sessions:', error);
    }
}

/**
 * Creates a new session object.
 * @param {string} channelId Discord channel ID where the session is hosted.
 * @param {string} hostId Discord user ID of the session host.
 * @param {string} startTime The planned start time of the session (raw string).
 * @param {string} type The type of session (e.g., "POP").
 * @returns {object} The new session object structure.
 */
function createNewSession(channelId, messageId, hostId, startTime, type) {
    return {
        hostId: hostId,
        channelId: channelId,
        messageId: messageId,
        startTime: startTime, // Store the raw time string
        type: type,
        // CRITICAL: Initialize all roster categories as empty arrays to prevent 'Cannot read properties of undefined (reading 'push')'
        drivers: [],
        staff: [],
        trainees: [],
        status: 'open', // 'open', 'closed'
        signupMessageId: null // Placeholder for future use, if signup is in a separate message
    };
}

/**
 * Creates the Discord Embed for a session message.
 * @param {object} session The session data.
 * @param {string} hostTag The host's Discord tag (Username#Discriminator).
 * @returns {EmbedBuilder} The constructed Embed.
 */
function createSessionEmbed(session, hostTag) {
    // UPDATED: Display the raw startTime string directly.
    let description = `**Type:** ${session.type}\n**Start Time:** ${session.startTime} (Timezone is as specified by host)\n**Host:** ${hostTag}\n\n`;

    // Safely access roster arrays, defaulting to empty array if undefined
    const drivers = session.drivers || [];
    const staff = session.staff || [];
    const trainees = session.trainees || [];
    
    const driversCount = drivers.length;
    const staffCount = staff.length;
    const traineesCount = trainees.length;

    const driversList = drivers.map(m => `<@${m.id}>`).join(', ');
    const staffList = staff.map(m => `<@${m.id}>`).join(', ');
    const traineesList = trainees.map(m => `<@${m.id}>`).join(', ');


    description += `**Drivers (${driversCount}):** ${driversCount > 0 ? driversList : 'None'}\n`;
    description += `**Staff (${staffCount}):** ${staffCount > 0 ? staffList : 'None'}\n`;
    description += `**Trainees (${traineesCount}):** ${traineesCount > 0 ? traineesList : 'None'}\n`;

    return new EmbedBuilder()
        .setColor(session.status === 'open' ? 0x00FF00 : 0xFF0000) // Green for open, Red for closed
        .setTitle(`POP Driving Session - ${session.type.toUpperCase()} - ${session.status.toUpperCase()}`)
        .setDescription(description)
        .setFooter({ text: `Session ID: ${session.messageId}` })
        .setTimestamp();
}

/**
 * Creates the Action Row components (buttons) for the session message.
 * @returns {ActionRowBuilder} The row of buttons.
 */
function createSessionButtons() {
    const signupDriverButton = new ButtonBuilder()
        .setCustomId('signup_driver')
        .setLabel('Sign up as Driver')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🚗');

    const signupStaffButton = new ButtonBuilder()
        .setCustomId('signup_staff')
        .setLabel('Sign up as Staff')
        .setStyle(ButtonStyle.Success)
        .setEmoji('🛠️');

    const signupTraineeButton = new ButtonBuilder()
        .setCustomId('signup_trainee')
        .setLabel('Sign up as Trainee')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('👨‍🎓');

    const closeSessionButton = new ButtonBuilder()
        .setCustomId('close_session')
        .setLabel('Close Session')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔒');

    return new ActionRowBuilder().addComponents(signupDriverButton, signupStaffButton, signupTraineeButton, closeSessionButton);
}

// --- Command Definitions ---

const startSessionCommand = new SlashCommandBuilder()
    .setName('startsession')
    .setDescription('Starts a new POP Driving session and posts the signup message.')
    .addStringOption(option =>
        option.setName('time')
            // UPDATED description to tell users the time is static
            .setDescription('The start time of the session (e.g., "TOMORROW 6PM EST").')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('type')
            .setDescription('The type of session (e.g., POP, JNR, MSTR).')
            .setRequired(false))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels); // Example permission requirement


// --- Main Execution ---

// Start the web server first
createWebServer();

client.on('clientReady', () => {
    console.log(`Bot is logged in as ${client.user.tag}!`);

    // Register slash commands globally (or per-guild if preferred)
    client.application.commands.set([startSessionCommand])
        .then(() => console.log('Slash commands registered successfully.'))
        .catch(console.error);
});

client.on('interactionCreate', async interaction => {
    if (interaction.isCommand()) {
        if (interaction.commandName === 'startsession') {
            await handleStartSessionCommand(interaction);
        }
    } else if (interaction.isButton()) {
        await handleSessionButtonInteraction(interaction);
    }
});

/**
 * Handles the /startsession slash command.
 */
async function handleStartSessionCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const member = interaction.guild.members.cache.get(interaction.user.id);
    const hostRoleCheck = member.roles.cache.has(HOST_ID);
    const juniorStaffCheck = JUNIOR_STAFF_IDS.some(id => member.roles.cache.has(id));

    // Check if the user is authorized to start a session
    if (!hostRoleCheck && !juniorStaffCheck && interaction.user.id !== interaction.guild.ownerId) {
        return interaction.followUp({ content: '❌ You do not have permission to start a driving session.', ephemeral: true });
    }

    const startTime = interaction.options.getString('time');
    const sessionType = interaction.options.getString('type') || 'POP';
    const hostId = interaction.user.id;
    const channelId = interaction.channelId;
    let currentSessions = loadSessions();
    const sessionId = interaction.id; // Using the interaction ID as a unique session ID for simplicity

    try {
        // Create the initial session data and components
        const hostTag = interaction.user.tag;
        // Use the raw time string directly
        const initialSessionData = createNewSession(channelId, 'temp', hostId, startTime, sessionType); // 'temp' messageId
        const initialEmbed = createSessionEmbed(initialSessionData, hostTag);
        const buttons = createSessionButtons();

        // Send the message
        const message = await interaction.channel.send({
            embeds: [initialEmbed],
            components: [buttons]
        });

        // Update the session data with the final messageId
        initialSessionData.messageId = message.id;

        // Save the new session
        currentSessions[sessionId] = initialSessionData;
        saveSessions(currentSessions);

        await interaction.followUp({ content: `✅ POP Driving Session started successfully! Time is displayed exactly as you typed it.`, ephemeral: true });

    } catch (error) {
        console.error('Error starting session:', error);
        await interaction.followUp({ content: '❌ Failed to start the session. Check bot permissions.', ephemeral: true });
    }
}

/**
 * Handles button interactions for session signups and closing.
 */
async function handleSessionButtonInteraction(interaction) {
    if (!interaction.customId.startsWith('signup_') && interaction.customId !== 'close_session') return;

    // Use deferReply with ephemeral set to false for messages that should be public,
    // but since this is an interaction update, deferUpdate is correct for buttons.
    await interaction.deferUpdate(); 

    // Find the session associated with the message the button was clicked on
    let currentSessions = loadSessions();
    const sessionId = Object.keys(currentSessions).find(key => currentSessions[key].messageId === interaction.message.id);

    if (!sessionId) {
        // Use followUp here since the deferUpdate was used above.
        return interaction.followUp({ content: '❌ Could not find an active session associated with this message.', ephemeral: true });
    }

    let currentSession = currentSessions[sessionId];

    if (interaction.customId === 'close_session') {
        // --- Handle Close Session ---
        // Check if the user is the host or an authorized staff member
        const member = interaction.guild.members.cache.get(interaction.user.id);
        const hostCheck = interaction.user.id === currentSession.hostId;
        const juniorStaffCheck = JUNIOR_STAFF_IDS.some(id => member.roles.cache.has(id));
        const ownerCheck = interaction.user.id === interaction.guild.ownerId;

        if (!hostCheck && !juniorStaffCheck && !ownerCheck) {
            return interaction.followUp({ content: '❌ Only the session host or authorized staff can close this session.', ephemeral: true });
        }

        // Update session status and remove components
        currentSession.status = 'closed';
        currentSessions[sessionId] = currentSession;
        saveSessions(currentSessions);

        const hostTag = await client.users.fetch(currentSession.hostId).then(user => user.tag).catch(() => 'Unknown Host');
        const updatedEmbed = createSessionEmbed(currentSession, hostTag);

        try {
            await interaction.editReply({ embeds: [updatedEmbed], components: [] }); // Remove buttons
            await interaction.followUp({ content: `✅ Session successfully closed by <@${interaction.user.id}>.`, ephemeral: false });
        } catch (error) {
            console.error('Error closing session:', error);
            await interaction.followUp({ content: '❌ Failed to close the session and update the message.', ephemeral: true });
        }

    } else if (interaction.customId.startsWith('signup_')) {
        // --- Handle Sign-up ---
        if (currentSession.status !== 'open') {
            return interaction.followUp({ content: '❌ This session is already closed for signups.', ephemeral: true });
        }

        const customId = interaction.customId; // e.g., 'signup_driver'
        const roleToSignFor = customId.split('_')[1]; // 'driver', 'staff', or 'trainee'
        const member = interaction.guild.members.cache.get(interaction.user.id);

        // --- 1. Role Check ---
        let roleName = null;
        if (roleToSignFor === 'driver') {
            // Drivers are assumed to be open to everyone, no role check needed.
            roleName = 'Driver';
        } else if (roleToSignFor === 'staff') {
            const hasStaffRole = JUNIOR_STAFF_IDS.some(id => member.roles.cache.has(id)) || member.roles.cache.has(HOST_ID);
            if (!hasStaffRole) {
                return interaction.followUp({ content: '❌ You must be a Staff or Session Host to sign up as Staff.', ephemeral: true });
            }
            roleName = 'Staff';
        } else if (roleToSignFor === 'trainee') {
            const hasTraineeRole = member.roles.cache.has(TRAINEE_ID);
            if (!hasTraineeRole) {
                return interaction.followUp({ content: '❌ You must have the Trainee role to sign up as a Trainee.', ephemeral: true });
            }
            roleName = 'Trainee';
        }

        // --- 2. Check for Duplicate Signups ---
        const allRosterCategories = ['drivers', 'staff', 'trainees'];
        
        // Ensure the categories exist for safe reading, which is good defensive programming practice
        const isAlreadySignedUp = allRosterCategories.some(category =>
            (currentSession[category] || []).some(m => m.id === interaction.user.id)
        );

        if (isAlreadySignedUp) {
            return interaction.followUp({ content: `⚠️ You are already signed up for this session in another role.`, ephemeral: true });
        }

        // --- 4. Add the Member to the Session Roster ---
        // Determine the correct category in the roster (e.g., 'driver' -> 'drivers')
        const rosterCategory = roleToSignFor + 's'; // e.g., 'driver' -> 'drivers'
        
        // Initialize the array if it is missing or not an array.
        if (!currentSession[rosterCategory] || !Array.isArray(currentSession[rosterCategory])) {
            console.warn(`Roster category '${rosterCategory}' missing or invalid in session ${sessionId}. Initializing as empty array.`);
            currentSession[rosterCategory] = []; 
        }
        
        currentSession[rosterCategory].push({ id: member.id, tag: member.user.tag });

        // Update the data store
        currentSessions[sessionId] = currentSession;
        saveSessions(currentSessions);

        // --- 5. Update the Message Embed ---
        const hostTag = await client.users.fetch(currentSession.hostId).then(user => user.tag).catch(() => 'Unknown Host');
        const updatedEmbed = createSessionEmbed(currentSession, hostTag);

        try {
            // Find the original message and update the embed with the new roster
            const messageChannel = await client.channels.fetch(currentSession.channelId);
            const messageToEdit = await messageChannel.messages.fetch(currentSession.messageId);

            // Fetch the current components (buttons/menu) to ensure they persist
            const existingComponents = messageToEdit.components;

            await messageToEdit.edit({ embeds: [updatedEmbed], components: existingComponents });

            await interaction.followUp({ content: `✅ You have successfully signed up as a **${roleToSignFor.toUpperCase()}**!`, ephemeral: true });

        } catch (error) {
            console.error('Error signing up and updating message:', error);
            await interaction.followUp({ content: '❌ Failed to update the session roster. Please try again.', ephemeral: true });
        }
    }
}

// Log the bot in
client.login(TOKEN);
