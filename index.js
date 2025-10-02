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
    ComponentType, 
    PermissionsBitField, 
    StringSelectMenuBuilder 
} = require('discord.js');

// Import dayjs and the advanced parsing plugins for natural language dates
const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
const timezone = require('dayjs/plugin/timezone');
const utc = require('dayjs/plugin/utc');
dayjs.extend(customParseFormat);
dayjs.extend(timezone);
dayjs.extend(utc);

// --- Configuration Constants from .env ---
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
        GatewayIntentBits.GuildMembers 
    ]
});

// --- Utility Functions (File I/O and Date Parsing) ---

// Reads the sessions from the JSON file
function loadSessions() {
    try {
        const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
        // Ensure the file content is parsed correctly. If the file is empty, return an empty object.
        return JSON.parse(data) || {};
    } catch (error) {
        // If file doesn't exist or is invalid JSON (e.g., empty), start with an empty object.
        if (error.code === 'ENOENT' || error instanceof SyntaxError) {
            console.warn('Error reading sessions.json, returning empty object:', error.message);
            // Initialize with valid JSON to prevent future errors
            saveSessions({}); 
            return {};
        }
        console.error('CRITICAL: Failed to load sessions:', error);
        return {};
    }
}

// Writes the current sessions state to the JSON file
function saveSessions(sessions) {
    try {
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
    } catch (error) {
        console.error('CRITICAL: Failed to save sessions:', error);
    }
}

/**
 * Parses a user-provided time string into a valid Day.js object.
 * This is designed to handle common formats and assumes EST/EDT by default if no timezone is provided.
 * @param {string} timeString The time string from the user (e.g., "Saturday @ 3pm est" or "14/09/26 8pm").
 * @returns {dayjs.Dayjs | null} A Day.js object in UTC, or null if parsing failed.
 */
function parseTimeString(timeString) {
    // 1. Define a list of common date formats to try
    const formats = [
        'YYYY-MM-DD h:mm A z', // 2026-09-14 8:00 PM EST
        'MM/DD/YY h:mm A z',   // 09/14/26 8:00 PM EST
        'D/M/YY h:mm A z',     // 14/9/26 8:00 PM EST
        'dddd @ h:mm A z',     // Saturday @ 3:00 PM EST (Assumes current week's Saturday)
        'h:mm A z'             // 8:00 PM EST (Assumes today)
    ];

    // 2. Normalize and attempt to find a timezone. Default to EST/EDT if none found.
    const normalizedString = timeString.replace(/@/g, '').trim();
    
    let timeWithZone = normalizedString;
    let tz = 'America/New_York'; // Default to EST/EDT

    // Basic regex to find common timezone abbreviations (e.g., EST, PST, GMT, CDT)
    const tzMatch = normalizedString.match(/\b(EST|EDT|PST|PDT|CST|CDT|MST|MDT|GMT|UTC)\b/i);

    if (tzMatch) {
        const matchedZone = tzMatch[1].toUpperCase();
        timeWithZone = normalizedString.replace(tzMatch[0], '').trim(); // Remove the TZ from the string for parsing

        switch (matchedZone) {
            case 'PST':
            case 'PDT':
                tz = 'America/Los_Angeles';
                break;
            case 'CST':
            case 'CDT':
                tz = 'America/Chicago';
                break;
            case 'MST':
            case 'MDT':
                tz = 'America/Denver';
                break;
            case 'GMT':
            case 'UTC':
                tz = 'UTC';
                break;
            default: // EST/EDT (New York)
                tz = 'America/New_York';
                break;
        }
    }
    
    // 3. Try parsing the date with the determined timezone
    for (const format of formats) {
        // dayjs().tz(tz) sets the current time in that zone
        let date = dayjs.tz(timeWithZone, format, tz);

        // Check for "tomorrow" or "today" keywords (relative time handling)
        if (timeString.toLowerCase().includes('tomorrow')) {
            date = date.add(1, 'day');
        } else if (timeString.toLowerCase().includes('today')) {
            // No need to add a day, just use the current day
        }

        if (date.isValid()) {
            // Discord requires the Unix timestamp (seconds since epoch), which is UTC.
            // .unix() returns seconds, which is what Discord expects for the <t:TIMESTAMP> format.
            return date.unix(); 
        }
    }

    // 4. If all explicit format parsing fails, return null
    return null;
}

