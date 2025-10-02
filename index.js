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
    StringSelectMenuBuilder, // NEW: Needed for staff management dropdowns
    StringSelectMenuOptionBuilder // NEW: Needed for dropdown options
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
 * Checks if a member has the Host or Junior Staff role.
 * @param {GuildMember} member The member to check.
 * @returns {boolean} True if the member is staff or host.
 */
function isHostOrStaff(member) {
    const hostCheck = member.roles.cache.has(HOST_ID);
    const juniorStaffCheck = JUNIOR_STAFF_IDS.some(id => member.roles.cache.has(id));
    return hostCheck || juniorStaffCheck || member.user.id === member.guild.ownerId;
}

/**
 * Removes a user from all roster categories and optionally adds them to a new one.
 * Used for both staff management and user self-correction.
 * @param {object} session The current session object.
 * @param {string} userId The ID of the user to modify.
 * @param {string} userTag The tag/username of the user (e.g., 'User#1234').
 * @param {string | null} newRole The new role category ('driver', 'staff', 'trainee') or null to just remove.
 * @returns {object} The modified session object.
 */
function updateRosterRole(session, userId, userTag, newRole) {
    const allCategories = ['drivers', 'staff', 'trainees'];

    // 1. Remove user from ALL categories first (Handles self-correction/role change)
    allCategories.forEach(category => {
        session[category] = (session[category] || []).filter(m => m.id !== userId);
    });

    // 2. Add user to the new category if specified
    if (newRole) {
        const rosterCategory = newRole + 's';
        if (!session[rosterCategory]) {
            session[rosterCategory] = [];
        }
        // Ensure the user object being pushed is consistent with the initial signup structure
        session[rosterCategory].push({ id: userId, tag: userTag });
    }

    return session;
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
 * Now returns an array of ActionRowBuilder for multiple rows.
 * @returns {ActionRowBuilder[]} The array of action rows.
 */
function createSessionButtons() {
    // --- Row 1: Public Signups and Session Control ---
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

    const publicRow = new ActionRowBuilder().addComponents(signupDriverButton, signupStaffButton, signupTraineeButton, closeSessionButton);
    
    // --- Row 2: Staff Management ---
    // This button is visible to all, but only actionable by staff.
    const manageRosterButton = new ButtonBuilder()
        .setCustomId('manage_roster_staff')
        .setLabel('Change Role (Staff Only)')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔄');

    const staffRow = new ActionRowBuilder().addComponents(manageRosterButton);

    return [publicRow, staffRow];
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

// NEW: Add handler for Select Menus
client.on('interactionCreate', async interaction => {
    if (interaction.isCommand()) {
        if (interaction.commandName === 'sessionbook') {
            await handleSessionBookCommand(interaction);
        }
    } else if (interaction.isButton()) {
        await handleSessionButtonInteraction(interaction);
    } else if (interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith('select_user_')) {
            await handleUserSelectionForRoleChange(interaction);
        } else if (interaction.customId.startsWith('select_new_role_')) {
            await handleRoleChangeExecution(interaction);
        }
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
        const components = createSessionButtons(); // This is now an array of ActionRowBuilder

        // Send the message to the specified channel
        const message = await targetChannel.send({
            embeds: [initialEmbed],
            components: components // Send the array
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
 * Handles button interactions for session signups, closing, and staff management.
 */
async function handleSessionButtonInteraction(interaction) {
    if (!interaction.customId.startsWith('signup_') && interaction.customId !== 'close_session' && interaction.customId !== 'manage_roster_staff') return;

    // CRITICAL FIX: Defer reply ephemerally to give the bot more time to process and avoid "Unknown Interaction" errors.
    await interaction.deferReply({ ephemeral: true }); 

    // Find the session associated with the message the button was clicked on
    let currentSessions = loadSessions();
    const sessionId = Object.keys(currentSessions).find(key => currentSessions[key].messageId === interaction.message.id);

    if (!sessionId) {
        console.error(`Session ID not found for message ID: ${interaction.message.id}`);
        return interaction.editReply({ content: '❌ Could not find an active session associated with this message. **Please ask the host to start a new session!**' });
    }

    let currentSession = currentSessions[sessionId];
    const member = interaction.guild.members.cache.get(interaction.user.id);
    const isStaff = isHostOrStaff(member);


    if (interaction.customId === 'manage_roster_staff') {
        // --- Handle Staff Roster Management Button Click ---
        if (!isStaff) {
            return interaction.editReply({ content: '❌ This button is for Host and Staff members only.' });
        }
        if (currentSession.status !== 'open') {
            return interaction.editReply({ content: '❌ Cannot manage roster for a closed session.' });
        }

        const allSignedUpUsers = [
            ...currentSession.drivers.map(u => ({ id: u.id, tag: u.tag, role: 'Driver' })),
            ...currentSession.staff.map(u => ({ id: u.id, tag: u.tag, role: 'Staff' })),
            ...currentSession.trainees.map(u => ({ id: u.id, tag: u.tag, role: 'Trainee' }))
        ];

        if (allSignedUpUsers.length === 0) {
            return interaction.editReply({ content: '❌ There are no users signed up yet to manage.' });
        }

        // Create the Select Menu with options for all signed-up users
        const userOptions = allSignedUpUsers.map(user => 
            new StringSelectMenuOptionBuilder()
                .setLabel(`${user.tag} (${user.role})`)
                .setValue(user.id)
                .setDescription(`Current Role: ${user.role}`)
        );

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`select_user_${sessionId}`)
            .setPlaceholder('Select a user to change their role...')
            .addOptions(userOptions)
            .setMinValues(1)
            .setMaxValues(1);
        
        const actionRow = new ActionRowBuilder().addComponents(selectMenu);

        return interaction.editReply({
            content: `**Roster Management for Session ID: ${sessionId}**\n\nSelect the user whose role you need to change.`,
            components: [actionRow]
        });


    } else if (interaction.customId === 'close_session') {
        // --- Handle Close Session ---
        if (!isStaff) { // Check for Host/Staff/Owner access
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
            // NOTE: We fetch the components dynamically as the components property on interaction.message is deprecated/not always reliable.
            await interaction.message.edit({ embeds: [updatedEmbed], components: [] }); 
            
            // Final confirmation to the user who clicked the button via editReply
            return interaction.editReply({ content: `✅ The session has been marked as closed and the buttons have been removed from the message.` });

        } catch (error) {
            console.error('Error closing session:', error);
            return interaction.editReply({ content: '❌ Failed to close the session and update the message.' });
        }

    } else if (interaction.customId.startsWith('signup_')) {
        // --- Handle Sign-up (with Self-Correction/Role Change) ---
        if (currentSession.status !== 'open') {
            return interaction.editReply({ content: '❌ This session is already closed for signups.' });
        }

        const customId = interaction.customId; // e.g., 'signup_driver'
        const roleToSignFor = customId.split('_')[1]; // 'driver', 'staff', or 'trainee'

        // --- 1. Role Check (using the stored IDs in .env) ---
        let hasRequiredRole = true;
        if (roleToSignFor === 'staff') {
            const hasStaffRole = JUNIOR_STAFF_IDS.some(id => member.roles.cache.has(id)) || member.roles.cache.has(HOST_ID);
            if (!hasStaffRole) {
                hasRequiredRole = false;
                return interaction.editReply({ content: '❌ You must be a Staff or Session Host to sign up as Staff.' });
            }
        } else if (roleToSignFor === 'trainee') {
            const hasTraineeRole = member.roles.cache.has(TRAINEE_ID);
            if (!hasTraineeRole) {
                hasRequiredRole = false;
                return interaction.editReply({ content: '❌ You must have the Trainee role to sign up as a Trainee.' });
            }
        }
        
        // --- 2. Check for Role Change ---
        const allRosterCategories = ['drivers', 'staff', 'trainees'];
        let currentRole = null;
        for (const category of allRosterCategories) {
            if ((currentSession[category] || []).some(m => m.id === interaction.user.id)) {
                currentRole = category.slice(0, -1); // 'drivers' -> 'driver'
                break;
            }
        }
        
        if (currentRole === roleToSignFor) {
            // If already signed up for this role, treat as an attempt to cancel
            currentSession = updateRosterRole(currentSession, member.id, member.user.tag, null); // Remove user
            const hostTag = await client.users.fetch(currentSession.hostId).then(user => user.tag).catch(() => 'Unknown Host');
            const updatedEmbed = createSessionEmbed(currentSession, hostTag);
            currentSessions[sessionId] = currentSession;
            saveSessions(currentSessions);
            await interaction.message.edit({ embeds: [updatedEmbed], components: interaction.message.components });
            return interaction.editReply({ content: `✅ You have successfully **cancelled** your signup as a **${roleToSignFor.toUpperCase()}**!` });
        }


        // --- 3. Add the Member to the Session Roster (Handles change and new signup) ---
        currentSession = updateRosterRole(currentSession, member.id, member.user.tag, roleToSignFor);

        // Update the data store
        currentSessions[sessionId] = currentSession;
        saveSessions(currentSessions);

        // --- 4. Update the Message Embed ---
        const hostTag = await client.users.fetch(currentSession.hostId).then(user => user.tag).catch(() => 'Unknown Host');
        const updatedEmbed = createSessionEmbed(currentSession, hostTag);

        try {
            // Edit the original message (from interaction.message) with the updated embed
            // We ensure existing components (buttons) are preserved.
            await interaction.message.edit({ embeds: [updatedEmbed], components: interaction.message.components });

            // Final confirmation to the user who clicked the button via editReply
            const action = currentRole ? 'changed your role to' : 'signed up as';
            return interaction.editReply({ 
                content: `✅ You have successfully **${action}** a **${roleToSignFor.toUpperCase()}**!`,
            });

        } catch (error) {
            console.error('Error signing up and updating message:', error);
            return interaction.editReply({ content: '❌ Failed to update the session roster. Please try again.' });
        }
    }
}

/**
 * Handles the first Select Menu interaction (Staff selects a user).
 */
async function handleUserSelectionForRoleChange(interaction) {
    // CRITICAL: Defer to prevent timeout
    await interaction.deferReply({ ephemeral: true });

    const member = interaction.guild.members.cache.get(interaction.user.id);
    if (!isHostOrStaff(member)) {
        return interaction.editReply({ content: '❌ You do not have permission to manage the roster.' });
    }

    const sessionId = interaction.customId.split('_')[2];
    const selectedUserId = interaction.values[0];
    const userToChange = await client.users.fetch(selectedUserId);

    // Create the second Select Menu for the target role
    const newRoleSelectMenu = new StringSelectMenuBuilder()
        .setCustomId(`select_new_role_${sessionId}_${selectedUserId}`)
        .setPlaceholder(`Change ${userToChange.tag}'s role to...`)
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Driver 🚗')
                .setValue('driver')
                .setEmoji('🚗'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Staff 🛠️')
                .setValue('staff')
                .setEmoji('🛠️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Trainee 👨‍🎓')
                .setValue('trainee')
                .setEmoji('👨‍🎓'),
            new StringSelectMenuOptionBuilder()
                .setLabel('REMOVE from Roster 🗑️')
                .setValue('remove')
                .setEmoji('🗑️').setDescription('Completely remove this user from the session.')
        );
    
    const actionRow = new ActionRowBuilder().addComponents(newRoleSelectMenu);

    return interaction.editReply({
        content: `You selected **${userToChange.tag}**. Now, choose their new role or remove them from the roster.`,
        components: [actionRow]
    });
}

/**
 * Handles the second Select Menu interaction (Staff selects the new role and executes the change).
 */
async function handleRoleChangeExecution(interaction) {
    // CRITICAL: Defer to prevent timeout
    await interaction.deferReply({ ephemeral: true });

    const member = interaction.guild.members.cache.get(interaction.user.id);
    if (!isHostOrStaff(member)) {
        return interaction.editReply({ content: '❌ You do not have permission to execute this change.' });
    }
    
    // Custom ID is 'select_new_role_[sessionId]_[userId]'
    const parts = interaction.customId.split('_');
    const sessionId = parts[3];
    const targetUserId = parts[4];
    const newRole = interaction.values[0]; // 'driver', 'staff', 'trainee', or 'remove'

    let currentSessions = loadSessions();
    let currentSession = currentSessions[sessionId];

    if (!currentSession) {
        return interaction.editReply({ content: '❌ Session data could not be found. The session might have been reset.' });
    }

    const targetUser = await client.users.fetch(targetUserId).catch(() => null);
    if (!targetUser) {
        return interaction.editReply({ content: '❌ Target user not found in Discord cache.' });
    }

    // Execute the roster update
    const roleAction = newRole === 'remove' ? null : newRole;
    currentSession = updateRosterRole(currentSession, targetUserId, targetUser.tag, roleAction);

    // Save changes
    currentSessions[sessionId] = currentSession;
    saveSessions(currentSessions);

    // Update the message embed
    const hostTag = await client.users.fetch(currentSession.hostId).then(user => user.tag).catch(() => 'Unknown Host');
    const updatedEmbed = createSessionEmbed(currentSession, hostTag);

    try {
        await interaction.message.edit({ embeds: [updatedEmbed], components: interaction.message.components });

        const confirmationMessage = newRole === 'remove'
            ? `✅ **${targetUser.tag}** has been completely **REMOVED** from the roster.`
            : `✅ **${targetUser.tag}**'s role has been successfully changed to **${newRole.toUpperCase()}**.`;

        return interaction.editReply({ content: confirmationMessage, components: [] }); // Remove the select menu components

    } catch (error) {
        console.error('Error executing role change and updating message:', error);
        return interaction.editReply({ content: '❌ Failed to update the message after role change.' });
    }
}

// Log the bot in
client.login(TOKEN);
