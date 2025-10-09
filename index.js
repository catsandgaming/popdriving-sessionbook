require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
  Routes,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  Collection,
} = require('discord.js');
const { REST } = require('@discordjs/rest');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');

// --- Create Discord client ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel],
});

// --- Load or initialize sessions.json ---
let sessions = {};
try {
  if (fs.existsSync(SESSIONS_FILE)) {
    sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE));
  } else {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify({}));
  }
} catch (err) {
  console.error('Error loading sessions.json:', err);
}

// --- Define slash command /sessionbook ---
const sessionBookCommand = new SlashCommandBuilder()
  .setName('sessionbook')
  .setDescription('Book a driving session with a time and duration.')
  .addStringOption(option =>
    option
      .setName('time')
      .setDescription('The start time of the session (e.g., 10:00, 14:30)')
      .setRequired(true),
  )
  .addStringOption(option =>
    option
      .setName('duration')
      .setDescription('The expected length of the session (e.g., 1 hour, 30 minutes)')
      .setRequired(true),
  );

// --- On bot ready ---
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  try {
    console.log('Attempting to aggressively clean up and register global commands...');
    await client.application.commands.set([sessionBookCommand]);
    console.log('✅ /sessionbook command registered successfully.');
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
  }
});

// --- Handle interactions ---
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, options, member, channel } = interaction;

  if (commandName === 'sessionbook') {
    await interaction.deferReply({ ephemeral: true });

    // --- Gather inputs ---
    const time = options.getString('time');
    const duration = options.getString('duration');

    // --- Validate ---
    if (!time || !duration) {
      console.error('Missing time or duration:', { time, duration });
      return interaction.editReply({
        content:
          '❌ The system could not read the **Time** or **Duration** fields. Please retype `/sessionbook` and try again.',
      });
    }

    const channelId = interaction.channelId;
    const hostId = member.id;

    // --- Build embed ---
    const embed = new EmbedBuilder()
      .setColor('#00BFFF')
      .setTitle('🚗 New Driving Session Booked')
      .addFields(
        { name: '🕒 Time', value: time, inline: true },
        { name: '⏱ Duration', value: duration, inline: true },
        { name: '👤 Host', value: `<@${hostId}>`, inline: true },
      )
      .setFooter({ text: 'Pop Driving Session System' })
      .setTimestamp();

    try {
      // --- Post in channel ---
      await channel.send({ embeds: [embed] });

      // --- Save session ---
      sessions[channelId] = { time, duration, hostId };
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));

      return interaction.editReply({
        content: '✅ Your session has been booked and posted successfully!',
      });
    } catch (error) {
      console.error('Error posting session:', error);
      return interaction.editReply({
        content:
          '❌ An error occurred while posting the session. Please check bot permissions and try again.',
      });
    }
  }
});

// --- Login ---
client.login(TOKEN);
