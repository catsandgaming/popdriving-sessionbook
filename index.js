// --- Imports ---
require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
  EmbedBuilder
} = require('discord.js');
const fs = require('fs');

// --- Environment Variables ---
const TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

// Role-based limits
const JUNIOR_STAFF_IDS = (process.env.JUNIOR_STAFF_IDS || "").split(",");
const SESSION_HOST_ID = process.env.SESSION_HOST_ID;
const TRAINEE_ID = process.env.TRAINEE_ID;

// --- Discord Client Setup ---
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// --- Command Definition ---
const sessionBookCommand = new SlashCommandBuilder()
  .setName('sessionbook')
  .setDescription('📘 Book a new driving session (host-only)')
  .addStringOption(option =>
    option
      .setName('time')
      .setDescription('Start time (e.g. 14:00 or 2PM)')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('duration')
      .setDescription('Duration (e.g. 30 minutes, 1 hour)')
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);

// --- Register Slash Commands ---
async function registerCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    const data = [sessionBookCommand.toJSON()];
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: data });
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

// --- Handle Interactions ---
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, member } = interaction;

  if (commandName === 'sessionbook') {
    const userRoles = member.roles.cache.map(r => r.id);

    // --- Permission Check ---
    const isAllowed =
      userRoles.includes(SESSION_HOST_ID) ||
      userRoles.some(r => JUNIOR_STAFF_IDS.includes(r)) ||
      userRoles.includes(TRAINEE_ID);

    if (!isAllowed) {
      return interaction.reply({
        content: '❌ You do not have permission to start a session. Only authorized staff may use this command.',
        ephemeral: true
      });
    }

    const time = interaction.options.getString('time');
    const duration = interaction.options.getString('duration');

    // --- Create Embed ---
    const embed = new EmbedBuilder()
      .setTitle('🚗 Driving Session Booked!')
      .setDescription(`**Host:** ${member.displayName}\n**Time:** ${time}\n**Duration:** ${duration}`)
      .setColor(0x00AE86)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
    console.log(`📘 Session booked by ${member.displayName}: ${time} for ${duration}`);
  }
});

// --- Start Bot ---
client.login(TOKEN);
