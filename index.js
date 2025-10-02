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

/** Reads session data from the JSON file. */
function getSessions() {
    try {
        // Read the file synchronously and parse it as JSON
        const data = fs.readFileSync(SESSIONS_FILE);
        return JSON.parse(data);
    } catch (error) {
        // If the file is missing or invalid, return an empty object to start fresh
        if (error.code === 'ENOENT') {
            console.log('sessions.json not found, starting fresh.');
        } else {
            console.error('Error reading sessions.json, returning empty object:', error.message);
        }
        return {}; 
    }
}

/** Writes session data to the JSON file. */
function saveSessions(sessions) {
    try {
        // Write the JavaScript object back to the JSON file, formatted nicely (2 spaces)
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
    } catch (error) {
        console.error('Error writing to sessions.json:', error.message);
    }
}

/**
 * Creates the dynamic session embed based on current roster data.
 * @param {object} sessionData - The stored session information.
 * @param {string} hostTag - The Discord tag of the host.
 * @returns {EmbedBuilder} The constructed embed.
 */
function createSessionEmbed(sessionData, hostTag) {
    const { time, duration, location, ...roster } = sessionData;

    // Helper to format the list of users in a category
    const formatRosterList = (users, category) => {
        if (!users || users.length === 0) {
            // Display a fun placeholder if no one has signed up for that category yet
            return `*No ${category} signed up yet!*`;
        }
        return users.map(user => `- <@${user.id}>`).join('\n');
    };

    // Filter out the non-roster properties to get just the signup lists
    const driverList = formatRosterList(roster.drivers, 'Drivers');
    const staffList = formatRosterList(roster.staff, 'Staff');
    const traineeList = formatRosterList(roster.trainees, 'Trainees');

    return new EmbedBuilder()
        .setColor(0x0099ff) // A nice blue color
        .setTitle('POP DRIVING Official Training Session!')
        .setDescription(`A new driving session has been scheduled by **${hostTag}**. Click the button to secure your spot!`)
        .addFields(
            { name: '📅 Time', value: time, inline: true },
            { name: '⏱️ Duration', value: duration, inline: true },
            { name: '📍 Location', value: location, inline: true },
            { name: '\u200b', value: '\u200b', inline: false }, // Zero-width space for spacing

            { name: `🚗 Drivers Roster (${roster.drivers.length})`, value: driverList, inline: false },
            { name: `🛠️ Staff Roster (${roster.staff.length})`, value: staffList, inline: true },
            { name: `🎓 Trainee Roster (${roster.trainees.length})`, value: traineeList, inline: true }
        )
        .setFooter({ text: 'Use /session-end to archive this session after it concludes.' })
        .setTimestamp();
}

/**
 * Removes a user from all roster categories.
 * @param {object} session - The current session object including roster arrays.
 * @param {string} userId - ID of the user to remove.
 * @returns {object} The updated session object.
 */
function removeUserFromRoster(session, userId) {
    const categories = ['drivers', 'staff', 'trainees'];
    for (const category of categories) {
        if (Array.isArray(session[category])) {
            session[category] = session[category].filter(user => user.id !== userId);
        }
    }
    return session;
}

// --- Bot Ready Event ---
client.on('ready', async () => {
    console.log(`Bot is logged in as ${client.user.tag}!`);

    // --- Slash Command Registration ---
    // Define the /session-book command structure
    const commands = [
        new SlashCommandBuilder()
            .setName('session-book')
            .setDescription('Books a new driving session and creates the signup post.')
            .addStringOption(option =>
                option.setName('time')
                    .setDescription('The date and time of the session (e.g., Saturday @ 8 PM EST)')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('duration')
                    .setDescription('The estimated duration (e.g., 1 hour)')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('location')
                    .setDescription('The server/game location (e.g., Private Server #1)')
                    .setRequired(true))
            .addChannelOption(option =>
                option.setName('channel')
                    .setDescription('The channel where the announcement should be posted')
                    .setRequired(true)),
    ].map(command => command.toJSON());

    try {
        // Register commands globally so they appear in Discord
        await client.application.commands.set(commands);
        console.log('Slash commands registered successfully.');
    } catch (error) {
        console.error('Failed to register slash commands:', error);
    }
    
    // --- START WEB SERVER FOR REPLIT UPTIME (NEW CODE) ---
    // Replit requires a running web server process to keep the project active.
    const server = http.createServer((req, res) => {
        // This is the endpoint the pinger service will hit every few minutes
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('POP DRIVING Bot is running!');
    });

    // Replit automatically sets the PORT environment variable
    const port = process.env.PORT || 3000;
    server.listen(port, () => {
        console.log(`Web server running on port ${port} (Required for Replit uptime).`);
    });
});

