require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    Events,
} = require('discord.js');

// 1. Initialize Discord Client with necessary intents for roles and guild info
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers, // Required to fetch roles for sign-ups
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// --- In-memory Session State ---
// This stores the state of the *most recent* session message posted by the bot.
let activeSessionMessageId = null; 

let sessionData = {
    channelId: null, 
    host: null,
    time: null,
    duration: null, 
    driver: [],
    trainee: [],
    junior: [],
    isClosed: false 
};

// --- Configuration ---
// These role names must EXACTLY match the role names on your Discord server (case-sensitive).
const ROLE_NAMES = {
    driver: 'Driver',
    trainee: 'Trainee',
    // FIX: Updated the required role name for junior sign-up to match 'Junior Trainer' 
    junior: 'Junior Trainer', 
    pop_staff: 'POP Staff' // Role for staff who can close any session
};

// --- List of internal role keys used in sessionData ---
const SESSION_ROLE_KEYS = ['driver', 'trainee', 'junior'];

/**
 * Conditionally returns the ActionRow components (buttons) based on the session state.
 * If the session is closed, no buttons are returned.
 * @returns {ActionRowBuilder[]} An array of ActionRowBuilders containing buttons.
 */
function getButtons() {
    // ⛔ If the session is closed, remove all buttons. 
    if (sessionData.isClosed) {
        return []; 
    }

    // Sign-up buttons row
    const signUpButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('signup_driver').setLabel(ROLE_NAMES.driver).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('signup_trainee').setLabel(ROLE_NAMES.trainee).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('signup_junior').setLabel(ROLE_NAMES.junior).setStyle(ButtonStyle.Success),
        // The 'Cancel Slot' button has been removed as requested.
    );

    // Session management buttons row (only Close Session in this case)
    const managementButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('close_session').setLabel('Close Session').setStyle(ButtonStyle.Danger) 
    );
    
    // If open, show all buttons
    return [signUpButtons, managementButton];
}


client.once(Events.ClientReady, () => {
    console.log(`\nLogged in as ${client.user.tag}`);
    console.log('Bot is ready and listening for /sessionbook slash commands.');
});

/**
 * Generates the content of the session message based on current sessionData.
 * @returns {object} The message payload (content string).
 */
function generateSessionContent() {
    const time = sessionData.time || 'TBD';
    const duration = sessionData.duration || 'TBD';

    let statusLine = sessionData.isClosed ? '⛔ **SESSION CLOSED** ⛔\n' : '';

    const content = `${statusLine}🚗 **Driving Session**
Host: ${sessionData.host ? `<@${sessionData.host}>` : 'TBD'}
Time: ${time}
Duration: ${duration}

**Sign-ups:**
🚗 ${ROLE_NAMES.driver} — ${sessionData.driver.map(id => `<@${id}>`).join(', ') || 'None'}
🧑‍🎓 ${ROLE_NAMES.trainee} — ${sessionData.trainee.map(id => `<@${id}>`).join(', ') || 'None'}
👮 ${ROLE_NAMES.junior} — ${sessionData.junior.map(id => `<@${id}>`).join(', ') || 'None'}`;
        
    return { content: content };
}


/**
 * Updates the session message content and buttons using the message object provided.
 * @param {Message} message The Discord message object to edit.
 */
async function updateSessionMessage(message) {
    if (!message) return; // Ensure a message object was passed
    
    try {
        const content = generateSessionContent();
        await message.edit({ ...content, components: getButtons() });
    } catch (err) {
        // Log errors but prevent bot crash if message is deleted or channel is inaccessible
        console.error('Failed to update session message:', err.message);
        activeSessionMessageId = null; 
    }
}


