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
const JUNIOR_STAFF_IDS = (process.env.JUNIOR_STAFF_IDS || "").split(",").map(x => x.trim());
const SESSION_HOST_ID = process.env.SESSION_HOST_ID;
const TRAINEE_ID = process.env.TRAINEE_ID;

// --- Discord Client Setup ---
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// --- Session Data Management ---
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
  .addStringOption(opt =>
    opt.setName("time").setDescription("Start time (e.g. 18:30)").setRequired(true)
  )
  .addStringOption(opt =>
    opt.setName("duration").setDescription("Duration in minutes").setRequired(true)
  );

// --- Register Slash Commands ---
async function registerCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [sessionBookCommand.toJSON()] });
    console.log('✅ Global command /sessionbook registered successfully.');
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
  }
}

// --- When Bot is Ready ---
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await registerCommands();
});

// --- Handle Slash Command Execution ---
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'sessionbook') {
    const member = interaction.member;
    const userRoles = member.roles.cache.map(r => r.id);
    const time = interaction.options.getString('time');
    const duration = interaction.options.getString('duration');

    // Permission check
    const isAllowed =
      userRoles.includes(SESSION_HOST_ID) ||
      userRoles.some(r => JUNIOR_STAFF_IDS.includes(r)) ||
      userRoles.includes(TRAINEE_ID);

    if (!isAllowed) {
      return interaction.reply({
        content: '🚫 You do not have permission to start a session. Only authorized staff may use this command.',
        ephemeral: true
      });
    }

    const host = interaction.user;
    const sessionId = interaction.id;
    const sessions = loadSessions();

    sessions[sessionId] = {
      host: host.id,
      time,
      duration,
      driver: null,
      trainee: null,
      junior: null,
    };
    saveSessions(sessions);

    const embed = new EmbedBuilder()
      .setTitle("🚗 Driving Session")
      .setColor(0x00bfff)
      .setDescription(
        `**Host:** ${host}\n**Time:** ${time}\n**Duration:** ${duration} minutes\n\n` +
        "**Sign-ups:**\n" +
        "🏎️ Driver — None\n" +
        "🎓 Trainee — None\n" +
        "👮 Junior Staff — None"
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`driver_${sessionId}`).setLabel("Driver").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`trainee_${sessionId}`).setLabel("Trainee").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`junior_${sessionId}`).setLabel("Junior Staff").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`cancel_${sessionId}`).setLabel("Cancel").setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({ embeds: [embed], components: [row] });
  }
});

// --- Handle Button Interactions ---
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;

  const [role, sessionId] = interaction.customId.split("_");
  const sessions = loadSessions();
  const session = sessions[sessionId];
  if (!session) return interaction.reply({ content: "Session not found.", ephemeral: true });

  const embed = EmbedBuilder.from(interaction.message.embeds[0]);

  if (role === "cancel") {
    let updated = false;
    for (const key of ["driver", "trainee", "junior"]) {
      if (session[key] === interaction.user.id) {
        session[key] = null;
        updated = true;
      }
    }
    if (!updated)
      return interaction.reply({ content: "You are not signed up for this session.", ephemeral: true });
    saveSessions(sessions);
    await updateEmbed(interaction, session, embed);
    return interaction.reply({ content: "❌ You cancelled your spot.", ephemeral: true });
  }

  if (session[role]) {
    return interaction.reply({ content: `That ${role} spot is already taken!`, ephemeral: true });
  }

  session[role] = interaction.user.id;
  saveSessions(sessions);
  await updateEmbed(interaction, session, embed);
  return interaction.reply({ content: `✅ You signed up as ${role}!`, ephemeral: true });
});

async function updateEmbed(interaction, data, embed) {
  embed.setDescription(
    `**Host:** <@${data.host}>\n**Time:** ${data.time}\n**Duration:** ${data.duration} minutes\n\n` +
    "**Sign-ups:**\n" +
    `🏎️ Driver — ${data.driver ? `<@${data.driver}>` : "None"}\n` +
    `🎓 Trainee — ${data.trainee ? `<@${data.trainee}>` : "None"}\n` +
    `👮 Junior Staff — ${data.junior ? `<@${data.junior}>` : "None"}`
  );
  await interaction.message.edit({ embeds: [embed], components: interaction.message.components });
}

// --- Start Bot ---
client.login(TOKEN);
