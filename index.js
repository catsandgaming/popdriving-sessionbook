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
// JUNIOR_STAFF_IDS is read as a comma-separated string and split into an array.
const JUNIOR_STAFF_IDS = process.env.JUNIOR_STAFF_IDS ? process.env.JUNIOR_STAFF_IDS.split(',') : []; 
const TRAINEE_ID = process.env.TRAINEE_ID;
const SESSIONS_FILE = 'sessions.json'; // Persistent storage for ongoing sessions

// --- Button Custom ID Constants ---
const SIGNUP_DRIVER = 'signup_driver';
const SIGNUP_TRAINEE = 'signup_trainee';
const SIGNUP_STAFF = 'signup_staff'; // Custom ID for the Staff button
const CHANGE_ROLE_PREFIX = 'change_role_';
const REMOVE_ROLE = 'remove_role';

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
 * Ensures the session data file exists and is readable.
 * @returns {object} The current sessions object.
 */
function loadSessions() {
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error('Failed to load sessions. Starting with empty state.', e);
    }
    return {};
}

/**
 * Saves the current session data to the file.
 * @param {object} sessions - The sessions object to save.
 */
function saveSessions(sessions) {
    try {
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
    } catch (e) {
        console.error('Failed to save sessions.', e);
    }
}

/**
 * Simple pluralization utility for session categories.
 * @param {string} role - The role name (e.g., 'driver', 'trainee', 'staff').
 * @returns {string} The plural form (e.g., 'drivers', 'trainees', 'staffs').
 */
function toRosterCategory(role) {
    // We treat 'staff' as a special case if needed, or rely on simple 's'
    if (role === 'staff') return 'staffs'; 
    return role + 's';
}

/**
 * Creates the embed for the session message.
 * @param {object} session - The current session object.
 * @param {string} hostTag - The Discord tag of the host.
 * @returns {EmbedBuilder} The constructed embed.
 */
function createSessionEmbed(session, hostTag) {
    const drivers = session.drivers.map(d => `<@${d.id}> (${d.tag})`).join('\n') || '*(None)*';
    const trainees = session.trainees.map(t => `<@${t.id}> (${t.tag})`).join('\n') || '*(None)*';
    const staffs = session.staffs.map(s => `<@${s.id}> (${s.tag})`).join('\n') || '*(None)*';

    return new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle(`POP Driving Session: ${session.sessionName}`)
        .setDescription(`Hosted by **${hostTag}** on <t:${Math.floor(session.timestamp / 1000)}:f> (<t:${Math.floor(session.timestamp / 1000)}:R>)`)
        .addFields(
            { name: 'Drivers', value: drivers, inline: true },
            { name: 'Trainees', value: trainees, inline: true },
            { name: 'Staff', value: staffs, inline: false } // Staff is set to full width
        )
        .setFooter({ text: `Session ID: ${session.id}` })
        .setTimestamp();
}

/**
 * Creates the interactive components (buttons/menu) for the session message.
 * This is where the Staff button is correctly added.
 * @param {string} sessionId - The ID of the session.
 * @returns {ActionRowBuilder[]} An array of ActionRowBuilders.
 */
function createSessionComponents(sessionId) {
    // Row 1: Sign up buttons
    const signupRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(SIGNUP_DRIVER)
                .setLabel('Sign up as Driver')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(SIGNUP_TRAINEE)
                .setLabel('Sign up as Trainee')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(SIGNUP_STAFF) // *** FIX FOR MISSING STAFF BUTTON ***
                .setLabel('Sign up as Staff')
                .setStyle(ButtonStyle.Secondary),
        );

    // Row 2: Management/Cancellation buttons (Host-only actions)
    const managementRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`cancel_session_${sessionId}`)
                .setLabel('Cancel Session')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(REMOVE_ROLE)
                .setLabel('Remove Sign-up')
                .setStyle(ButtonStyle.Secondary)
        );

    return [signupRow, managementRow];
}

/**
 * Utility to check if a user is a Host or Junior Staff.
 * @param {GuildMember} member - The member to check.
 * @returns {boolean} True if they are authorized to host.
 */
function isAuthorizedHost(member) {
    // Check if the member has the Host role or any Junior Staff role
    const juniorStaffRoleIds = JUNIOR_STAFF_IDS.filter(id => id.trim() !== '');
    return member.roles.cache.has(HOST_ID) || juniorStaffRoleIds.some(id => member.roles.cache.has(id));
}

