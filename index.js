// --- Imports ---
require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');

// --- Environment Variables ---
const TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

// Role IDs
const SESSION_HOST_ID = process.env.SESSION_HOST_ID;
const JUNIOR_STAFF_IDS = (process.env.JUNIOR_STAFF_IDS || "").split(",").map(x => x.trim());
const TRAINEE_ID = process.env.TRAINEE_ID;

// --- Data File ---
const DATA_FILE = "sessions.json";

// --- Utility Functions ---
function loadSessions() {
  if (!fs.existsSync(DATA_FILE)) return {};
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function saveSessions(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// --- Discord Client ---
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// --- Register Slash Commands ---
const sessionBookCommand = new SlashCommandBuilder()
  .setName("sessionbook")
  .setDescription("Create a new driving session with signups.")
  .addStringOption(opt => opt.setName("time").setDescription("Start time (e.g. 18:30)").setRequired(true))
  .addStringOption(opt => opt.setName("duration").setDescription("Duration in minutes").setRequired(true));

async function registerCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [sessionBookCommand.toJSON()] });
    console.log('✅ Registered /sessionbook command.');
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
  }
}

// --- Update Embed ---
async function updateEmbed(interaction, sessionId) {
  const sessions = loadSessions();
  const session = sessions[sessionId];
  if (!session) return;

  const embed = new EmbedBuilder()
    .setTitle("🚗 Driving Session")
    .setColor(0x00bfff)
    .setDescription(
      `**Host:** <@${session.host}>\n**Time:** ${session.time}\n**Duration:** ${session.duration} minutes\n\n` +
      "**Sign-ups:**\n" +
      `🏎️ Driver — ${session.driver ? `<@${session.driver}>` : "None"}\n` +
      `🎓 Trainee — ${session.trainee ? `<@${session.trainee}>` : "None"}\n` +
      `👮 Junior Staff — ${session.junior ? `<@${session.junior}>` : "None"}`
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`driver_${sessionId}`).setLabel("Driver").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`trainee_${sessionId}`).setLabel("Trainee").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`junior_${sessionId}`).setLabel("Junior Staff").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`cancel_${sessionId}`).setLabel("Cancel Session").setStyle(ButtonStyle.Danger)
  );

  await interaction.message.edit({ embeds: [embed], components: [row] });
}

// --- Bot Ready ---
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await registerCommands();
});

// --- Handle Slash Commands ---
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'sessionbook') {
    const hostId = interaction.user.id;

    if (![SESSION_HOST_ID, ...JUNIOR_STAFF_IDS, TRAINEE_ID].includes(hostId)) {
      return interaction.reply({ content: "🚫 You don’t have permission to create a session.", ephemeral: true });
    }

    const time = interaction.options.getString('time');
    const duration = interaction.options.getString('duration');

    const sessions = loadSessions();
    const sessionId = interaction.id;

    sessions[sessionId] = {
      host: hostId,
      time,
      duration,
      driver: null,
      trainee: null,
      junior: null
    };
    saveSessions(sessions);

    const embed = new EmbedBuilder()
      .setTitle("🚗 Driving Session")
      .setColor(0x00bfff)
      .setDescription(
        `**Host:** <@${hostId}>\n**Time:** ${time}\n**Duration:** ${duration} minutes\n\n` +
        "**Sign-ups:**\n" +
        "🏎️ Driver — None\n" +
        "🎓 Trainee — None\n" +
        "👮 Junior Staff — None"
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`driver_${sessionId}`).setLabel("Driver").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`trainee_${sessionId}`).setLabel("Trainee").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`junior_${sessionId}`).setLabel("Junior Staff").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`cancel_${sessionId}`).setLabel("Cancel Session").setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({ embeds: [embed], components: [row] });
  }
});

// --- Handle Button Interactions ---
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const [role, sessionId] = interaction.customId.split("_");
  const sessions = loadSessions();
  const session = sessions[sessionId];
  if (!session) return interaction.reply({ content: "Session not found.", ephemeral: true });

  if (role === "cancel") {
    delete sessions[sessionId];
    saveSessions(sessions);
    return interaction.message.edit({
      embeds: [new EmbedBuilder().setTitle("❌ Driving Session Closed").setColor(0xff0000)],
      components: []
    });
  }

  // Remove user from any previous role
  for (const key of ["driver", "trainee", "junior"]) {
    if (session[key] === interaction.user.id) session[key] = null;
  }

  // Assign new role
  session[role] = interaction.user.id;
  saveSessions(sessions);

  await updateEmbed(interaction, sessionId);
  await interaction.reply({ content: `✅ You signed up as ${role}!`, ephemeral: true });
});

// --- Login Bot ---
client.login(TOKEN);
