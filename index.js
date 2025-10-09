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

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers, // CRITICAL: Required for checking user roles
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// The ID of the channel where sessions should be posted.
const SESSION_CHANNEL_ID = 'YOUR_CHANNEL_ID_HERE'; 

// --- In-memory Session State ---
// This ID tracks the ONLY message currently active for sign-ups.
let activeSessionMessageId = null; 

// Session data structure (will be reset for each new session)
let sessionData = {
    host: null,
    time: null,
    duration: null,
    driver: [],
    trainee: [],
    junior: []
};

// Role names mapping (MUST exactly match the role names in your Discord server.)
const ROLE_NAMES = {
    driver: 'Driver',
    trainee: 'Trainee',
    junior: 'Junior Staff'
};

// Sign-up buttons component
const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('signup_driver').setLabel(ROLE_NAMES.driver).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('signup_trainee').setLabel(ROLE_NAMES.trainee).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('signup_junior').setLabel(ROLE_NAMES.junior).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('cancel_signup').setLabel('Cancel Sign-up').setStyle(ButtonStyle.Danger)
);

client.once(Events.ClientReady, () => {
    console.log(`\nLogged in as ${client.user.tag}`);
    console.log('Bot is ready and listening for /sessionbook slash commands.');
    // NOTE: Ensure you run deploy-commands.js once to register the command!
});

/**
 * Generates the content of the session message based on current sessionData.
 * @returns {object} The message payload (content string).
 */
function generateSessionContent() {
    // Check for null values gracefully, although the command inputs should prevent this.
    const time = sessionData.time || 'TBD';
    const duration = sessionData.duration || 'TBD';

    const content = `🚗 **Driving Session**
Host: ${sessionData.host ? `<@${sessionData.host}>` : 'TBD'}
Time: ${time}
Duration: ${duration}

**Sign-ups:**
🚗 Driver — ${sessionData.driver.length}
🧑‍🎓 Trainee — ${sessionData.trainee.length}
👮 Junior Staff — ${sessionData.junior.length}`;
        
    return { content: content };
}


/**
 * Updates the session message content and buttons in the channel.
 */
async function updateSessionMessage() {
    if (!activeSessionMessageId) return;

    const channel = await client.channels.fetch(SESSION_CHANNEL_ID);
    if (!channel) return;
    
    try {
        const message = await channel.messages.fetch(activeSessionMessageId);
        if (!message) return;

        const content = generateSessionContent();
        await message.edit({ ...content, components: [buttons] });
    } catch (err) {
        // If the message was deleted or fetch failed, clear the active ID.
        console.error('Failed to update session message (it might have been manually deleted):', err.message);
        activeSessionMessageId = null; 
    }
}


// --- Command Handling for /sessionbook ---
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'sessionbook') {
        // Optional: Channel restriction check
        if (SESSION_CHANNEL_ID !== 'YOUR_CHANNEL_ID_HERE' && interaction.channelId !== SESSION_CHANNEL_ID) {
             return interaction.reply({ content: `❌ Please use this command in the designated session channel.`, ephemeral: true });
        }

        // 1. Get dynamic inputs
        const time = interaction.options.getString('time');
        const duration = interaction.options.getString('duration');
        const hostUser = interaction.options.getUser('host') || interaction.user;
        const hostId = hostUser.id;

        // 2. Reset and update global session state with new details
        sessionData = {
            host: hostId,
            time: time,
            duration: duration,
            driver: [],
            trainee: [],
            junior: []
        };
        activeSessionMessageId = null; // Prepare for new message

        // 3. Confirm the command execution
        await interaction.reply({ content: `✅ New session started by <@${hostId}>!`, ephemeral: true });
        
        // 4. Send the main interactive message
        const channel = interaction.channel;
        const sessionMessage = await channel.send({ 
            ...generateSessionContent(), 
            components: [buttons] 
        });

        // 5. Store the new message ID
        activeSessionMessageId = sessionMessage.id;
        console.log(`New session message created with ID: ${activeSessionMessageId}`);
    }
});


// --- Button Handling for Sign-ups/Cancellations ---
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isButton()) return;
    
    // CRITICAL FIX: If the bot restarted, activeSessionMessageId will be null.
    // We check if the clicked message ID matches the active one.
    if (!activeSessionMessageId || interaction.message.id !== activeSessionMessageId) {
        return interaction.reply({ content: '❌ This sign-up is for a past session, or the bot recently restarted. Please start a new session using `/sessionbook`.', ephemeral: true });
    }

    const member = interaction.member;
    if (!member) return interaction.reply({ content: 'Cannot fetch member info.', ephemeral: true });

    const id = interaction.customId;
    const roleMap = {
        signup_driver: 'driver',
        signup_trainee: 'trainee',
        signup_junior: 'junior'
    };

    if (id === 'cancel_signup') {
        let wasSignedUp = false;
        // Fix for the TypeError: Cannot read properties of undefined (reading 'length')
        // Ensure sessionData is valid before iterating
        if (sessionData && typeof sessionData === 'object') {
            Object.keys(roleMap).forEach(roleKey => {
                const initialLength = sessionData[roleKey]?.length || 0; // Use optional chaining and default to 0
                if (sessionData[roleKey]) {
                    sessionData[roleKey] = sessionData[roleKey].filter(u => u !== member.id);
                    if (sessionData[roleKey].length < initialLength) {
                        wasSignedUp = true;
                    }
                }
            });
        }
        
        await interaction.reply({ content: wasSignedUp ? '✅ You cancelled your sign-up.' : 'ℹ️ You were not signed up for any role.', ephemeral: true });
        return updateSessionMessage();
    }

    const roleKey = roleMap[id];
    if (!roleKey) return;

    // Check if the user is already signed up for this role
    if (sessionData[roleKey].includes(member.id)) {
        return interaction.reply({ content: `ℹ️ You are already signed up as ${ROLE_NAMES[roleKey]}.`, ephemeral: true });
    }

    // Check if member has the Discord role before signing up
    const requiredRoleName = ROLE_NAMES[roleKey];
    const hasRequiredRole = member.roles.cache.some(r => r.name === requiredRoleName);

    if (!hasRequiredRole) {
        return interaction.reply({ 
            content: `❌ You do not have the required Discord role: **${requiredRoleName}**.`, 
            ephemeral: true 
        });
    }

    // --- Core Sign-up Logic ---
    
    // 1. Remove user from all other roles (ensuring single sign-up)
    Object.keys(roleMap).forEach(role => {
        if (role !== roleKey) {
            sessionData[role] = sessionData[role].filter(u => u !== member.id);
        }
    });

    // 2. Add to the requested role
    sessionData[roleKey].push(member.id);

    await interaction.reply({ content: `✅ You signed up as **${requiredRoleName}**!`, ephemeral: true });
    updateSessionMessage();
});


// Login to Discord
client.login(process.env.DISCORD_TOKEN);
