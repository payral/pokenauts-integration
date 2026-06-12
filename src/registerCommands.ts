import {REST, Routes, SlashCommandBuilder} from 'discord.js';
import {config} from './config';

const commands = [
  new SlashCommandBuilder()
    .setName('ashketchup')
    .setDescription('Run AshKetchup Pokenauts Showdown matches.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('challenge')
        .setDescription('Start a Pokenauts inventory-backed 3v3 Showdown match.')
        .addUserOption(option =>
          option
            .setName('opponent')
            .setDescription('The Discord user to challenge.')
            .setRequired(true)
        )
        .addIntegerOption(option =>
          option
            .setName('wager')
            .setDescription('Optional Pokecoin wager paid by the loser after the result.')
            .setMinValue(0)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('test')
        .setDescription('Solo-test the private Showdown link flow.')
        .addIntegerOption(option =>
          option
            .setName('wager')
            .setDescription('Optional fake Pokecoin wager for payment text preview.')
            .setMinValue(0)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('room')
        .setDescription('Tell AshKetchup which Showdown battle room to watch.')
        .addStringOption(option =>
          option
            .setName('match_id')
            .setDescription('The AshKetchup match ID.')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('room_id')
            .setDescription('The Showdown room ID, like battle-gen9customgame-123.')
            .setRequired(true)
        )
    ),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show AshKetchup battle help.'),
].map(command => command.toJSON());

export async function registerCommands(): Promise<void> {
  if (!config.discordToken) {
    throw new Error('DISCORD_TOKEN is required to register commands');
  }

  if (!config.discordClientId) {
    throw new Error('DISCORD_CLIENT_ID is required to register commands');
  }

  if (!config.discordGuildId) {
    throw new Error('DISCORD_GUILD_ID is required to register commands');
  }

  const rest = new REST({version: '10'}).setToken(config.discordToken);

  console.log(`[discord] Registering commands for guild ${config.discordGuildId}`);
  await rest.put(
    Routes.applicationGuildCommands(
      config.discordClientId,
      config.discordGuildId
    ),
    {body: commands}
  );
  console.log('[discord] Slash commands registered');
}

if (require.main === module) {
  registerCommands().catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[discord] Failed to register commands: ${message}`);
    process.exit(1);
  });
}
