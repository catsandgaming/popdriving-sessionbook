require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Simple web server to satisfy Render port requirement
app.get('/', (req, res) => res.send('POP Driving bot is running!'));
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ======== SESSION DATA ========
let session = {
  closed: false,
  hostId: null,
  time: null,
  duration: null,
  signups: {
    driver: [],
    trainee: [],
    junior: []
  }
};

// ======== REGISTER COMMAND ========
const commands = [
  new SlashCommandBuilder()
    .setName('sessionbook')
    .setDescription('Create a new driving session!')
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Started refreshing application (/) commands.');
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();

// ======== HANDLE INTERACTIONS ========
client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'sessionbook') {
        if (session.closed) {
          return interaction.reply({ content: '🚫 Sign-ups are closed!', ephemeral: true });
        }

        session.hostId = interaction.user.id;
        session.time = 'p'; // Replace with actual time
        session.duration = 'p'; // Replace with actual duration

        // Buttons
        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('signup_driver')
              .setLabel('🏎️ Driver')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId('signup_trainee')
              .setLabel('🎓 Trainee')
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId('signup_junior')
              .setLabel('👮 Junior Staff')
              .setStyle(ButtonStyle.Success)
          );

        await interaction.reply({
          embeds: [
            {
              title: '🚗 Driving Session',
              description:
                `**Host:** <@${session.hostId}>\n` +
                `**Time:** ${session.time}\n` +
                `**Duration:** ${session.duration} minutes\n\n` +
                `**Sign-ups:**\n` +
                `🏎️ Driver — None\n` +
                `🎓 Trainee — None\n` +
                `👮 Junior Staff — None`,
              color: 0x00bfff
            }
          ],
          components: [row]
        });
      }
    }

    if (interaction.isButton()) {
      if (session.closed) {
        return interaction.reply({ content: '🚫 Sign-ups are closed!', ephemeral: true });
      }

      // Handle button signups
      switch (interaction.customId) {
        case 'signup_driver':
          if (!session.signups.driver.includes(interaction.user.id)) {
            session.signups.driver.push(interaction.user.id);
          }
          break;
        case 'signup_trainee':
          if (!session.signups.trainee.includes(interaction.user.id)) {
            session.signups.trainee.push(interaction.user.id);
          }
          break;
        case 'signup_junior':
          if (!session.signups.junior.includes(interaction.user.id)) {
            session.signups.junior.push(interaction.user.id);
          }
          break;
      }

      // Update message
      await interaction.update({
        embeds: [
          {
            title: '🚗 Driving Session',
            description:
              `**Host:** <@${session.hostId}>\n` +
              `**Time:** ${session.time}\n` +
              `**Duration:** ${session.duration} minutes\n\n` +
              `**Sign-ups:**\n` +
              `🏎️ Driver — ${session.signups.driver.length || 'None'}\n` +
              `🎓 Trainee — ${session.signups.trainee.length || 'None'}\n` +
              `👮 Junior Staff — ${session.signups.junior.length || 'None'}`,
            color: 0x00bfff
          }
        ],
        components: interaction.message.components
      });
    }
  } catch (error) {
    console.error(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ content: '❌ Something went wrong.' });
    } else {
      await interaction.reply({ content: '❌ Something went wrong.', ephemeral: true });
    }
  }
});

client.once('clientReady', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