// --- Command Handling (/session-book) ---
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    if (interaction.commandName === 'session-book') {
        // --- 1. Permission Check for Session Host ---
        const member = interaction.member;
        if (!member.roles.cache.has(HOST_ID)) {
            return interaction.reply({ 
                content: `❌ **Permission Denied!** You must have the <@&${HOST_ID}> role to book a session.`, 
                ephemeral: true 
            });
        }

        await interaction.deferReply({ ephemeral: true });

        // Get command options
        const time = interaction.options.getString('time');
        const duration = interaction.options.getString('duration');
        const location = interaction.options.getString('location');
        const announcementChannel = interaction.options.getChannel('channel');

        if (!announcementChannel || announcementChannel.type !== 0) { // 0 is GuildText
             return interaction.editReply({ content: '❌ Please select a valid text channel for the announcement.' });
        }
        
        // Initial Roster Setup
        const sessionData = {
            id: Date.now().toString(),
            time: time,
            duration: duration,
            location: location,
            hostId: member.id,
            drivers: [],
            staff: [],
            trainees: []
        };
        
        // Create the initial embed and button
        const initialEmbed = createSessionEmbed(sessionData, interaction.user.tag);
        
        // Setup the interactive buttons
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`signup_button_${sessionData.id}`)
                .setLabel('Sign Up Here 🖊️')
                .setStyle(ButtonStyle.Success), 
            new ButtonBuilder()
                .setCustomId(`cancel_button_${sessionData.id}`)
                .setLabel('Cancel Signup ✖️')
                .setStyle(ButtonStyle.Danger),
        );

        try {
            // Post the message and save its IDs
            const message = await announcementChannel.send({ embeds: [initialEmbed], components: [row] });
            sessionData.messageId = message.id;
            sessionData.channelId = message.channelId;

            // Save the new session data to sessions.json
            const sessions = getSessions();
            sessions[sessionData.id] = sessionData;
            saveSessions(sessions);

            await interaction.editReply({ content: `✅ Session successfully booked! See announcement in ${announcementChannel.toString()}.` });

        } catch (error) {
            console.error('Error posting session announcement:', error);
            await interaction.editReply({ content: '❌ Failed to post the announcement. Check bot permissions in the target channel.' });
        }
    }
});

// --- Interaction Handling (Signup Buttons and Select Menu) ---
client.on('interactionCreate', async interaction => {
    // Check for Button interaction (The initial "Sign Up" click)
    if (interaction.isButton()) {
        const [action, , sessionId] = interaction.customId.split('_'); 

        if (!sessionId) return;

        const sessions = getSessions();
        const session = sessions[sessionId];
        if (!session) return interaction.reply({ content: '❌ This session could not be found or has ended.', ephemeral: true });

        if (action === 'signup') {
            // --- 2. Show Role Selection Menu ---
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`role_select_${sessionId}`)
                .setPlaceholder('Choose your role for this session...')
                .addOptions([
                    { label: 'Driver 🚗', value: 'driver', description: 'Anyone can join as a Driver.' },
                    { label: 'Staff 🛠️', value: 'staff', description: 'Requires Junior Staff role or higher.' },
                    { label: 'Trainee 🎓', value: 'trainee', description: 'Requires Trainee Training role only.' },
                ]);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            await interaction.reply({
                content: 'Please select the role you are signing up for:',
                components: [row],
                ephemeral: true // Only the user who clicked sees this menu
            });
        }
        else if (action === 'cancel') {
             await interaction.deferUpdate();

             let currentSessions = getSessions();
             let currentSession = currentSessions[sessionId];
             if (!currentSession) return;
             
             // Remove the user from all categories
             currentSession = removeUserFromRoster(currentSession, interaction.user.id);

             // Update the data store
             currentSessions[sessionId] = currentSession;
             saveSessions(currentSessions);

             // Re-render the embed
             const hostTag = await client.users.fetch(currentSession.hostId).then(user => user.tag).catch(() => 'Unknown Host');
             const updatedEmbed = createSessionEmbed(currentSession, hostTag);
             
             try {
                const messageChannel = await client.channels.fetch(currentSession.channelId);
                const messageToEdit = await messageChannel.messages.fetch(currentSession.messageId);
                await messageToEdit.edit({ embeds: [updatedEmbed], components: messageToEdit.components }); // Preserve buttons

                await interaction.followUp({ content: '✅ You have been successfully removed from the session roster.', ephemeral: true });
             } catch (error) {
                console.error('Error cancelling signup and updating message:', error);
                await interaction.followUp({ content: '❌ Failed to update the session roster. Please try again.', ephemeral: true });
             }
        }
    }

    // Check for Select Menu interaction (Role selection)
    if (interaction.isStringSelectMenu()) {
        const [action, sessionId] = interaction.customId.split('_');
        if (action !== 'role_select') return; // Note: Use role_select as defined above

        await interaction.deferUpdate();

        const roleToSignFor = interaction.values[0]; // 'driver', 'staff', or 'trainee'
        const member = interaction.member;
        
        // --- 3. Role Restriction Checks ---
        if (roleToSignFor === 'staff') {
            // Staff check: Must have ANY of the JUNIOR_STAFF_IDS OR the HOST_ID
            const requiredStaffRoles = [HOST_ID, ...JUNIOR_STAFF_IDS];
            // Check if the user has at least one of the required roles
            const hasRequiredStaffRole = requiredStaffRoles.some(roleId => member.roles.cache.has(roleId));

            if (!hasRequiredStaffRole) {
                // Creates a list of role mentions for the error message
                const roleMentions = JUNIOR_STAFF_IDS.map(id => `<@&${id}>`).join(' or ');
                
                return interaction.followUp({ 
                    content: `❌ **Permission Denied!** You must have the ${roleMentions} role or higher (Session Host) to sign up as Staff.`, 
                    ephemeral: true 
                });
            }
        } else if (roleToSignFor === 'trainee') {
            // Trainee check: Must have the exact TRAINEE_ID role
            if (!member.roles.cache.has(TRAINEE_ID)) {
                return interaction.followUp({ 
                    content: `❌ **Permission Denied!** You must have the <@&${TRAINEE_ID}> role to sign up as Trainee.`, 
                    ephemeral: true 
                });
            }
        }

        // --- 4. Roster Update Logic ---
        let currentSessions = getSessions();
        let currentSession = currentSessions[sessionId];
        if (!currentSession) return;

        // Remove the user from any other category first (ensure they only occupy one slot)
        currentSession = removeUserFromRoster(currentSession, member.id);

        // Add user to the selected category
        const rosterCategory = roleToSignFor + 's'; // e.g., 'driver' -> 'drivers'
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
});


// Log the bot in
client.login(TOKEN);