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
    ChannelType // Needed for specifying text channel type in command
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
 * @param {string} messageId The ID of the message the session is attached to.
 * @param {string} hostId Discord user ID of the session host.
 * @param {string} startTime The planned start time of the session.
 * @param {string} location The session location.
 * @param {string} duration The session duration.
 * @param {string} type The type of session (e.g., "POP").
 * @returns {object} The new session object structure.
 */
function createNewSession(channelId, messageId, hostId, startTime, location, duration, type) {
    return {
        hostId: hostId,
        channelId: channelId,
        messageId: messageId,
        startTime: startTime, 
        location: location,
        duration: duration,
        type: type,
        drivers: [],
        staff: [],
        trainees: [],
        status: 'open', // 'open', 'closed'
    };
}

/**
 * Creates the Discord Embed for a session message, matching the requested visual style.
 * @param {object} session The session data.
 * @param {string} hostTag The host's Discord tag (Username#Discriminator).
 * @returns {EmbedBuilder} The constructed Embed.
 */
function createSessionEmbed(session, hostTag) {
    // Safely access roster arrays, defaulting to empty array if undefined
    const drivers = session.drivers || [];
    const staff = session.staff || [];
    const trainees = session.trainees || [];
    
    const driversCount = drivers.length;
    const staffCount = staff.length;
    const traineesCount = trainees.length;

    // Format the lists of signed-up users (one user per line)
    const driversList = drivers.map(m => `<@${m.id}>`).join('\n');
    const staffList = staff.map(m => `<@${m.id}>`).join('\n');
    const traineesList = trainees.map(m => `<@${m.id}>`).join('\n');

    // Use a primary color (Discord Blurple: 0x5865F2) when open, and Red when closed
    const embedColor = session.status === 'open' ? 0x5865F2 : 0xFF0000;
    
    // Create the embed
    const embed = new EmbedBuilder()
        .setColor(embedColor)
        // Set the title matching the requested concept style
        .setTitle(`⭐ ${session.type.toUpperCase()} Driving Session ${session.status.toUpperCase()} ⭐`)
        .setDescription(`This is a scheduled **${session.type.toUpperCase()}** driving session. Sign up below!`)
        .setTimestamp();

    // Add required detail fields (Inline to keep them concise)
    embed.addFields(
        { name: 'Host', value: hostTag, inline: true },
        { name: 'Time', value: session.startTime, inline: true },
        { name: 'Duration', value: session.duration, inline: true },
        // Use full width for Location
        { name: 'Location', value: session.location, inline: false }, 
        
        // Separator field for clarity
        { name: '\u200B', value: '--- **Roster Signups** ---', inline: false } 
    );

    // Add Roster Fields. Use false inline for drivers to give more space for names. Staff/Trainees can be inline.
    embed.addFields(
        { 
            name: `🚗 Drivers (${driversCount})`, 
            value: driversCount > 0 ? driversList : '*No drivers signed up yet.*', 
            inline: false 
        },
        { 
            name: `🛠️ Staff (${staffCount})`, 
            value: staffCount > 0 ? staffList : '*No staff members signed up yet.*', 
            inline: true 
        },
        { 
            name: `👨‍🎓 Trainees (${traineesCount})`, 
            value: traineesCount > 0 ? traineesList : '*No trainees signed up yet.*', 
            inline: true 
        }
    );

    embed.setFooter({ text: `Session ID: ${session.messageId}` });

    return embed;
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

// NEW COMMAND: /sessionbook
const sessionBookCommand = new SlashCommandBuilder()
    .setName('sessionbook')
    .setDescription('Schedules and posts a new POP Driving session.')
    .addStringOption(option =>
        option.setName('time')
            .setDescription('The start time (e.g., "TOMORROW 6PM EST").')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('location')
            .setDescription('The location (e.g., "POP_Track_East").')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('duration')
            .setDescription('The expected duration (e.g., "2 hours").')
            .setRequired(true))
    .addChannelOption(option =>
        option.setName('channel')
            .setDescription('The channel where the session signup message will be posted.')
            .addChannelTypes(ChannelType.GuildText) // Force selection of a text channel
            .setRequired(true))
    .addStringOption(option =>
        option.setName('type')
            .setDescription('The type of session (e.g., POP, JNR, MSTR).')
            .setRequired(false))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels);


