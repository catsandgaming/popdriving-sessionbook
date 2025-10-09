require('dotenv').config();
const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const SESSION_CHANNEL_ID = 'YOUR_CHANNEL_ID'; // Replace with your channel ID
const SESSION_MESSAGE_ID = 'YOUR_MESSAGE_ID'; // Replace with your session message ID

// Track sign-ups
let sessionData = {
    host: null,
    time: 'p',       // You can dynamically set
    duration: 'p',   // You can dynamically set
    driver: [],
    trainee: [],
    junior: []
};

// Role names mapping
const ROLE_NAMES = {
    driver: 'Driver',
    trainee: 'Trainee',
    junior: 'Junior Staff'
};

// Buttons
const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('signup_driver').setLabel('Driver').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('signup_trainee').setLabel('Trainee').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('signup_junior').setLabel('Junior Staff').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('cancel_signup').setLabel('Cancel').setStyle(ButtonStyle.Danger)
);

client.once(Events.ClientReady, () => {
    console.log(`Logged in as ${client.user.tag}`);
});

// Update session message in your channel
async function updateSessionMessage() {
    const channel = await client.channels.fetch(SESSION_CHANNEL_ID);
    if (!channel) return;
    try {
        const message = await channel.messages.fetch(SESSION_MESSAGE_ID);
        if (!message) return;

        const content = `🚗 **Driving Session**\n` +
            `Host: ${sessionData.host ? `<@${sessionData.host}>` : 'TBD'}\n` +
            `Time: ${sessionData.time}\n` +
            `Duration: ${sessionData.duration}\n\n` +
            `**Sign-ups:**\n` +
            `🚗 Driver — ${sessionData.driver.length}\n` +
            `🧑‍🎓 Trainee — ${sessionData.trainee.length}\n` +
            `👮 Junior Staff — ${sessionData.junior.length}`;

        await message.edit({ content, components: [buttons] });
    } catch (err) {
        console.error('Failed to update session message:', err);
    }
}

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isButton()) return;

    const member = interaction.member;
    if (!member) return interaction.reply({ content: 'Cannot fetch member info', ephemeral: true });

    const id = interaction.customId;
    const roleMap = {
        signup_driver: 'driver',
        signup_trainee: 'trainee',
        signup_junior: 'junior'
    };

    if (id === 'cancel_signup') {
        // Remove from all roles
        Object.keys(roleMap).forEach(role => {
            sessionData[role] = sessionData[role].filter(u => u !== member.id);
        });
        return interaction.reply({ content: '✅ You cancelled your sign-up.', ephemeral: true }).then(updateSessionMessage);
    }

    const roleKey = roleMap[id];
    if (!roleKey) return;

    // Check if member has the Discord role
    const requiredRole = ROLE_NAMES[roleKey];
    if (!member.roles.cache.some(r => r.name === requiredRole)) {
        return interaction.reply({ content: `❌ You do not have the required role: ${requiredRole}`, ephemeral: true });
    }

    // Remove user from other roles
    Object.keys(roleMap).forEach(role => {
        if (role !== roleKey) {
            sessionData[role] = sessionData[role].filter(u => u !== member.id);
        }
    });

    // Add to this role if not already
    if (!sessionData[roleKey].includes(member.id)) {
        sessionData[roleKey].push(member.id);
    }

    await interaction.reply({ content: `✅ You signed up as ${requiredRole}`, ephemeral: true });
    updateSessionMessage();
});

// Login
client.login(process.env.DISCORD_TOKEN);