// --- Embed & Component Generators ---

/**
 * Creates the standard session embed display.
 * @param {object} session The session data object.
 * @param {string} hostTag The Discord tag of the host.
 * @returns {EmbedBuilder} The Discord session embed.
 */
function createSessionEmbed(session, hostTag) {
    const sessionTime = session.scheduledTimestamp 
        ? `<t:${session.scheduledTimestamp}:F> (<t:${session.scheduledTimestamp}:R>)` // Dynamic Timestamp
        : session.time; // Fallback to plain text if parsing failed

    const capacityDisplay = (roster, max) => {
        if (max === 0) return `(${roster.length} signed up)`;
        return `(${roster.length}/${max} signed up)`;
    };

    const rosters = [
        `**Drivers** ${capacityDisplay(session.drivers, session.maxDrivers)}:\n${session.drivers.map(u => `> 👤 ${u.tag}`).join('\n') || '> No drivers signed up.'}`,
        `**Staff** ${capacityDisplay(session.staff, session.maxStaff)}:\n${session.staff.map(u => `> 🛠️ ${u.tag}`).join('\n') || '> No staff signed up.'}`,
        `**Trainees** ${capacityDisplay(session.trainees, session.maxTrainees)}:\n${session.trainees.map(u => `> 🎓 ${u.tag}`).join('\n') || '> No trainees signed up.'}`
    ].join('\n\n');

    return new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle(`POP DRIVING Training Session`)
        .setDescription(`**Host:** ${hostTag}\n**Session Time:** ${sessionTime}\n**Session ID:** \`${session.id}\`\n\n---`)
        .addFields({
            name: 'Current Roster',
            value: rosters,
            inline: false
        })
        .setTimestamp();
}

/**
 * Creates the action row with the sign-up select menu.
 * @param {object} session The session data object.
 * @returns {ActionRowBuilder[]} The array containing the Select Menu and Cancel Button rows.
 */
function createActionRow(session) {
    const roles = {
        'driver': { label: 'Driver', emoji: '👤', value: 'driver', max: session.maxDrivers, current: session.drivers.length },
        'staff': { label: 'Staff (Jr/Sr)', emoji: '🛠️', value: 'staff', max: session.maxStaff, current: session.staff.length },
        'trainee': { label: 'Trainee', emoji: '🎓', value: 'trainee', max: session.maxTrainees, current: session.trainees.length },
    };

    const options = Object.values(roles).map(role => ({
        label: role.label,
        emoji: role.emoji,
        value: role.value,
        description: role.max > 0 ? `Max: ${role.max} | Current: ${role.current}` : `Current: ${role.current}`,
        // Disable the option if capacity is reached
        default: false,
        disabled: role.max > 0 && role.current >= role.max
    }));

    const selectMenu = new StringSelectMenuBuilder()
        // FIX: Changed Custom ID structure to be just 'signup_SESSIONID' to ensure correct parsing
        .setCustomId(`signup_${session.id}`)
        .setPlaceholder('Choose your role to sign up...')
        .addOptions(options);

    const selectRow = new ActionRowBuilder()
        .addComponents(selectMenu);

    const cancelButton = new ButtonBuilder()
        .setCustomId(`cancel_${session.id}`)
        .setLabel('Cancel Signup ✖️')
        .setStyle(ButtonStyle.Danger);

    const buttonRow = new ActionRowBuilder()
        .addComponents(cancelButton);

    return [selectRow, buttonRow];
}


// --- Discord Bot Logic ---