/**
 * Edits a message robustly, specifically handling the DiscordAPIError 10008 (Unknown Message).
 * @param {Message} message - The message object to edit.
 * @param {object} options - The edit options (embeds, components).
 * @returns {boolean} True on success, false on failure (including message deletion).
 */
async function robustMessageEdit(message, options) {
    try {
        await message.edit(options);
        return true;
    } catch (error) {
        if (error.code === 10008) {
            // Error 10008: Unknown Message (message was deleted)
            console.warn(`Attempted to update a deleted message (ID: ${message.id}). This is expected if the message was manually deleted.`);
            return false;
        }
        console.error('Error during message edit:', error);
        return false;
    }
}


/**
 * Handles the logic for a user removing themselves from the session.
 * @param {ButtonInteraction} interaction - The interaction object.
 */
async function handleRoleRemovalExecution(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const currentSessions = loadSessions();
    const sessionId = Object.keys(currentSessions).find(id => currentSessions[id].messageId === interaction.message.id);

    if (!sessionId) {
        return interaction.editReply({ content: '❌ Could not find an active session linked to this message.' });
    }

    const currentSession = currentSessions[sessionId];
    const userId = interaction.user.id;
    let removed = false;
    let roleRemoved = '';

    // Check all rosters for the user and remove them
    for (const role of ['drivers', 'trainees', 'staffs']) {
        const initialLength = currentSession[role].length;
        currentSession[role] = currentSession[role].filter(member => member.id !== userId);
        if (currentSession[role].length < initialLength) {
            removed = true;
            roleRemoved = role.slice(0, -1); // 'drivers' -> 'driver'
            break;
        }
    }

    if (!removed) {
        return interaction.editReply({ content: '❌ You are not currently signed up for this session.' });
    }

    // Update the data store
    currentSessions[sessionId] = currentSession;
    saveSessions(currentSessions);

    // --- Update the Message Embed ---
    const hostTag = await client.users.fetch(currentSession.hostId).then(user => user.tag).catch(() => 'Unknown Host');
    const updatedEmbed = createSessionEmbed(currentSession, hostTag);

    // *** Use the robust message edit function ***
    const success = await robustMessageEdit(interaction.message, { embeds: [updatedEmbed], components: interaction.message.components });

    if (success) {
        return interaction.editReply({ content: `✅ You have been removed from the session roster (Role: **${roleRemoved.toUpperCase()}**).` });
    } else {
        // Message was deleted, but data was saved successfully
        return interaction.editReply({ content: `⚠️ Your sign-up data was successfully removed (Role: **${roleRemoved.toUpperCase()}**), but the original session message appears to have been deleted.` });
    }
}

/**
 * Handles the logic for a user changing their role.
 * @param {ButtonInteraction} interaction - The interaction object.
 * @param {string} newRole - The role to change to (e.g., 'driver', 'trainee', 'staff').
 */
async function handleRoleChangeExecution(interaction, newRole) {
    await interaction.deferReply({ ephemeral: true });

    const currentSessions = loadSessions();
    const sessionId = Object.keys(currentSessions).find(id => currentSessions[id].messageId === interaction.message.id);

    if (!sessionId) {
        return interaction.editReply({ content: '❌ Could not find an active session linked to this message.' });
    }

    const currentSession = currentSessions[sessionId];
    const userId = interaction.user.id;
    const newRosterCategory = toRosterCategory(newRole);
    let oldRosterCategory = null;
    let oldRole = null;

    // 1. Check current sign-up status and identify the old role
    for (const role of ['drivers', 'trainees', 'staffs']) {
        const memberIndex = currentSession[role].findIndex(member => member.id === userId);
        if (memberIndex !== -1) {
            oldRosterCategory = role;
            oldRole = role.slice(0, -1); // 'drivers' -> 'driver'
            // If they are already in the target role, stop
            if (oldRosterCategory === newRosterCategory) {
                return interaction.editReply({ content: `ℹ️ You are already signed up as **${newRole.toUpperCase()}**!` });
            }
            // Remove them from the old role
            currentSession[role].splice(memberIndex, 1);
            break;
        }
    }

    if (!oldRosterCategory) {
        return interaction.editReply({ content: '❌ You are not currently signed up for this session. Please sign up first.' });
    }

    // 2. Add the user to the new role
    const member = interaction.member;
    currentSession[newRosterCategory].push({ id: member.id, tag: member.user.tag });

    // 3. Update the data store
    currentSessions[sessionId] = currentSession;
    saveSessions(currentSessions);

    // 4. Update the Message Embed
    const hostTag = await client.users.fetch(currentSession.hostId).then(user => user.tag).catch(() => 'Unknown Host');
    const updatedEmbed = createSessionEmbed(currentSession, hostTag);

    // *** Use the robust message edit function to fix the Unknown Message error ***
    const success = await robustMessageEdit(interaction.message, { embeds: [updatedEmbed], components: interaction.message.components });

    if (success) {
        return interaction.editReply({ content: `🔄 Successfully changed your role from **${oldRole.toUpperCase()}** to **${newRole.toUpperCase()}**!` });
    } else {
        // Message was deleted, but data was saved successfully
        return interaction.editReply({ content: `⚠️ Your role change from **${oldRole.toUpperCase()}** to **${newRole.toUpperCase()}** was saved to internal data, but the original session message appears to have been deleted.` });
    }
}


