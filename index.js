require('dotenv').config();
const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.send('Bot is running!');
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

// === Discord Bot Setup ===
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const sessions = {}; // Store session signups

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// === Commands ===
const commands = [
  new SlashCommandBuilder()
    .setName('sessionbook')
    .setDescription('Sign up, cancel, or view driving session participants')
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Started refreshing application (/) commands.');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();

// === Interaction Handling ===
client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand() && interaction.commandName === 'sessionbook') {
    const userId = interaction.user.id;
    const guildId = interaction.guildId;

    if (!sessions[guildId]) sessions[guildId] = [];

    const isSignedUp = sessions[guildId].includes(userId);

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(isSignedUp ? 'cancel_session' : 'join_session')
          .setLabel(isSignedUp ? 'Cancel Session' : 'Sign Up')
          .setStyle(isSignedUp ? ButtonStyle.Danger : ButtonStyle.Success)
      );

    // Build list of signed-up users
    const signedUpUsers = sessions[guildId]
      .map(id => `<@${id}>`)
      .join('\n') || 'No users yet.';

    await interaction.reply({
      content: `${isSignedUp ? 'You are signed up!' : 'Sign up for session!'}\n\n**Current Participants:**\n${signedUpUsers}`,
      components: [row],
      ephemeral: true
    });
  }

  if (interaction.isButton()) {
    const userId = interaction.user.id;
    const guildId = interaction.guildId;

    if (!sessions[guildId]) sessions[guildId] = [];

    if (interaction.customId === 'join_session') {
      if (!sessions[guildId].includes(userId)) sessions[guildId].push(userId);
    }

    if (interaction.customId === 'cancel_session') {
      sessions[guildId] = sessions[guildId].filter(id => id !== userId);
    }

    // Update buttons
    const isSignedUpNow = sessions[guildId].includes(userId);
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(isSignedUpNow ? 'cancel_session' : 'join_session')
          .setLabel(isSignedUpNow ? 'Cancel Session' : 'Sign Up')
          .setStyle(isSignedUpNow ? ButtonStyle.Danger : ButtonStyle.Success)
      );

    // Update participant list
    const signedUpUsers = sessions[guildId]
      .map(id => `<@${id}>`)
      .join('\n') || 'No users yet.';

    await interaction.update({
      content: `${isSignedUpNow ? '✅ You signed up!' : '❌ You canceled your session.'}\n\n**Current Participants:**\n${signedUpUsers}`,
      components: [row]
    });
  }
});

// === Role Handling Example ===
client.on('interactionCreate', async interaction => {
  if (interaction.isButton() && interaction.customId.startsWith('role_')) {
    const roleName = interaction.customId.replace('role_', '');
    const member = interaction.member;
    const role = interaction.guild.roles.cache.find(r => r.name === roleName);
    if (!role) return;

    // Remove all tracked roles before adding new one
    const allRoles = ['Role1', 'Role2', 'Role3']; // Replace with your roles
    await member.roles.remove(allRoles.filter(r => r !== roleName));
    await member.roles.add(role);

    await interaction.reply({ content: `✅ You now have the ${roleName} role!`, ephemeral: true });
  }
});

client.login(process.env.DISCORD_TOKEN);
