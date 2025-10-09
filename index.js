require('dotenv').config();
const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events } = require('discord.js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const PORT = process.env.PORT || 10000;
const SESSION_CHANNEL_ID = 'YOUR_CHANNEL_ID'; // Change to your channel
const SESSION_MESSAGE_ID = 'YOUR_MESSAGE_ID'; // Change to your session message ID

// Session data
let sessionSignups = {
    trainee: [],
    junior: [],
    driver: []
};

// Required Discord role names
const ROLE_NAMES = {
    trainee: 'Trainee',
    junior: 'Junior Staff',
    driver: 'Driver'
};

// Create buttons
const roleButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('signup_trainee').setLabel('Trainee').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('signup_junior').setLabel('Junior Staff').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('signup_driver').setLabel('Driver').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('cancel_signup').setLabel('Cancel').setStyle(ButtonStyle.Danger)
);

client.once(Events.ClientReady, () => {
    console.log(`Logged in as ${client.user.tag}`);
    console.log(`Server listening on port ${PORT}`);
});

// Update session message
async function updateSessionMessage(channelId, messageId) {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return;
    try {
        const message = await channel.messages.fetch(messageId);
        if (!message) return;
        const content = `**Session Sign-ups**\n\n` +
            `**Trainee:** ${sessionSignups.trainee.map(u => `<@${u}>`).join(', ') || 'None'}\n` +
            `**Junior Staff:** ${sessionSignups.junior.map(u => `<@${u}>`).join(', ') || 'None'}\n` +
            `**Driver:** ${sessionSignups.driver.map(u => `<@${u}>`).join(', ') || 'None'}`;
        await message.edit({ content, components: [roleButtons] });
    } catch (err) {
        console.error('Failed to update session message:', err);
    }
}

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isButton()) return;

    const member = interaction.member;

    if (!member) return interaction.reply({ content: 'Unable to fetch member info.', ephemeral: true });

    const id = interaction.customId;

    // Map button click to role
    const roleMap = {
        signup_trainee: 'trainee',
        signup_junior: 'junior',
        signup_driver: 'driver',
    };

    if (id === 'cancel_signup') {
        // Remove user from all lists
        Object.keys(sessionSignups).forEach(role => {
            sessionSignups[role] = sessionSignups[role].filter(u => u !== member.id);
        });
        await interaction.reply({ content: '✅ You have cancelled your sign-up.', ephemeral: true });
        return updateSessionMessage(SESSION_CHANNEL_ID, SESSION_MESSAGE_ID);
    }

    const selectedRole = roleMap[id];
    if (!selectedRole) return;

    // Check if member has required role
    const requiredRoleName = ROLE_NAMES[selectedRole];
    const hasRole = member.roles.cache.some(r => r.name === requiredRoleName);
    if (!hasRole) {
        return interaction.reply({ content: `❌ You do not have the required role: ${requiredRoleName}`, ephemeral: true });
    }

    // Remove user from other roles
    Object.keys(sessionSignups).forEach(role => {
        if (role !== selectedRole) {
            sessionSignups[role] = sessionSignups[role].filter(u => u !== member.id);
        }
    });

    // Add user to selected role if not already
    if (!sessionSignups[selectedRole].includes(member.id)) {
        sessionSignups[selectedRole].push(member.id);
    }

    await interaction.reply({ content: `✅ You have signed up as ${requiredRoleName}.`, ephemeral: true });

    // Update session message
    updateSessionMessage(SESSION_CHANNEL_ID, SESSION_MESSAGE_ID);
});

// Login
client.login(process.env.DISCORD_TOKEN);
