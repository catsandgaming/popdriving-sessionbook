require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    Events,
    EmbedBuilder // Keeping EmbedBuilder just in case, but won't use it for the main output
} = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// The ID of the channel where sessions should be posted.
// You can remove this constant and let the command run in any channel, but 
// for strict control, keep it and replace 'YOUR_CHANNEL_ID_HERE'.
const SESSION_CHANNEL_ID = 'YOUR_CHANNEL_ID_HERE'; 

// --- In-memory Session State ---
// This variable holds the ID of the message for the CURRENT active session
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

// Role names mapping (used for button labels and checking if the user is qualified)
const ROLE_NAMES = {
    driver: 'Driver',
    trainee: 'Trainee',
    junior: 'Junior Staff'
};

// Sign-up buttons
const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('signup_driver').setLabel(ROLE_NAMES.driver).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('signup_trainee').setLabel(ROLE_NAMES.trainee).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('signup_junior').setLabel(ROLE_NAMES.junior).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('cancel_signup').setLabel('Cancel Sign-up').setStyle(ButtonStyle.Danger)
);

client.once(Events.ClientReady, () => {
    console.log(`\nLogged in as ${client.user.tag}`);
    console.log('Bot is ready and listening for slash commands and button interactions.');
    // NOTE: You must run deploy-commands.js separately to register the command!
});

/**
 * Generates the content of the session message based on current sessionData.
 * It uses simple text formatting to match the user's desired visual style.
 * @returns {object} The message payload (content string).
 */
function generateSessionContent() {
    // Generates simple text content to match the clean, non-embed style of the screenshot.
    // The host is mentioned using their ID, Time and Duration use the command inputs, and sign-ups show counts.
    const content = `🚗 **Driving Session**\n` +
        `Host: ${sessionData.host ? `<@${sessionData.host}>` : 'TBD'}\n` +
        `Time: ${sessionData.time}\n` +
        `Duration: ${sessionData.duration}\n\n` +
        `**Sign-ups:**\n` +
        `🚗 Driver — ${sessionData.driver.length}\n` +
        `🧑‍🎓 Trainee — ${sessionData.trainee.length}\n` +
        `👮 Junior Staff — ${sessionData.junior.length}`;
        
    return { content: content };
}


/**
 * Updates the session message content and buttons in the channel.
 */
async function updateSessionMessage() {
    if (!activeSessionMessageId) return; // No active session to update

    const channel = await client.channels.fetch(SESSION_CHANNEL_ID);
    if (!channel) return;
    
    try {
        const message = await channel.messages.fetch(activeSessionMessageId);
        if (!message) return;

        const content = generateSessionContent();
        await message.edit({ ...content, components: [buttons] });
    } catch (err) {
        // This is normal if the message was manually deleted
        console.error('Failed to update session message (it might have been deleted):', err.message);
        activeSessionMessageId = null; // Clear ID if message is gone
    }
}


// --- Command Handling for /sessionbook ---
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'sessionbook') {
        // Check if the command is run in the designated channel (optional)
        if (SESSION_CHANNEL_ID !== 'YOUR_CHANNEL_ID_HERE' && interaction.channelId !== SESSION_CHANNEL_ID) {
             return interaction.reply({ content: `❌ Please use this command in the designated session channel.`, ephemeral: true });
        }

        // 1. Get dynamic inputs from the command
        const time = interaction.options.getString('time');
        const duration = interaction.options.getString('duration');
        // Host defaults to the command invoker if not specified
        const hostUser = interaction.options.getUser('host') || interaction.user;
        const hostId = hostUser.id;

        // 2. Reset and update global session state
        sessionData = {
            host: hostId,
            time: time,
            duration: duration,
            driver: [],
            trainee: [],
            junior: []
        };
        activeSessionMessageId = null; // Prepare for new message

        // 3. Send the new interactive message
        // Use followUp to confirm the command, then send the main message
        await interaction.reply({ content: `✅ New session started by <@${hostId}>!`, ephemeral: true });
        
        const channel = interaction.channel;
        const sessionMessage = await channel.send({ 
            ...generateSessionContent(), 
            components: [buttons] 
        });

        // 4. Store the new message ID for future button updates
        activeSessionMessageId = sessionMessage.id;
        console.log(`New session message created with ID: ${activeSessionMessageId}`);
    }
});


// --- Button Handling for Sign-ups/Cancellations ---
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isButton()) return;
    
    // Only handle buttons on the current active session message
    if (interaction.message.id !== activeSessionMessageId) {
        return interaction.reply({ content: '❌ This sign-up is for a past session. Please use the newest one.', ephemeral: true });
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
        // Remove from all roles
        Object.keys(roleMap).forEach(roleKey => {
            const initialLength = sessionData[roleKey].length;
            sessionData[roleKey] = sessionData[roleKey].filter(u => u !== member.id);
            if (sessionData[roleKey].length < initialLength) {
                wasSignedUp = true;
            }
        });
        
        await interaction.reply({ content: wasSignedUp ? '✅ You cancelled your sign-up.' : 'ℹ️ You were not signed up for any role.', ephemeral: true });
        return updateSessionMessage();
    }

    // Check if the current message is the one being tracked
    if (interaction.message.id !== activeSessionMessageId) {
        return interaction.reply({ content: '❌ This sign-up is for a past session. Please use the newest one.', ephemeral: true });
    }

    const roleKey = roleMap[id];
    if (!roleKey) return;

    // Check if the user is already signed up for this role
    if (sessionData[roleKey].includes(member.id)) {
        return interaction.reply({ content: `ℹ️ You are already signed up as ${ROLE_NAMES[roleKey]}.`, ephemeral: true });
    }

    // Check if member has the Discord role (This requires the bot to have permissions to view member roles)
    const requiredRoleName = ROLE_NAMES[roleKey];
    const hasRequiredRole = member.roles.cache.some(r => r.name === requiredRoleName);

    if (!hasRequiredRole) {
        return interaction.reply({ 
            content: `❌ You do not have the required Discord role: **${requiredRoleName}**.`, 
            ephemeral: true 
        });
    }

    // --- Core Sign-up Logic ---
    
    // 1. Remove user from all other roles (so they can only sign up for one)
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


// Login
client.login(process.env.DISCORD_TOKEN);
