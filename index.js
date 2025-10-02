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
 * Creates the Discord embed for a session with the new layout, emojis, and fields.
 * Handles the time display to prevent "giberish" if the time string is invalid.
 * @param {Object} session The session data.
 * @param {string} hostTag The Discord tag of the host.
 * @returns {EmbedBuilder}
 */
function createSessionEmbed(session, hostTag) {
    const driversCount = session.drivers.length;
    const staffCount = session.juniorstaff.length;
    const traineesCount = session.trainees.length;

    // --- Time Display Logic (Fixed NaN Issue) ---
    let timeDisplay = session.time;
    const parsedTime = Date.parse(session.time);

    // Only use Discord's relative timestamp if the user input can be reliably parsed into a valid, non-zero date.
    if (!isNaN(parsedTime) && parsedTime > 0) {
        const timestamp = Math.floor(parsedTime / 1000);
        // Display the exact time (f) and the relative time (R)
        timeDisplay = `<t:${timestamp}:f> (<t:${timestamp}:R>)`;
    } 
    // If parsing fails (e.g., 'T' or '1 DAY'), timeDisplay remains the raw input string (session.time).


    const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        // New Title
        .setTitle('📢 This is a scheduled POP driving session. Sign up below! 🚗')
        .setDescription(
            // Location is removed completely from the embed structure.
            `**Host**\n<@${session.hostId}> (${hostTag})\n` +
            `**Time**\n${timeDisplay}\n` +
            `**Duration**\n${session.duration}\n` +
            `**Channel**\n<#${session.channelId}>\n\n` +
            `**— — — Roster Signups — — —**`
        )
        .addFields(
            // Roster Fields 
            { 
                name: `🏎️ Drivers (${driversCount})`, 
                value: session.drivers.map(u => `<@${u.id}>`).join('\n') || 'No drivers signed up yet.', 
                inline: false 
            },
            { 
                name: `🛠️ Staff (${staffCount})`, // Junior Staff is displayed as "Staff"
                value: session.juniorstaff.map(u => `<@${u.id}>`).join('\n') || 'No staff members signed up yet.', 
                inline: false 
            },
            { 
                name: `📚 Trainees (${traineesCount})`, 
                value: session.trainees.map(u => `<@${u.id}>`).join('\n') || 'No trainees signed up yet.', 
                inline: false 
            }
        )
        .setFooter({ text: `Session ID: ${session.id}` })
        .setTimestamp(); // Keeps the standard Discord message timestamp

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
        .setLabel('Sign up as Staff')
        .setStyle(ButtonStyle.Secondary);

    const traineeButton = new ButtonBuilder()
        .setCustomId(`SIGNUP_${sessionId}_trainee`)
        .setLabel('Sign up as Trainee')
        .setStyle(ButtonStyle.Success);
        
    const closeButton = new ButtonBuilder()
        .setCustomId(`CLOSE_${sessionId}_close`)
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

    // CRITICAL FIX: Deferral must be wrapped in try/catch and we must exit 
    // if it fails to prevent the InteractionNotReplied crash.
    try {
        // Acknowledge the interaction immediately as ephemeral (visible only to the user who clicked)
        await interaction.deferReply({ ephemeral: true }); 
    } catch (e) {
        // Error code 10062 means the interaction has timed out (stale) or was already acknowledged.
        if (e.code === 10062) {
            console.warn(`Stale interaction detected and ignored: ${interaction.customId}`);
            return; // Gracefully exit.
        }
        console.error(`Failed to defer button interaction ${interaction.customId}:`, e);
        return; // Prevents the fatal crash on subsequent editReply calls.
    }


    const [action, sessionId, roleToSignFor] = interaction.customId.split('_');
    const member = interaction.member;
    const currentSessions = loadSessions();
    let currentSession = currentSessions[sessionId];

    if (!currentSession) {
        return interaction.editReply({ content: '❌ This session is no longer active or the ID is invalid.' });
    }

    // Function to check if a user has a required role (using the environment variables)
    const hasRequiredRole = (role) => {
        if (role === 'juniorstaff') {
            return member.roles.cache.has(HOST_ID) || JUNIOR_STAFF_IDS.some(id => member.roles.cache.has(id));
        }
        if (role === 'trainee') {
            return member.roles.cache.has(TRAINEE_ID);
        }
        return true; 
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
            .setTitle(`Session Closed`)
            .setDescription(`The session hosted by <@${currentSession.hostId}> has been closed.`)
            .setTimestamp();

        try {
            await interaction.message.edit({ 
                embeds: [closeEmbed], 
                components: [] // Remove all buttons
            });

            return interaction.editReply({ content: '✅ Session successfully closed.' });

        } catch (error) {
            console.error('Error closing session:', error);
            return interaction.editReply({ content: '❌ Failed to close and update the message. Data has been removed.' });
        }
    }

    if (action === 'SIGNUP') {
        // Map the role string to the session object key
        const rosterCategory = roleToSignFor === 'juniorstaff' ? 'juniorstaff' : roleToSignFor + 's';

        // --- 1. Role Check ---
        if (!hasRequiredRole(roleToSignFor)) {
            const roleName = roleToSignFor === 'juniorstaff' ? 'Staff' : roleToSignFor;
            return interaction.editReply({ content: `❌ You do not have the required role to sign up as **${roleName.toUpperCase()}**.` });
        }

        // --- 2. Check for existing sign-up (and auto-change roles) ---
        let existingRole = null;
        for (const key of ['drivers', 'juniorstaff', 'trainees']) {
            if (currentSession[key] && Array.isArray(currentSession[key]) && currentSession[key].some(u => u.id === member.id)) {
                existingRole = key;
                break;
            }
        }
        
        const newRoleName = roleToSignFor === 'juniorstaff' ? 'Staff' : roleToSignFor;

        // If they are already signed up in this role, send warning and stop
        if (existingRole === rosterCategory) {
            return interaction.editReply({ content: `⚠️ You are already signed up as **${newRoleName.toUpperCase()}**.` });
        }

        // --- Handle Role Change ---
        if (existingRole) {
            const existingRoleName = existingRole === 'juniorstaff' ? 'Staff' : existingRole.slice(0, -1);
            
            // Remove user from the old role
            currentSession[existingRole] = currentSession[existingRole].filter(u => u.id !== member.id);
            
            // Add user to the new role
            currentSession[rosterCategory].push({ id: member.id, tag: member.user.tag });
            
            // Update the data store
            saveSessions(currentSessions);

            // Fetch host tag and update embed
            const hostTag = await client.users.fetch(currentSession.hostId).then(user => user.tag).catch(() => 'Unknown Host');
            const updatedEmbed = createSessionEmbed(currentSession, hostTag);

            try {
                await interaction.message.edit({ embeds: [updatedEmbed], components: interaction.message.components });
                return interaction.editReply({ 
                    content: `🔄 Successfully changed your role from **${existingRoleName.toUpperCase()}** to **${newRoleName.toUpperCase()}**!` 
                });
            } catch (error) {
                console.error('Error changing role and updating message:', error);
                return interaction.editReply({ content: '⚠️ Your role change was saved, but the session message failed to update (it might be deleted).' });
            }
        }

        // --- 3. Add to Roster (First-time sign-up) ---
        if (!currentSession[rosterCategory] || !Array.isArray(currentSession[rosterCategory])) {
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
            await interaction.message.edit({ embeds: [updatedEmbed], components: interaction.message.components });
            return interaction.editReply({ content: `✅ You have successfully signed up as **${newRoleName.toUpperCase()}**!` });

        } catch (error) {
            console.error('Error signing up and updating message:', error);
            return interaction.editReply({ content: '⚠️ Your sign-up data was saved, but the session message failed to update (it might be deleted).' });
        }
    }
}


