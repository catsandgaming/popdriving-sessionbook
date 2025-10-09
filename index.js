// --- Imports ---
require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');

// --- Environment Variables ---
const TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID; // Your bot's application ID
const GUILD_ID = process.env.GUILD_ID; // Optional if you want guild-specific commands

// Role-based IDs
const JUNIOR_STAFF_IDS = (process.env.JUNIOR_STAFF_IDS || "").split(",").map(x => x.trim());
const SESSION_HOST_ID = process.env.SESSION_HOST_ID;
const TRAINEE_ID = process.env.TRAINEE_ID;

// --- Discord Client ---
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// --- Session Data ---
const DATA_FILE = "sessions.json";

function loadSessions() {
  if (!fs.existsSync(DATA_FILE)) return {};
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function saveSessions(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// --- Slash Command Definition ---
const sessionBookCommand = new SlashCommandBuilder()
  .setName("sessionbook")
  .setDescription("Create a new driving session with signups.")
  .addStringOption(opt => opt.setName("time").setDescription("Start time (e.g. 18:30)").setRequired(true))
  .addStringOption(opt => opt.setName("duration").setDescription("Duration in minutes").setRequired(true));

// --- Register Commands ---
async function registerCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: [sessionBookCommand.toJSON()] }
    );
    console.log("✅ Registered /sessionbook command.");
  } catch (err) {
    console.error("❌ Failed to register commands:", err);
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
      `**Host:** <@${session.host}>\n` +
      `**Time:** ${session.time}\n` +
      `**Duration:** ${session.duration} minutes\n\n` +
      "**Sign-ups:**\n" +
      `🏎️ Driver — ${session.driver ? `<@${session.driver}>` : "None"}\n` +
      `🎓 Trainee — ${session.trainee ? `<@${session.trainee}>` : "None"}\n` +
      `👮 Junior Staff — ${session.junior ? `<@${session.junior}>` : "None"}`
    );

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder().setCustomId(`driver_${sessionId}`).setLabel("Driver").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`trainee_${sessionId}`).setLabel("Trainee").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`junior_${sessionId}`).setLabel("Junior Staff").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`cancel_${sessionId}`).setLabel("Cancel Session").setStyle(ButtonStyle.Danger)
    );

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// --- Handle Slash Commands ---
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "sessionbook") {
      await interaction.deferReply({ ephemeral: true });

      // Permission check: user must have one of the allowed roles
      const memberRoles = interaction.member.roles.cache.map(r => r.id);
      const allowedRoles = [SESSION_HOST_ID, ...JUNIOR_STAFF_IDS, TRAINEE_ID];
      if (!memberRoles.some(r => allowedRoles.includes(r))) {
        return interaction.editReply({ content: "🚫 You don’t have permission to create a session." });
      }

      const time = interaction.options.getString("time");
      const duration = interaction.options.getString("duration");
      const sessionId = Date.now().toString(); // Unique session ID

      // Save session
      const sessions = loadSessions();
      sessions[sessionId] = {
        host: interaction.user.id,
        time,
        duration,
        driver: null,
        trainee: null,
        junior: null
      };
      saveSessions(sessions);

      // Send initial embed
      await updateEmbed(interaction, sessionId);
    }

    // Handle button clicks
    if (interaction.isButton()) {
      await interaction.deferReply({ ephemeral: true });

      const [role, sessionId] = interaction.customId.split("_");
      const sessions = loadSessions();
      const session = sessions[sessionId];
      if (!session) return interaction.editReply({ content: "❌ Session not found." });

      // Cancel session
      if (role === "cancel") {
        delete sessions[sessionId];
        saveSessions(sessions);
        return interaction.editReply({ content: "❌ Driving session closed." });
      }

      // Role switching logic: remove user from any previous role
      for (const key of ["driver", "trainee", "junior"]) {
        if (session[key] === interaction.user.id) session[key] = null;
      }

      // Assign new role if not taken
      if (session[role]) {
        return interaction.editReply({ content: `❌ That spot (${role}) is already taken!` });
      }

      session[role] = interaction.user.id;
      saveSessions(sessions);
      await updateEmbed(interaction, sessionId);
      return interaction.editReply({ content: `✅ You signed up as ${role}!` });
    }

  } catch (err) {
    console.error(err);
    if (interaction.deferred || interaction.replied) {
      interaction.editReply({ content: "❌ Something went wrong." });
    } else {
      interaction.reply({ content: "❌ Something went wrong.", ephemeral: true });
    }
  }
});

// --- Ready ---
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await registerCommands();
});

// --- Start Bot ---
client.login(TOKEN);
