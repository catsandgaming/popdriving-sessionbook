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
        GatewayIntentBits.GuildMessages, // Corrected typo here
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
    junior: 'Junior Staff',
    pop_staff: 'POP Staff' // Role for staff who can close any session
};

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
        new ButtonBuilder().setCustomId('cancel_slot').setLabel('Cancel Slot').setStyle(ButtonStyle.Danger) // Allows user to remove their sign-up
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
🚗 Driver — ${sessionData.driver.map(id => `<@${id}>`).join(', ') || 'None'}
🧑‍🎓 Trainee — ${sessionData.trainee.map(id => `<@${id}>`).join(', ') || 'None'}
👮 Junior Staff — ${sessionData.junior.map(id => `<@${id}>`).join(', ') || 'None'}`;
        
    return { content: content };
}


/**
 * Updates the session message content and buttons in the channel.
 */
async function updateSessionMessage() {
    if (!activeSessionMessageId || !sessionData.channelId) return;

    try {
        const channel = await client.channels.fetch(sessionData.channelId);
        if (!channel) return;
        
        const message = await channel.messages.fetch(activeSessionMessageId);
        if (!message) return;

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
            // Moved to the top of the logic block.
            await interaction.deferReply({ ephemeral: true });

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
                console.error('Failed to send session message:', err.message);
                return interaction.editReply({ content: '❌ Error starting session. Check bot permissions and ensure the channel is valid.' });
            }
        }
    }

    if (interaction.isButton()) {
        
        // 1. Check for Active Session and Timeout
        if (!activeSessionMessageId || interaction.message.id !== activeSessionMessageId) {
            return interaction.reply({ content: '❌ This sign-up is for a past session or the bot recently restarted. Please start a new session using `/sessionbook`.', ephemeral: true });
        }

        const member = interaction.member;
        // Fetch full member data needed for role checks
        const fullMember = await interaction.guild.members.fetch(member.id).catch(e => {
            console.error('Could not fetch member for role check:', e.message);
        });

        if (!fullMember) return interaction.reply({ content: 'Cannot fetch member info for role verification.', ephemeral: true });


        const id = interaction.customId;
        const roleMap = {
            signup_driver: 'driver',
            signup_trainee: 'trainee',
            signup_junior: 'junior'
        };
        
        // --- Handle Close Session Button ---
        if (id === 'close_session') {
            const isHost = fullMember.id === sessionData.host;
            // Check for the "POP Staff" role
            const isStaff = fullMember.roles.cache.some(r => r.name === ROLE_NAMES.pop_staff);

            if (!isHost && !isStaff) {
                return interaction.reply({ content: `❌ Only the host or a **${ROLE_NAMES.pop_staff}** member can close this session.`, ephemeral: true });
            }
            
            sessionData.isClosed = true;
            
            // Acknowledge the button click and update the message
            await interaction.reply({ content: '✅ Session has been **CLOSED**. No further sign-ups are allowed.', ephemeral: true });
            return updateSessionMessage();
        }

        // --- Handle Cancel Slot Button (allows anyone to remove their name) ---
        if (id === 'cancel_slot') {
            let wasSignedUp = false;
            
            if (sessionData && typeof sessionData === 'object') {
                Object.keys(roleMap).forEach(roleKey => {
                    // Check if sessionData[roleKey] is defined (it should be, but this protects against the error)
                    // If it's null/undefined, default to an empty array [] before filtering.
                    const roleList = sessionData[roleKey] ?? []; 
                    const initialLength = roleList.length; 
                    
                    // Filter user ID out of the list
                    const updatedList = roleList.filter(u => u !== fullMember.id);
                    
                    // Update sessionData and check if the length changed
                    sessionData[roleKey] = updatedList;
                    if (updatedList.length < initialLength) {
                        wasSignedUp = true;
                    }
                });
            }
            
            await interaction.reply({ content: wasSignedUp ? '✅ You cancelled your sign-up slot.' : 'ℹ️ You were not signed up for any role.', ephemeral: true });
            return updateSessionMessage();
        }

        const roleKey = roleMap[id];
        if (!roleKey) return;

        // --- Check for closed session before sign-up ---
        if (sessionData.isClosed) {
            return interaction.reply({ content: '❌ This session is **CLOSED**. Sign-ups are no longer allowed.', ephemeral: true });
        }
        
        // --- Role Check Logic ---
        const isDriverSignup = (roleKey === 'driver');
        
        // **Driver role allows everyone (no role check)**

        if (!isDriverSignup) {
            // Trainee and Junior Staff require the matching role
            const requiredRoleName = ROLE_NAMES[roleKey];
            // Check if member has the required Discord role
            const hasRequiredRole = fullMember.roles.cache.some(r => r.name === requiredRoleName);

            if (!hasRequiredRole) {
                return interaction.reply({ 
                    content: `❌ You do not have the required Discord role: **${requiredRoleName}**.`, 
                    ephemeral: true 
                });
            }
        }
        
        // --- Core Sign-up Logic: Sign up for the chosen role and remove from others ---

        // Check if the user is already signed up for *this* role after passing the role eligibility checks
        const alreadySignedUpForThisRole = sessionData[roleKey]?.includes(fullMember.id);

        if (alreadySignedUpForThisRole) {
            return interaction.reply({ content: `ℹ️ You are already signed up as ${ROLE_NAMES[roleKey]}.`, ephemeral: true });
        }
        
        // If the user is eligible and not already signed up, proceed to switch roles
        Object.keys(roleMap).forEach(role => {
            if (role !== roleKey) {
                // Filter user ID out of other role lists, safely using empty array if sessionData[role] is missing
                sessionData[role] = (sessionData[role] ?? []).filter(u => u !== fullMember.id);
            }
        });

        // Add user ID to the new role list
        sessionData[roleKey].push(fullMember.id);

        await interaction.reply({ content: `✅ You signed up as **${ROLE_NAMES[roleKey]}**! You have been removed from any previous role.`, ephemeral: true });
        updateSessionMessage();
    }
});


// Login to Discord
client.login(process.env.DISCORD_TOKEN);