// --- Main Interaction Handler ---
client.on('interactionCreate', async interaction => {
    
    if (interaction.isChatInputCommand()) {
        const { commandName, options } = interaction;
        
        if (commandName === 'sessionbook') {
            
            // CRITICAL FIX: Deferral prevents the 3-second timeout (Unknown interaction)
            try {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral }); 
            } catch (e) {
                if (e.code === 10062) return; 
                console.error('CRITICAL: Slash command deferral failed (Timeout/Unknown Interaction).', e);
                return;
            }

            // --- 1. Permission Check ---
            const member = interaction.member;
            if (member.id !== HOST_ID && !member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.editReply({ content: '❌ You do not have permission to book a session.' });
            }

            // --- 2. Gather Command Options (Only Time and Duration) ---
            const time = options.getString('time');
            const duration = options.getString('duration');
            const channelId = interaction.channelId; 
            const hostId = member.id;
            
            // --- 3. Create Session Data (No more 'title' field) ---
            const sessionId = generateSessionId(channelId);
            const newSession = {
                id: sessionId,
                time: time,
                duration: duration, 
                channelId: channelId,
                hostId: hostId,
                drivers: [],
                juniorstaff: [],
                trainees: [],
                messageId: null
            };

            // --- 4. Send Message and Get Message ID ---
            const hostTag = member.user.tag;
            const embed = createSessionEmbed(newSession, hostTag);
            const components = createSessionButtons(sessionId);

            try {
                const message = await interaction.channel.send({
                    embeds: [embed],
                    components: [components]
                });

                newSession.messageId = message.id;

                // --- 5. Save Session ---
                const currentSessions = loadSessions();
                currentSessions[sessionId] = newSession;
                saveSessions(currentSessions);
                
                // --- 6. Final Command Confirmation ---
                return interaction.editReply({ 
                    content: `✅ Session successfully booked for **${time}** in <#${channelId}>.`, 
                });

            } catch (error) {
                console.error('Error sending session message or saving data:', error);
                return interaction.editReply({ content: '❌ An error occurred while posting the session. Please check bot permissions and try again.' });
            }
        }
    } else if (interaction.isButton()) {
        await handleButtonInteraction(interaction);
    }
});


// --- Slash Command Definition and Registration ---

client.on('clientReady', async () => { 
    console.log(`Bot is logged in as ${client.user.tag}!`);

    // Define the slash command (ONLY REQUIRES TIME AND DURATION)
    const sessionBookCommand = new SlashCommandBuilder()
        .setName('sessionbook')
        .setDescription('Books a new driving session and posts it to the channel where this command is run.')
        .addStringOption(option =>
            option.setName('time')
                .setDescription('The time and date of the session (e.g., 20:00 UTC, Today 3 PM PST, or just T)')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('duration') 
                .setDescription('The expected length of the session (e.g., 1 hour, 30 minutes)')
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
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running\n');
});

const port = process.env.PORT || 10000;
server.listen(port, () => {
    console.log(`Web server running on port ${port}`);
});


// Log the bot in
client.login(TOKEN);
