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
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// --- In-memory Session State ---
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

const ROLE_NAMES = {
    driver: 'Driver',
    trainee: 'Trainee',
    junior: 'Junior Staff',
    pop_staff: 'POP Staff'
};

/**
 * Conditionally returns the ActionRow components based on the session state.
 * @returns {ActionRowBuilder[]} An array of ActionRowBuilders containing buttons.
 */
function getButtons() {
    const signUpButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('signup_driver').setLabel(ROLE_NAMES.driver).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('signup_trainee').setLabel(ROLE_NAMES.trainee).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('signup_junior').setLabel(ROLE_NAMES.junior).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('cancel_slot').setLabel('Cancel Slot').setStyle(ButtonStyle.Danger) 
    );

    const managementButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('close_session').setLabel('Close Session').setStyle(ButtonStyle.Danger) 
    );

    // If the session is closed, remove sign-up buttons, only keep management button
    if (sessionData.isClosed) {
        return []; // We can remove the management button too, to fully lock it.
    }
    
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
🚗 Driver — ${sessionData.driver.length}
🧑‍🎓 Trainee — ${sessionData.trainee.length}
👮 Junior Staff — ${sessionData.junior.length}`;
        
    return { content: content };
}


/**
 * Updates the session message content and buttons in the channel.
 */
async function updateSessionMessage() {
    if (!activeSessionMessageId || !sessionData.channelId) return;

    const channel = await client.channels.fetch(sessionData.channelId);
    if (!channel) return;
    
    try {
        const message = await channel.messages.fetch(activeSessionMessageId);
        if (!message) return;

        const content = generateSessionContent();
        await message.edit({ ...content, components: getButtons() });
    } catch (err) {
        console.error('Failed to update session message (it might have been manually deleted or bot restarted):', err.message);
        activeSessionMessageId = null; 
    }
}


// --- Command Handling for /sessionbook ---
client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        if (commandName === 'sessionbook') {
            const time = interaction.options.getString('time');
            const duration = interaction.options.getString('duration');
            const hostUser = interaction.options.getUser('host') || interaction.user;
            const hostId = hostUser.id;

            // 1. Acknowledge the command immediately to avoid timeout (CRITICAL)
            await interaction.deferReply({ ephemeral: true });

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
            const channel = interaction.channel;
            const sessionMessage = await channel.send({ 
                ...generateSessionContent(), 
                components: getButtons() 
            });

            // 4. Store the new message ID
            activeSessionMessageId = sessionMessage.id;

            // 5. Edit the initial reply to show success
            return interaction.editReply({ content: `✅ New session started by <@${hostId}>!` });
        }
    }

    if (interaction.isButton()) {
        // Button interactions should still work even if the bot restarted, 
        // as long as the message is the currently active one.
        if (!activeSessionMessageId || interaction.message.id !== activeSessionMessageId) {
            return interaction.reply({ content: '❌ This sign-up is for a past session or the bot recently restarted. Please start a new session using `/sessionbook`.', ephemeral: true });
        }

        const member = interaction.member;
        if (!member) return interaction.reply({ content: 'Cannot fetch member info.', ephemeral: true });

        const id = interaction.customId;
        const roleMap = {
            signup_driver: 'driver',
            signup_trainee: 'trainee',
            signup_junior: 'junior'
        };
        
        // --- Handle Close Session Button ---
        if (id === 'close_session') {
            const isHost = member.id === sessionData.host;
            // Ensure the roles are correctly fetched (using the cached version from the member object)
            const isStaff = member.roles.cache.some(r => r.name === ROLE_NAMES.pop_staff);

            if (!isHost && !isStaff) {
                return interaction.reply({ content: `❌ Only the host or a **${ROLE_NAMES.pop_staff}** member can close this session.`, ephemeral: true });
            }
            
            sessionData.isClosed = true;
            
            await interaction.reply({ content: '✅ Session has been CLOSED. No further sign-ups are allowed.', ephemeral: true });
            return updateSessionMessage();
        }

        // --- Handle Cancel Slot Button (was cancel_signup) ---
        if (id === 'cancel_slot') {
            let wasSignedUp = false;
            
            if (sessionData && typeof sessionData === 'object') {
                Object.keys(roleMap).forEach(roleKey => {
                    const initialLength = sessionData[roleKey]?.length || 0; 
                    if (sessionData[roleKey]) {
                        sessionData[roleKey] = sessionData[roleKey].filter(u => u !== member.id);
                        if (sessionData[roleKey].length < initialLength) {
                            wasSignedUp = true;
                        }
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
            return interaction.reply({ content: '❌ This session is CLOSED. Sign-ups are no longer allowed.', ephemeral: true });
        }
        
        // Check if the user is already signed up for this role
        if (sessionData[roleKey].includes(member.id)) {
            return interaction.reply({ content: `ℹ️ You are already signed up as ${ROLE_NAMES[roleKey]}.`, ephemeral: true });
        }

        // --- Role Check Logic ---
        const isDriverSignup = (roleKey === 'driver');
        
        if (!isDriverSignup) {
            // Trainee and Junior Staff require the matching role
            const requiredRoleName = ROLE_NAMES[roleKey];
            const hasRequiredRole = member.roles.cache.some(r => r.name === requiredRoleName);

            if (!hasRequiredRole) {
                return interaction.reply({ 
                    content: `❌ You do not have the required Discord role: **${requiredRoleName}**.`, 
                    ephemeral: true 
                });
            }
        }
        
        // --- Core Sign-up Logic ---
        Object.keys(roleMap).forEach(role => {
            if (role !== roleKey) {
                sessionData[role] = sessionData[role].filter(u => u !== member.id);
            }
        });

        sessionData[roleKey].push(member.id);

        await interaction.reply({ content: `✅ You signed up as **${ROLE_NAMES[roleKey]}**!`, ephemeral: true });
        updateSessionMessage();
    }
});


// Login to Discord
client.login(process.env.DISCORD_TOKEN);
