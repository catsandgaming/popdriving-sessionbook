// --- Imports ---
require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const fs = require('fs');

// --- Environment Variables ---
const TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const SESSION_HOST_ID = process.env.SESSION_HOST_ID;
const JUNIOR_STAFF_IDS = (process.env.JUNIOR_STAFF_IDS || "").split(",").map(x => x.trim());
const TRAINEE_ID = process.env.TRAINEE_ID;

const DATA_FILE = 'sessions.json';

// --- Utility Functions ---
function loadSessions() {
  if (!fs.existsSync(DATA_FILE)) return {};
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function saveSessions(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// --- Discord Client ---
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// --- Slash Command ---
const sessionBookCommand = new SlashCommandBuilder()
  .setName('sessionbook')
  .setDescription('Create a new driving session.')
  .addStringOption(opt =>
    opt.setName('time').setDescription('Start time (e.g. 18:30)').setRequired(true)
  )
  .addStringOption(opt =>
    opt.setName('duration').setDescription('Duration in minutes').setRequired(true)
  );

// --- Register Commands ---
async function registerCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [sessionBookCommand.toJSON()] });
    console.log('✅ Registered /sessionbook command.');
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
  }
}

// --- When Bot Ready ---
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await registerCommands();
});

// --- Handle Slash Command ---
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'sessionbook') return;

  const member = interaction.member;
  const userRoles = member.roles.cache.map(r => r.id);

  const isAllowed =
    userRoles.includes(SESSION_HOST_ID) ||
    userRoles.some(r => JUNIOR_STAFF_IDS.includes(r)) ||
    userRoles.includes(TRAINEE_ID);

  if (!isAllowed) {
    return interaction.reply({
      content: '🚫 You do not have permission to start a session.',
      ephemeral: true
    });
  }

  const time = interaction.options.getString('time');
  const duration = interaction.options.getString('duration');
  const host = interaction.user;

  const sessions = loadSessions();
  const sessionId = interaction.id;

  sessions[sessionId] = {
    host: host.id,
    time,
    duration,
    driver: null,
    trainee: null,
    junior: null,
    closed: false
  };
  saveSessions(sessions);

  const embed = new EmbedBuilder()
    .setTitle('🚗 Driving Session')
    .setColor(0x00bfff)
    .setDescription(
      `**Host:** ${host}\n**Time:** ${time}\n**Duration:** ${duration} minutes\n\n` +
      '**Sign-ups:**\n' +
      '🏎️ Driver — None\n' +
      '🎓 Trainee — None\n' +
      '👮 Junior Staff — None'
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`driver_${sessionId}`).setLabel('Driver').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`trainee_${sessionId}`).setLabel('Trainee').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`junior_${sessionId}`).setLabel('Junior Staff').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`cancel_${sessionId}`).setLabel('Cancel').setStyle(ButtonStyle.Danger)
  );

  await interaction.reply({ embeds: [embed], components: [row] });
});

// --- Handle Button Interactions ---
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'sessionbook') return;

  await interaction.deferReply({ ephemeral: false }); // ✅ defer early

  const [role, sessionId] = interaction.customId.split('_');
  const sessions = loadSessions();
  const session = sessions[sessionId];

  if (!session) return interaction.reply({ content: 'Session not found.', ephemeral: true });
  if (session.closed)
    return interaction.reply({ content: '🚫 This session is already closed.', ephemeral: true });

  const embed = EmbedBuilder.from(interaction.message.embeds[0]);

  if (role === 'cancel') {
    session.closed = true;
    saveSessions(sessions);

    embed.setTitle('🚫 Driving Session Closed').setColor(0xff0000);
    const disabledRow = new ActionRowBuilder().addComponents(
      interaction.message.components[0].components.map(b => ButtonBuilder.from(b).setDisabled(true))
    );

    await interaction.message.edit({ embeds: [embed], components: [disabledRow] });
    return interaction.reply({ content: '🛑 The session has been closed.', ephemeral: true });
  }

  // --- Remove user from any previous spot ---
  for (const key of ['driver', 'trainee', 'junior']) {
    if (session[key] === interaction.user.id) {
      session[key] = null;
    }
  }

  // --- Check if role already taken ---
  if (session[role]) {
    return interaction.reply({ content: `❌ That ${role} spot is already taken.`, ephemeral: true });
  }

  // --- Assign user to the new role ---
  session[role] = interaction.user.id;
  saveSessions(sessions);

  embed.setDescription(
    `**Host:** <@${session.host}>\n**Time:** ${session.time}\n**Duration:** ${session.duration} minutes\n\n` +
    '**Sign-ups:**\n' +
    `🏎️ Driver — ${session.driver ? `<@${session.driver}>` : 'None'}\n` +
    `🎓 Trainee — ${session.trainee ? `<@${session.trainee}>` : 'None'}\n` +
    `👮 Junior Staff — ${session.junior ? `<@${session.junior}>` : 'None'}`
  );

  await interaction.message.edit({ embeds: [embed] });
  return interaction.reply({ content: `✅ You signed up as ${role}!`, ephemeral: true });
});

// --- Start Bot ---
client.login(TOKEN);