client.on('ready', async () => {
    console.log(`Bot is logged in as ${client.user.tag}!`);

    // Define Slash Commands for immediate registration
    const commands = [
        new SlashCommandBuilder()
            .setName('session-book')
            .setDescription('Schedules a new POP DRIVING training session.')
            .addStringOption(option =>
                option.setName('time')
                    .setDescription('The time and date (e.g., Saturday @ 3pm EST, tomorrow 6pm, 14/09/26 8pm).')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('description')
                    .setDescription('Optional description for the session.')
                    .setRequired(false))
            .addIntegerOption(option =>
                option.setName('max_drivers')
                    .setDescription('Set maximum driver capacity (0 for unlimited).')
                    .setRequired(false))
            .addIntegerOption(option =>
                option.setName('max_staff')
                    .setDescription('Set maximum staff capacity (0 for unlimited).')
                    .setRequired(false))
            .addIntegerOption(option =>
                option.setName('max_trainees')
                    .setDescription('Set maximum trainee capacity (0 for unlimited).')
                    .setRequired(false)),

        new SlashCommandBuilder()
            .setName('session-end')
            .setDescription('Ends an active session and archives the message.')
            .addStringOption(option =>
                option.setName('message_id')
                    .setDescription('The ID or link of the session announcement message.')
                    .setRequired(true))
    ].map(command => command.toJSON());

    // Register commands globally or guild-specific
    try {
        await client.application.commands.set(commands);
        console.log('Slash commands registered successfully.');
    } catch (error) {
        console.error('Failed to register slash commands:', error);
    }
});


// --- Interaction Handling (Commands & Buttons/Select Menus) ---