// --- Command Handling for /sessionbook ---
client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        if (commandName === 'sessionbook') {
            
            // CRITICAL: Acknowledge the command immediately to avoid the "Unknown interaction" (10062) timeout
            // We must wrap this in a try/catch to prevent the bot from crashing if the interaction expires.
            try {
                await interaction.deferReply({ ephemeral: true });
            } catch (e) {
                // If defer fails, the interaction is too old and we stop processing it.
                console.error('Failed to defer reply (Interaction Expired):', e.message);
                return; 
            }

            const time = interaction.options.getString('time');
            const duration = interaction.options.getString('duration');
            const hostUser = interaction.options.getUser('host') || interaction.user;
            const hostId = hostUser.id;

            // 2. Reset and update global session state
            sessionData = {
                channelId: interaction.channelId, 
                host: hostId,
                time: time,
                duration: duration, 
                driver: [],
                trainee: [],
                junior: [],
                isClosed: false 
            };
            activeSessionMessageId = null;

            // 3. Send the main interactive message
            try {
                const channel = interaction.channel;
                const sessionMessage = await channel.send({ 
                    ...generateSessionContent(), 
                    components: getButtons() 
                });

                // 4. Store the new message ID
                activeSessionMessageId = sessionMessage.id;

                // 5. Edit the initial reply to show success
                return interaction.editReply({ content: `✅ New session started by <@${hostId}>!` });
            } catch (err) {
                console.error('Failed to send session message or edit reply:', err.message);
                // Fallback reply if the message sending fails but deferral succeeded
                return interaction.editReply({ content: '❌ Error starting session. Check bot permissions and ensure the channel is valid.' });
            }
        }
    }

    if (interaction.isButton()) {
        
        // FIX: Wrap the entire button logic in a try/catch to prevent the 
        // bot process from crashing on the DiscordAPIError[10062] timeout.
        try {
            // **CRITICAL FIX:** Defer the reply immediately to prevent the DiscordAPIError[10062] timeout.
            await interaction.deferReply({ ephemeral: true });

            // 1. Check for Active Session and Timeout
            if (!activeSessionMessageId || interaction.message.id !== activeSessionMessageId) {
                return interaction.editReply({ content: '❌ This sign-up is for a past session or the bot recently restarted. Please start a new session using `/sessionbook`.', ephemeral: true });
            }
            
            // --- CRITICAL CLOSED SESSION GATE (Fix for Issue #1) ---
            // Block all non-management actions if the session is closed.
            if (sessionData.isClosed && interaction.customId !== 'close_session') {
                return interaction.editReply({ content: '❌ This session is **CLOSED**. No further sign-ups or cancellations are allowed.', ephemeral: true });
            }
            // --- END CRITICAL CLOSED SESSION GATE ---

            const member = interaction.member;
            // Fetch full member data needed for role checks
            const fullMember = await interaction.guild.members.fetch(member.id).catch(e => {
                console.error('Could not fetch member for role check:', e.message);
            });

            if (!fullMember) return interaction.editReply({ content: 'Cannot fetch member info for role verification.', ephemeral: true });


            const id = interaction.customId;
            const roleMap = {
                signup_driver: 'driver',
                signup_trainee: 'trainee',
                signup_junior: 'junior'
            };
            
            // --- Handle Close Session Button ---
            if (id === 'close_session') {
                // If already closed, just inform the user and exit.
                if (sessionData.isClosed) {
                    return interaction.editReply({ content: 'ℹ️ The session is already closed.', ephemeral: true });
                }
                
                const isHost = fullMember.id === sessionData.host;
                // Check for the "POP Staff" role
                const isStaff = fullMember.roles.cache.some(r => r.name === ROLE_NAMES.pop_staff);

                if (!isHost && !isStaff) {
                    return interaction.editReply({ content: `❌ Only the host or a **${ROLE_NAMES.pop_staff}** member can close this session.`, ephemeral: true });
                }
                
                sessionData.isClosed = true;
                
                // Acknowledge the button click and update the message
                await interaction.editReply({ content: '✅ Session has been **CLOSED**. No further sign-ups are allowed.', ephemeral: true });
                return updateSessionMessage(interaction.message); // Updated call site
            }

            // The 'cancel_slot' handler has been removed as the button is no longer present.

            const roleKey = roleMap[id];
            if (!roleKey) return interaction.deleteReply(); // Delete deferred reply

            
            // --- Role Check Logic ---
            const isDriverSignup = (roleKey === 'driver');
            
            // **Driver role allows everyone (no role check)**

            if (!isDriverSignup) {
                // Trainee and Junior Staff require the matching role
                const requiredRoleName = ROLE_NAMES[roleKey];
                // Check if member has the required Discord role
                const hasRequiredRole = fullMember.roles.cache.some(r => r.name === requiredRoleName);

                if (!hasRequiredRole) {
                    // This handles why you couldn't switch to Junior Staff if you didn't have the role.
                    return interaction.editReply({ 
                        content: `❌ You do not have the required Discord role: **${requiredRoleName}**.`, 
                        ephemeral: true 
                    });
                }
            }
            
            // --- Core Sign-up Logic: Sign up for the chosen role and remove from others ---

            // Check if the user is already signed up for *this* specific role.
            const alreadySignedUpForThisRole = sessionData[roleKey]?.includes(fullMember.id);

            if (alreadySignedUpForThisRole) {
                // User clicked the button for the role they already have.
                return interaction.editReply({ content: `ℹ️ You are already signed up as ${ROLE_NAMES[roleKey]}.`, ephemeral: true });
            }
            
            // If the user is eligible and either not signed up or switching roles:
            
            // 1. Remove user ID from all other role lists
            // FIX: Use the list of internal session role keys (SESSION_ROLE_KEYS) 
            // instead of the button map keys to correctly clear the sign-ups.
            SESSION_ROLE_KEYS.forEach(currentRoleKey => {
                if (currentRoleKey !== roleKey) {
                    // Filter user ID out of other role lists
                    sessionData[currentRoleKey] = (sessionData[currentRoleKey] ?? []).filter(u => u !== fullMember.id);
                }
            });

            // 2. Add user ID to the new role list
            sessionData[roleKey].push(fullMember.id);

            await interaction.editReply({ content: `✅ You signed up as **${ROLE_NAMES[roleKey]}**! You have been removed from any previous role.`, ephemeral: true });
            updateSessionMessage(interaction.message); // Updated call site
        
        } catch (error) {
            // Check specifically for the Unknown Interaction error code (10062)
            if (error.code === 10062) {
                // If the interaction expired, log it but don't crash the bot.
                // We cannot send a reply here because the token is gone.
                console.error('Interaction Expired (10062). User likely clicked the button too late.', error.message);
                return; // Exit gracefully
            }
            // For all other errors, log and continue.
            console.error('Unhandled error during button interaction:', error);
        }
    }
});


// Login to Discord
client.login(process.env.DISCORD_TOKEN);