// --- Events ---

client.on('ready', () => {
    console.log(`Bot is logged in as ${client.user.tag}!`);

    // Setup web server for Render health check
    http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Web server running on port 10000 (Required for Render uptime).');
    }).listen(10000);
});

client.on('interactionCreate', async interaction => {
    // --- 1. Slash Command Handling (/sessionbook) ---
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        if (commandName === 'sessionbook') {
            await interaction.deferReply({ ephemeral: true });

            const member = interaction.member;
            
            // Check for Host/Junior Staff permissions
            if (!isAuthorizedHost(member)) {
                return interaction.editReply({ content: '❌ You do not have permission to start a driving session.' });
            }

            const sessionName = interaction.options.getString('name');
            const sessionDate = interaction.options.getString('date');
            
            // Create a unique session ID
            const sessionId = Date.now().toString();

            // Create initial session object
            const newSession = {
                id: sessionId,
                hostId: member.id,
                sessionName: sessionName,
                dateString: sessionDate,
                // Use a standard date object for relative time in embed
                timestamp: new Date(sessionDate).getTime(), 
                channelId: interaction.channelId,
                drivers: [],
                trainees: [],
                staffs: [] // Initial empty roster for staff
            };

            // Get the host's tag for the embed
            const hostTag = member.user.tag; 
            const sessionEmbed = createSessionEmbed(newSession, hostTag);
            const components = createSessionComponents(sessionId);

            // Send the main, persistent session message
            const sentMessage = await interaction.channel.send({ 
                embeds: [sessionEmbed], 
                components: components 
            });

            // Store the message ID for future edits
            newSession.messageId = sentMessage.id;

            // Save the session state
            const currentSessions = loadSessions();
            currentSessions[sessionId] = newSession;
            saveSessions(currentSessions);

            return interaction.editReply({ content: `✅ Session **${sessionName}** created successfully! See the message below.`, ephemeral: true });
        }
    }

    // --- 2. Button Interaction Handling (Sign-up, Change Role, Remove, Cancel) ---
    if (interaction.isButton()) {
        const customId = interaction.customId;
        const currentSessions = loadSessions();
        
        // --- Cancel Session ---
        if (customId.startsWith('cancel_session_')) {
            const sessionId = customId.replace('cancel_session_', '');

            if (!currentSessions[sessionId]) {
                return interaction.reply({ content: '❌ Session not found.', ephemeral: true });
            }

            const session = currentSessions[sessionId];
            
            // Authorization check: Only the host or an authorized host can cancel
            if (interaction.user.id !== session.hostId && !isAuthorizedHost(interaction.member)) {
                return interaction.reply({ content: '❌ Only the session host or authorized staff can cancel this session.', ephemeral: true });
            }

            // Delete the session message first
            try {
                await interaction.message.delete();
            } catch (e) {
                console.error('Failed to delete session message on cancel:', e);
            }

            // Remove session from data store
            delete currentSessions[sessionId];
            saveSessions(currentSessions);

            return interaction.reply({ content: `🗑️ Session **${session.sessionName}** has been successfully cancelled and removed.`, ephemeral: true });
        }

        // --- Remove Sign-up ---
        if (customId === REMOVE_ROLE) {
            return handleRoleRemovalExecution(interaction);
        }
        
        // --- Change Role Logic (Example: change_role_driver) ---
        // This is a placeholder for a more complex role change menu, but if the user
        // clicks a button with a change_role_ prefix, we handle it here.
        if (customId.startsWith(CHANGE_ROLE_PREFIX)) {
            const newRole = customId.replace(CHANGE_ROLE_PREFIX, '');
            return handleRoleChangeExecution(interaction, newRole);
        }

        // --- Sign-up Logic ---
        if (customId.startsWith('signup_')) {
            await interaction.deferReply({ ephemeral: true });
            
            // Get the role string (e.g., 'driver', 'trainee', 'staff')
            const roleToSignFor = customId.replace('signup_', '');
            
            const sessionId = Object.keys(currentSessions).find(id => currentSessions[id].messageId === interaction.message.id);

            if (!sessionId) {
                return interaction.editReply({ content: '❌ Could not find an active session linked to this message.' });
            }

            const currentSession = currentSessions[sessionId];
            const member = interaction.member;
            const userId = member.id;
            
            // 1. Check if the user is already signed up
            for (const role of ['drivers', 'trainees', 'staffs']) {
                if (currentSession[role].some(m => m.id === userId)) {
                    // If they are signed up, offer to change role
                    return interaction.editReply({ 
                        content: `ℹ️ You are already signed up as **${role.slice(0, -1).toUpperCase()}**. Would you like to change your role to **${roleToSignFor.toUpperCase()}**?`,
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId(`${CHANGE_ROLE_PREFIX}${roleToSignFor}`)
                                    .setLabel(`Change to ${roleToSignFor}`)
                                    .setStyle(ButtonStyle.Success)
                            )
                        ]
                    });
                }
            }
            
            // 2. Determine the correct roster category (e.g., 'driver' -> 'drivers')
            const rosterCategory = toRosterCategory(roleToSignFor);

            // Ensure the category exists (safety check)
            if (!currentSession[rosterCategory] || !Array.isArray(currentSession[rosterCategory])) {
                console.warn(`Roster category '${rosterCategory}' missing or invalid in session ${sessionId}. Initializing as empty array.`);
                currentSession[rosterCategory] = []; 
            }
            
            // 3. Add the user to the roster
            currentSession[rosterCategory].push({ id: member.id, tag: member.user.tag });

            // Update the data store
            currentSessions[sessionId] = currentSession;
            saveSessions(currentSessions);

            // 4. Update the Message Embed
            const hostTag = await client.users.fetch(currentSession.hostId).then(user => user.tag).catch(() => 'Unknown Host');
            const updatedEmbed = createSessionEmbed(currentSession, hostTag);

            // *** Use the robust message edit function to fix the Unknown Message error ***
            const success = await robustMessageEdit(interaction.message, { embeds: [updatedEmbed], components: interaction.message.components });

            if (success) {
                return interaction.editReply({ content: `✅ You have successfully signed up as a **${roleToSignFor.toUpperCase()}**!` });
            } else {
                // Message was deleted, but data was saved successfully
                return interaction.editReply({ content: `⚠️ Your internal sign-up data was updated as **${roleToSignFor.toUpperCase()}**, but the original session message appears to have been deleted.` });
            }
        }
    }
});

// --- Register Slash Commands and Log in ---

client.on('ready', async () => {
    // Register the slash command
    const commands = [
        new SlashCommandBuilder()
            .setName('sessionbook')
            .setDescription('Creates a new driving session sign-up sheet.')
            .addStringOption(option => 
                option.setName('name')
                    .setDescription('The name of the driving session (e.g., Friday Night Run)')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('date')
                    .setDescription('The date and time of the session (e.g., 2025-10-15 19:00 UTC)')
                    .setRequired(true))
            .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels) // Example permission check
            .toJSON(),
    ];

    try {
        const guild = client.guilds.cache.first(); // Assuming the bot is only in one guild for simplicity
        if (guild) {
            await guild.commands.set(commands);
            console.log('Slash command /sessionbook registered successfully.');
        } else {
             console.log('Bot is not in any guild, cannot register commands.');
        }
    } catch (error) {
        console.error('Error registering slash commands:', error);
    }
});


// Log the bot in
client.login(TOKEN);