client.on('interactionCreate', async interaction => {
    if (!interaction.guild) return;

    // --- Command Handling ---
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        // --- /session-book command ---
        if (commandName === 'session-book') {
            await interaction.deferReply({ ephemeral: true });

            const member = interaction.member;
            
            // Check for Host or Junior Staff Role
            const isHost = member.roles.cache.has(HOST_ID);
            const isJuniorStaff = JUNIOR_STAFF_IDS.some(id => member.roles.cache.has(id));
            
            // Allow only specific roles to use this command
            if (!isHost && !isJuniorStaff) {
                return interaction.followUp({ content: '❌ You do not have permission to book a session.', ephemeral: true });
            }

            const timeString = interaction.options.getString('time');
            const description = interaction.options.getString('description') || 'No description provided.';
            const maxDrivers = interaction.options.getInteger('max_drivers') || 0;
            const maxStaff = interaction.options.getInteger('max_staff') || 0;
            const maxTrainees = interaction.options.getInteger('max_trainees') || 0;
            
            // Use the new parser to get the Unix timestamp
            const scheduledTimestamp = parseTimeString(timeString);
            
            let displayTimeMessage;
            if (scheduledTimestamp) {
                // Format the time using the Discord dynamic timestamp: <t:timestamp:F> (Full Date/Time)
                displayTimeMessage = `✅ Time successfully converted! It will be shown to everyone in their local timezone.`;
            } else {
                displayTimeMessage = `⚠️ **Timezone Conversion Failed:** Could not reliably parse \`${timeString}\`. Displaying plain text time, which may confuse users in different timezones.`;
            }

            // Generate a unique ID for this session
            const sessionId = interaction.id; 

            // Create initial session data object
            const sessionData = {
                id: sessionId,
                hostId: member.id,
                channelId: interaction.channelId,
                time: timeString, // Store original input for logging/reference
                scheduledTimestamp: scheduledTimestamp, // Store the Unix timestamp
                description: description,
                maxDrivers: Math.max(0, maxDrivers),
                maxStaff: Math.max(0, maxStaff),
                maxTrainees: Math.max(0, maxTrainees),
                drivers: [],
                staff: [],
                trainees: [],
                status: 'active'
            };

            // Generate the initial embed and components
            const embed = createSessionEmbed(sessionData, member.user.tag);
            const components = createActionRow(sessionData);

            try {
                // Post the session announcement
                const message = await interaction.channel.send({ embeds: [embed], components: components });
                
                // Save the message ID and update the data
                sessionData.messageId = message.id;

                const currentSessions = loadSessions();
                currentSessions[sessionId] = sessionData;
                saveSessions(currentSessions);

                await interaction.followUp({ content: `✅ Session booked successfully! See the announcement above.\n\n${displayTimeMessage}`, ephemeral: true });

            } catch (error) {
                console.error('Error posting session announcement:', error);
                await interaction.followUp({ content: '❌ Failed to book the session.', ephemeral: true });
            }
        }
        
        // --- /session-end command ---
        else if (commandName === 'session-end') {
             await interaction.deferReply({ ephemeral: true });

            const member = interaction.member;

            // Check if the user is a Host or has permission to end sessions
            const isHost = member.roles.cache.has(HOST_ID);
            const isJuniorStaff = JUNIOR_STAFF_IDS.some(id => member.roles.cache.has(id));

            if (!isHost && !isJuniorStaff) {
                return interaction.followUp({ content: '❌ You do not have permission to end a session.', ephemeral: true });
            }

            const messageIdOrLink = interaction.options.getString('message_id');
            // Attempt to extract the ID from a link if provided
            const messageIdMatch = messageIdOrLink.match(/(\d+)$/);
            const targetMessageId = messageIdMatch ? messageIdMatch[1] : messageIdOrLink;
            
            const currentSessions = loadSessions();
            let sessionToDeleteId = null;
            let targetSession = null;

            // Find the session ID linked to this message ID
            for (const id in currentSessions) {
                if (currentSessions[id].messageId === targetMessageId) {
                    sessionToDeleteId = id;
                    targetSession = currentSessions[id];
                    break;
                }
            }

            if (!sessionToDeleteId) {
                 return interaction.followUp({ content: '❌ Session not found. Please ensure the message ID or link is correct and the session is active.', ephemeral: true });
            }

            try {
                const channel = await client.channels.fetch(targetSession.channelId);
                const message = await channel.messages.fetch(targetMessageId);

                // Archive the embed
                const hostTag = await client.users.fetch(targetSession.hostId).then(user => user.tag).catch(() => 'Unknown Host');
                const archivedEmbed = createSessionEmbed(targetSession, hostTag)
                    .setColor(0x808080)
                    .setTitle(`[ARCHIVED] POP DRIVING Training Session`)
                    .setDescription(`**This session has concluded and the roster is finalized.**\n\n**Host:** ${hostTag}\n**Original Time:** ${targetSession.time}\n**Session ID:** \`${targetSession.id}\`\n\n---`)
                    .setTimestamp(new Date()); 

                // Edit the message to remove interactive components and show the archived embed
                await message.edit({ embeds: [archivedEmbed], components: [] });

                // Delete the session from storage
                delete currentSessions[sessionToDeleteId];
                saveSessions(currentSessions);

                await interaction.followUp({ content: `✅ Session with ID \`${targetSession.id}\` successfully ended and archived.`, ephemeral: true });

            } catch (error) {
                console.error('Error ending session:', error);
                await interaction.followUp({ content: '❌ Failed to end the session. Check bot permissions or verify the message ID/link.', ephemeral: true });
            }
        }
    }


    // --- Component (Button/Select Menu) Handling ---
    else if (interaction.isStringSelectMenu() || interaction.isButton()) {
        const customId = interaction.customId;
        // Correctly split the ID into two parts: action and session ID
        const parts = customId.split('_');
        const action = parts[0];
        const sessionId = parts[1]; // Now reliably the session ID

        const currentSessions = loadSessions();
        const currentSession = currentSessions[sessionId];

        if (!currentSession) {
            // FIX: Use deferUpdate() or deferReply() immediately to avoid the 10062 error
            if (interaction.isMessageComponent()) {
                await interaction.deferUpdate().catch(() => {}); // Safely defer to avoid crash
            }
            return interaction.reply({ content: '❌ This session is no longer active or the data was lost. Please ask a Host to create a new one.', ephemeral: true });
        }
        
        const member = interaction.member;
        const userId = member.id;

        // Helper to find existing role index
        const findRosterIndex = (session) => {
            const rosterCategories = ['drivers', 'staff', 'trainees'];
            for (const category of rosterCategories) {
                const index = session[category].findIndex(u => u.id === userId);
                if (index !== -1) {
                    return { category, index };
                }
            }
            return null; // User not found in any roster
        };
        
        // --- Sign Up Action (Select Menu) ---
        if (action === 'signup' && interaction.isStringSelectMenu()) {
            await interaction.deferReply({ ephemeral: true }); // Acknowledge immediately

            const roleToSignFor = interaction.values[0]; // e.g., 'driver', 'staff', 'trainee'
            const rosterCategory = roleToSignFor + 's'; // e.g., 'driver' -> 'drivers'
            
            // 1. Check if user is already signed up
            const existingEntry = findRosterIndex(currentSession);
            if (existingEntry) {
                // If they are signed up, move them (remove from old, add to new)
                if (existingEntry.category === rosterCategory) {
                    return interaction.followUp({ content: `✅ You are already signed up as **${roleToSignFor.toUpperCase()}**.`, ephemeral: true });
                }
                
                // If moving roles, remove from the old roster first
                currentSession[existingEntry.category].splice(existingEntry.index, 1);
            }

            // 2. Check Capacity
            const maxCapacity = currentSession[`max${roleToSignFor.charAt(0).toUpperCase() + roleToSignFor.slice(1)}s`];
            if (maxCapacity > 0 && currentSession[rosterCategory].length >= maxCapacity) {
                 // Revert the select menu change visually by editing the message without changing the selection
                return interaction.followUp({ content: `❌ The **${roleToSignFor.toUpperCase()}** roster is currently full (${maxCapacity}/${maxCapacity}). Please choose another role or try again later.`, ephemeral: true });
            }

            // 3. Add to the new roster
            currentSession[rosterCategory].push({ id: member.id, tag: member.user.tag });

            // 4. Update the data store
            currentSessions[sessionId] = currentSession;
            saveSessions(currentSessions);

            // 5. Update the Message Embed and Components
            const hostTag = await client.users.fetch(currentSession.hostId).then(user => user.tag).catch(() => 'Unknown Host');
            const updatedEmbed = createSessionEmbed(currentSession, hostTag);
            const updatedComponents = createActionRow(currentSession); // Rebuild components to update disabled state

            try {
                const messageChannel = await client.channels.fetch(currentSession.channelId);
                const messageToEdit = await messageChannel.messages.fetch(currentSession.messageId);

                await messageToEdit.edit({ embeds: [updatedEmbed], components: updatedComponents });

                await interaction.followUp({ content: `✅ You have successfully signed up as a **${roleToSignFor.toUpperCase()}**!`, ephemeral: true });

            } catch (error) {
                console.error('Error signing up and updating message:', error);
                await interaction.followUp({ content: '❌ Failed to update the session roster. Please try again.', ephemeral: true });
            }
        }
        
        // --- Cancel Signup Action (Button) ---
        else if (action === 'cancel' && interaction.isButton()) {
            await interaction.deferReply({ ephemeral: true }); // Acknowledge immediately
            
            const existingEntry = findRosterIndex(currentSession);

            if (!existingEntry) {
                 return interaction.followUp({ content: '❌ You are not currently signed up for this session.', ephemeral: true });
            }

            // 1. Remove user from the roster
            currentSession[existingEntry.category].splice(existingEntry.index, 1);

            // 2. Update the data store
            currentSessions[sessionId] = currentSession;
            saveSessions(currentSessions);

            // 3. Update the Message Embed and Components
            const hostTag = await client.users.fetch(currentSession.hostId).then(user => user.tag).catch(() => 'Unknown Host');
            const updatedEmbed = createSessionEmbed(currentSession, hostTag);
            const updatedComponents = createActionRow(currentSession); // Rebuild components to update disabled state

            try {
                const messageChannel = await client.channels.fetch(currentSession.channelId);
                const messageToEdit = await messageChannel.messages.fetch(currentSession.messageId);

                // Use the new components to ensure the Select Menu reflects available capacity correctly
                await messageToEdit.edit({ embeds: [updatedEmbed], components: updatedComponents });

                await interaction.followUp({ content: `✅ You have been successfully removed from the session roster.`, ephemeral: true });
            } catch (error) {
                console.error('Error cancelling signup and updating message:', error);
                await interaction.followUp({ content: '❌ Failed to cancel your signup. Please try again.', ephemeral: true });
            }
        }
    }
});


// --- Web Server for Render Uptime ---
// This simple web server must run to prevent the Render Free Web Service from sleeping.
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('POP DRIVING Bot is running!\n');
}).listen(port, () => {
    console.log(`Web server running on port ${port} (Required for Render uptime).`);
});


// Log the bot in
client.login(TOKEN);