// --- Main Execution ---

// Start the web server first
createWebServer();

client.on('clientReady', () => {
    console.log(`Bot is logged in as ${client.user.tag}!`);

    // Register slash command
    client.application.commands.set([sessionBookCommand])
        .then(() => console.log('Slash command /sessionbook registered successfully.'))
        .catch(console.error);
});

client.on('interactionCreate', async interaction => {
    if (interaction.isCommand()) {
        if (interaction.commandName === 'sessionbook') {
            await handleSessionBookCommand(interaction);
        }
    } else if (interaction.isButton()) {
        await handleSessionButtonInteraction(interaction);
    }
});

/**
 * Handles the /sessionbook slash command.
 */
async function handleSessionBookCommand(interaction) {
    // Initial deferral ensures the command doesn't time out.
    await interaction.deferReply({ ephemeral: true });

    const member = interaction.guild.members.cache.get(interaction.user.id);
    const hostRoleCheck = member.roles.cache.has(HOST_ID);
    const juniorStaffCheck = JUNIOR_STAFF_IDS.some(id => member.roles.cache.has(id));

    // Check if the user is authorized to start a session
    if (!hostRoleCheck && !juniorStaffCheck && interaction.user.id !== interaction.guild.ownerId) {
        return interaction.editReply({ content: '❌ You do not have permission to book a driving session.' });
    }

    // Retrieve all new command options
    const startTime = interaction.options.getString('time');
    const location = interaction.options.getString('location');
    const duration = interaction.options.getString('duration');
    const targetChannel = interaction.options.getChannel('channel'); // This is a Channel object
    const sessionType = interaction.options.getString('type') || 'POP';
    
    const hostId = interaction.user.id;
    let currentSessions = loadSessions();
    const sessionId = interaction.id; // Using the interaction ID as a unique session ID for simplicity

    // Final check for channel permissions
    if (!targetChannel.isTextBased()) {
        return interaction.editReply({ content: '❌ The selected channel is not a valid text channel for posting the session.' });
    }
    
    try {
        // Create the initial session data and components
        const hostTag = interaction.user.tag;
        const initialSessionData = createNewSession(targetChannel.id, 'temp', hostId, startTime, location, duration, sessionType); // 'temp' messageId
        const initialEmbed = createSessionEmbed(initialSessionData, hostTag);
        const buttons = createSessionButtons();

        // Send the message to the specified channel
        const message = await targetChannel.send({
            embeds: [initialEmbed],
            components: [buttons]
        });

        // Update the session data with the final messageId and channelId
        initialSessionData.messageId = message.id;
        initialSessionData.channelId = message.channelId; // Ensure we use the correct channel ID if we fetched it

        // Save the new session
        currentSessions[sessionId] = initialSessionData;
        saveSessions(currentSessions);

        await interaction.editReply({ content: `✅ POP Driving Session successfully booked and posted in ${targetChannel}!` });

    } catch (error) {
        console.error('Error booking session:', error);
        await interaction.editReply({ content: '❌ Failed to book the session. Check bot permissions or channel validity.' });
    }
}

/**
 * Handles button interactions for session signups and closing.
 */
async function handleSessionButtonInteraction(interaction) {
    if (!interaction.customId.startsWith('signup_') && interaction.customId !== 'close_session') return;

    // CRITICAL FIX: Defer reply ephemerally to give the bot more time to process and avoid "Unknown Interaction" errors.
    // This is the essential part that fixes the timeout.
    await interaction.deferReply({ ephemeral: true }); 

    // Find the session associated with the message the button was clicked on
    let currentSessions = loadSessions();
    const sessionId = Object.keys(currentSessions).find(key => currentSessions[key].messageId === interaction.message.id);

    if (!sessionId) {
        // If the session ID is not found, the message is likely too old or the sessions.json file was reset.
        console.error(`Session ID not found for message ID: ${interaction.message.id}`);
        // Use editReply to deliver the final ephemeral message after deferral
        return interaction.editReply({ content: '❌ Could not find an active session associated with this message. **Please ask the host to start a new session!**' });
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
            return interaction.editReply({ content: '❌ Only the session host or authorized staff can close this session.' });
        }

        // Update session status and remove components
        currentSession.status = 'closed';
        currentSessions[sessionId] = currentSession;
        saveSessions(currentSessions);

        const hostTag = await client.users.fetch(currentSession.hostId).then(user => user.tag).catch(() => 'Unknown Host');
        const updatedEmbed = createSessionEmbed(currentSession, hostTag);

        try {
            // Edit the original message to reflect closure and remove buttons
            await interaction.message.edit({ embeds: [updatedEmbed], components: [] }); 
            
            // Final confirmation to the user who clicked the button via editReply
            return interaction.editReply({ content: `✅ The session has been marked as closed and the buttons have been removed from the message.` });

        } catch (error) {
            console.error('Error closing session:', error);
            return interaction.editReply({ content: '❌ Failed to close the session and update the message.' });
        }

    } else if (interaction.customId.startsWith('signup_')) {
        // --- Handle Sign-up ---
        if (currentSession.status !== 'open') {
            return interaction.editReply({ content: '❌ This session is already closed for signups.' });
        }

        const customId = interaction.customId; // e.g., 'signup_driver'
        const roleToSignFor = customId.split('_')[1]; // 'driver', 'staff', or 'trainee'
        const member = interaction.guild.members.cache.get(interaction.user.id);

        // --- 1. Role Check (using the stored IDs in .env) ---
        // This is done to provide better feedback if the user doesn't have the required role
        if (roleToSignFor === 'staff') {
            const hasStaffRole = JUNIOR_STAFF_IDS.some(id => member.roles.cache.has(id)) || member.roles.cache.has(HOST_ID);
            if (!hasStaffRole) {
                return interaction.editReply({ content: '❌ You must be a Staff or Session Host to sign up as Staff.' });
            }
        } else if (roleToSignFor === 'trainee') {
            const hasTraineeRole = member.roles.cache.has(TRAINEE_ID);
            if (!hasTraineeRole) {
                return interaction.editReply({ content: '❌ You must have the Trainee role to sign up as a Trainee.' });
            }
        }

        // --- 2. Check for Duplicate Signups ---
        const allRosterCategories = ['drivers', 'staff', 'trainees'];
        
        const isAlreadySignedUp = allRosterCategories.some(category =>
            (currentSession[category] || []).some(m => m.id === interaction.user.id)
        );

        if (isAlreadySignedUp) {
            return interaction.editReply({ content: `⚠️ You are already signed up for this session in another role. To change your role, a host must manually remove you.` });
        }

        // --- 3. Add the Member to the Session Roster ---
        const rosterCategory = roleToSignFor + 's'; 
        
        if (!currentSession[rosterCategory] || !Array.isArray(currentSession[rosterCategory])) {
            console.warn(`Roster category '${rosterCategory}' missing or invalid in session ${sessionId}. Initializing as empty array.`);
            currentSession[rosterCategory] = []; 
        }
        
        currentSession[rosterCategory].push({ id: member.id, tag: member.user.tag });

        // Update the data store
        currentSessions[sessionId] = currentSession;
        saveSessions(currentSessions);

        // --- 4. Update the Message Embed ---
        const hostTag = await client.users.fetch(currentSession.hostId).then(user => user.tag).catch(() => 'Unknown Host');
        const updatedEmbed = createSessionEmbed(currentSession, hostTag);

        try {
            // Edit the original message (from interaction.message) with the updated embed
            // We ensure existing components (buttons) are preserved if the session is still open.
            await interaction.message.edit({ embeds: [updatedEmbed], components: interaction.message.components });

            // Final confirmation to the user who clicked the button via editReply
            return interaction.editReply({ content: `✅ You have successfully signed up as a **${roleToSignFor.toUpperCase()}**!` });

        } catch (error) {
            console.error('Error signing up and updating message:', error);
            return interaction.editReply({ content: '❌ Failed to update the session roster. Please try again.' });
        }
    }
}

// Log the bot in
client.login(TOKEN);
