import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  Client,
  GatewayIntentBits,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
  User,
} from 'discord.js';
import {AppConfig} from './config';
import {PokenautsInventoryEntry, PokenautsInventoryTracker} from './pokenautsInventory';
import {
  DiscordMessageRef,
  PlayerBattleRecord,
  PokenautsMatch,
  PokenautsMatchStore,
  PokenautsPlayerKey,
} from './pokenautsMatchStore';
import {
  GeneratedPokenautsTeam,
  generatePokenautsTeam,
  packTeamImport,
} from './showdownTeamBuilder';
import {HumanMatch, showdownHarness} from './showdownHarness';
import {installPokenautsMessageProbe} from './pokenautsMessageProbe';
import {BattleRecordStore} from './battleRecordStore';
import {createShowdownPrivateLinkMatch} from './showdownPokenautsApi';

interface ActivePokenautsContext {
  client: Client;
  config: AppConfig;
  pokenautsMatches: PokenautsMatchStore;
  battleRecords: BattleRecordStore;
}

let activePokenautsContext: ActivePokenautsContext | undefined;

export async function startDiscordBot(
  config: AppConfig
): Promise<Client> {
  if (!config.discordToken) {
    throw new Error('DISCORD_TOKEN is required to start the Discord bot');
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
  const inventoryTracker = new PokenautsInventoryTracker(config);
  const pokenautsMatches = new PokenautsMatchStore(config);
  const battleRecords = new BattleRecordStore();
  activePokenautsContext = {client, config, pokenautsMatches, battleRecords};

  inventoryTracker.install(client);
  installPokenautsMessageProbe(client, config);
  wirePokenautsShowdownEvents(client, config, pokenautsMatches, battleRecords);

  client.once('ready', readyClient => {
    console.log(`[discord] Logged in as ${readyClient.user.tag}`);
    console.log(
      `[discord] Pokenauts inventory tracking enabled in ${
        config.discordMatchChannelId || `#${config.discordMatchChannelName}`
      }`
    );
    console.log(
      `[discord] Result announcements: ${formatResultChannelConfig(config)}`
    );
  });

  client.on('interactionCreate', async interaction => {
    try {
      if (interaction.isButton()) {
        if (interaction.customId.startsWith('pnm:')) {
          await handlePokenautsMatchButton(
            interaction,
            config,
            pokenautsMatches
          );
        } else {
          await handleMatchButton(interaction);
        }
        return;
      }

      if (interaction.isModalSubmit()) {
        await handlePokenautsTeamModal(
          interaction,
          config,
          inventoryTracker,
          pokenautsMatches
        );
        return;
      }

      if (!interaction.isChatInputCommand()) return;

      if (interaction.commandName === 'help') {
        await handleHelpCommand(interaction, config);
        return;
      }

      if (interaction.commandName === 'ashketchup') {
        const subcommand = interaction.options.getSubcommand(true);
        if (subcommand === 'challenge') {
          await handlePokenautsChallengeCommand(interaction, config, pokenautsMatches);
          return;
        }

        if (subcommand === 'test') {
          await handlePokenautsTestCommand(interaction, config, pokenautsMatches);
          return;
        }

        if (subcommand === 'testbot') {
          await handlePokenautsTestBotCommand(interaction, config, pokenautsMatches);
          return;
        }

        if (subcommand === 'room') {
          await handlePokenautsRoomCommand(interaction, config, pokenautsMatches);
          return;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const response = `Could not complete command: ${message}`;

      if (interaction.isRepliable() && (interaction.replied || interaction.deferred)) {
        await interaction.followUp({content: response, ephemeral: true});
      } else if (interaction.isRepliable()) {
        await interaction.reply({content: response, ephemeral: true});
      }
    }
  });

  await client.login(config.discordToken);
  return client;
}

async function handleHelpCommand(
  interaction: ChatInputCommandInteraction,
  config: AppConfig
): Promise<void> {
  const helpSections = [
    [
      `${pokeball(config)} AshKetchup help: your Pokenauts-to-Showdown battle buddy is ready.`,
      '',
      'AshKetchup commands:',
      '`/ashketchup challenge opponent:@user wager:50` - start a 3v3 match card.',
      '`/ashketchup test wager:1` - test the private-link battle flow by yourself.',
      '`/ashketchup room match_id:<id> room_id:battle-gen9customgame-123` - tell AshKetchup where to watch.',
      '',
      'Links:',
      'Source code: <https://github.com/payral/pokenauts-integration>',
      'Showdown fork: <https://github.com/payral/selfhosted-ps>',
    ],
    [
      'Pokenauts basics:',
      '`@Pokenauts bal` - coins.',
      '`@Pokenauts pokemon` - inventory.',
      '`@Pokenauts trade @user` - start trade.',
      '`@Pokenauts trade add <slot>` - add Pokemon.',
      '`@Pokenauts trade add pc <amount>` - add coins.',
      '`@Pokenauts select <slot>` - earns chat XP.',
      '`@Pokenauts favorite <slot>` - protect Pokemon.',
      '`@Pokenauts buy rare candy` - level selected Pokemon.',
    ],
    [
      'Battle notes:',
      'Pokecoins come from catching Pokemon, catch milestones, quests, releasing Pokemon, and player market/trade activity.',
      'Your selected Pokemon gains XP from normal chat messages. Usually only one Pokemon is selected for XP at a time.',
      'Run `@Pokenauts pokemon`, page until your 3 chosen slots show up, then click Submit Team on the match card.',
      'AshKetchup battles cap every Pokemon at level 50, even if your Pokenauts Pokemon is higher level.',
      'Movesets are preset by AshKetchup from local Showdown data, so you only pick the 3 Pokemon, not their moves.',
      'Teams are hidden before battle starts and only reveal as Pokemon enter battle.',
      'Wagers are player-to-player: after AshKetchup posts the winner, the loser pays the winner with a Pokenauts trade.',
    ],
  ].map(section => section.join('\n'));

  await interaction.reply({
    content: helpSections[0],
    ephemeral: true,
  });

  for (const section of helpSections.slice(1)) {
    await interaction.followUp({
      content: section,
      ephemeral: true,
    });
  }
}

async function handlePokenautsTestCommand(
  interaction: ChatInputCommandInteraction,
  config: AppConfig,
  pokenautsMatches: PokenautsMatchStore
): Promise<void> {
  const wager = interaction.options.getInteger('wager') ?? 0;
  const botUser = interaction.client.user;
  if (!botUser) {
    await interaction.reply({content: 'AshKetchup is not ready yet.', ephemeral: true});
    return;
  }

  const match = pokenautsMatches.createPrivateLinkTestMatch(
    interaction.user.id,
    botUser.id,
    wager
  );
  pokenautsMatches.submitFixedTeam(
    match.id,
    'opponent',
    botUser.username,
    buildSoloTestBotTeam(config)
  );

  const channel = await resolveMatchChannel(interaction, config);
  const sentMessage = await channel.send({
    content: buildPokenautsPublicMatchMessage(match, config),
    components: buildPokenautsMatchComponents(match),
  });
  pokenautsMatches.setDiscordMessage(match.id, sentMessage.channelId, sentMessage.id);

  await interaction.reply({
    content:
      `${pokeball(config)} Solo test queued! Posted match ${match.id} in ${formatChannelName(channel)}. ` +
      'Run `@Pokenauts pokemon`, click Submit Team, and AshKetchup will give you both private Showdown links.',
    ephemeral: true,
  });
}

async function handlePokenautsChallengeCommand(
  interaction: ChatInputCommandInteraction,
  config: AppConfig,
  pokenautsMatches: PokenautsMatchStore
): Promise<void> {
  const opponent = interaction.options.getUser('opponent', true);
  const wager = interaction.options.getInteger('wager') ?? 0;

  if (opponent.bot) {
    await interaction.reply({
      content: 'Challenge a human player, not a bot.',
      ephemeral: true,
    });
    return;
  }

  const match = pokenautsMatches.createMatch(interaction.user.id, opponent.id, wager);
  const channel = await resolveMatchChannel(interaction, config);
  const sentMessage = await channel.send({
    content: buildPokenautsPublicMatchMessage(match, config),
    components: buildPokenautsMatchComponents(match),
  });
  pokenautsMatches.setDiscordMessage(match.id, sentMessage.channelId, sentMessage.id);

  await interaction.reply({
    content:
      `${pokeball(config)} A challenger appeared! Created AshKetchup match ${match.id} against ${opponent}. ` +
      `Posted it in ${formatChannelName(channel)}.`,
    ephemeral: true,
  });
}

async function handlePokenautsTestBotCommand(
  interaction: ChatInputCommandInteraction,
  config: AppConfig,
  pokenautsMatches: PokenautsMatchStore
): Promise<void> {
  const wager = interaction.options.getInteger('wager') ?? 0;
  const botUser = interaction.client.user;
  if (!botUser) {
    await interaction.reply({content: 'AshKetchup is not ready yet.', ephemeral: true});
    return;
  }

  const match = pokenautsMatches.createSoloBotTestMatch(
    interaction.user.id,
    botUser.id,
    wager
  );
  pokenautsMatches.submitFixedTeam(
    match.id,
    'opponent',
    config.showdownTestBotAUsername,
    buildSoloTestBotTeam(config)
  );

  const channel = await resolveMatchChannel(interaction, config);
  const sentMessage = await channel.send({
    content: buildPokenautsPublicMatchMessage(match, config),
    components: buildPokenautsMatchComponents(match),
  });
  pokenautsMatches.setDiscordMessage(match.id, sentMessage.channelId, sentMessage.id);

  await interaction.reply({
    content:
      `${pokeball(config)} Training battle queued! Created solo test match ${match.id}. Run \`@Pokenauts pokemon\`, submit your 3 slots, ` +
      `then ${config.showdownTestBotAUsername} will challenge your submitted Showdown username.`,
    ephemeral: true,
  });
}

async function handlePokenautsRoomCommand(
  interaction: ChatInputCommandInteraction,
  config: AppConfig,
  pokenautsMatches: PokenautsMatchStore
): Promise<void> {
  const matchId = interaction.options.getString('match_id', true);
  const roomId = interaction.options.getString('room_id', true).trim();
  const match = pokenautsMatches.getMatch(matchId);

  if (!match) {
    await interaction.reply({content: 'Pokenauts match not found.', ephemeral: true});
    return;
  }

  if (!canManagePokenautsMatch(interaction, match, config)) {
    await interaction.reply({
      content: 'Only a match participant, banker, or server manager can set the room.',
      ephemeral: true,
    });
    return;
  }

  if (!roomId.startsWith('battle-')) {
    await interaction.reply({
      content: 'room_id must be a battle room id, like battle-gen9customgame-123.',
      ephemeral: true,
    });
    return;
  }

  await showdownHarness.connectCoordinator();
  showdownHarness.coordinator.joinRoom(roomId);
  const updatedMatch = pokenautsMatches.watchRoom(match.id, roomId);
  await updatePokenautsMatchMessage(interaction.client, config, updatedMatch);

  await interaction.reply({
    content:
      `${pokeball(config)} AshKetchup is watching! This match is happening. Watch here: ` +
      `${buildShowdownRoomUrl(updatedMatch)}`,
    ephemeral: true,
  });
}

async function handlePokenautsTeamModal(
  interaction: ModalSubmitInteraction,
  config: AppConfig,
  inventoryTracker: PokenautsInventoryTracker,
  pokenautsMatches: PokenautsMatchStore
): Promise<void> {
  const [, action, matchId] = interaction.customId.split(':');
  if (action !== 'team') return;

  const match = pokenautsMatches.getMatch(matchId);
  if (!match) {
    await interaction.reply({content: 'That match no longer exists.', ephemeral: true});
    return;
  }

  const showdownUsername = match.testMode && !match.privateLinkTest
    ? interaction.fields.getTextInputValue('showdown_username').trim()
    : interaction.user.username;
  const slots = ['slot_1', 'slot_2', 'slot_3'].map(inputId =>
    Number.parseInt(interaction.fields.getTextInputValue(inputId).trim(), 10)
  );

  if (slots.some(slot => !Number.isInteger(slot) || slot <= 0)) {
    await interaction.reply({
      content: 'All three slot values must be positive inventory numbers.',
      ephemeral: true,
    });
    return;
  }

  if (new Set(slots).size !== slots.length) {
    await interaction.reply({
      content: 'Choose three different inventory slots.',
      ephemeral: true,
    });
    return;
  }

  const entries = inventoryTracker.getEntries(interaction.user.id, slots);
  const foundSlots = new Set(entries.map(entry => entry.slot));
  const missingSlots = slots.filter(slot => !foundSlots.has(slot));

  if (missingSlots.length > 0) {
    await interaction.reply({
      content:
        `I have not seen slot(s) ${missingSlots.join(', ')} in your Pokenauts inventory yet. ` +
        'Run `@Pokenauts pokemon` in the match channel and page until those slots are visible, then submit again.',
      ephemeral: true,
    });
    return;
  }

  const updatedMatch = pokenautsMatches.submitTeam(
    match.id,
    interaction.user.id,
    showdownUsername,
    entries
  );
  await updatePokenautsMatchMessage(interaction.client, config, updatedMatch);
  const playerKey = pokenautsMatches.getPlayerKey(updatedMatch, interaction.user.id);

  await interaction.reply({
    content: playerKey
      ? buildPrivatePokenautsTeamMessage(updatedMatch, playerKey)
      : `${pokeball(config)} Team locked in. Time to battle.`,
    ephemeral: true,
  });

  const privateLinkMessage = await maybeCreatePrivateShowdownLinks(
    interaction.client,
    config,
    pokenautsMatches,
    updatedMatch,
    playerKey
  );
  if (privateLinkMessage) {
    await interaction.followUp({content: privateLinkMessage, ephemeral: true});
  }

  const soloStartMessage = await maybeStartSoloBotChallenge(
    interaction.client,
    config,
    pokenautsMatches,
    updatedMatch
  );
  if (soloStartMessage) {
    await interaction.followUp({content: soloStartMessage, ephemeral: true});
  }
}

async function handlePokenautsMatchButton(
  interaction: ButtonInteraction,
  config: AppConfig,
  pokenautsMatches: PokenautsMatchStore
): Promise<void> {
  const [, action, matchId] = interaction.customId.split(':');
  const match = pokenautsMatches.getMatch(matchId);

  if (!match) {
    await interaction.reply({content: 'That match no longer exists.', ephemeral: true});
    return;
  }

  if (action === 'submit') {
    await showTeamSubmissionModal(interaction, match);
    return;
  }

  if (action === 'reveal') {
    await revealPokenautsTeam(interaction, match, pokenautsMatches);
    return;
  }

  if (action === 'join') {
    await showPrivateJoinLink(interaction, match, pokenautsMatches);
    return;
  }

  if (action === 'paid') {
    await confirmPokenautsWagerPaid(interaction, config, pokenautsMatches, match);
    return;
  }

  if (action === 'wagercancel') {
    await cancelPokenautsWager(interaction, config, pokenautsMatches, match);
    return;
  }

  if (action === 'tradehelp') {
    await showPokenautsTradeHelp(interaction, config, match);
    return;
  }

  await interaction.reply({
    content: 'That match action is no longer available.',
    ephemeral: true,
  });
}

async function showTeamSubmissionModal(
  interaction: ButtonInteraction,
  match: PokenautsMatch
): Promise<void> {
  const playerKey = getParticipantKey(match, interaction.user.id);
  if (!playerKey) {
    await interaction.reply({
      content: 'Only match participants can submit a team.',
      ephemeral: true,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`pnm:team:${match.id}`)
    .setTitle('Submit Pokenauts Team');

  modal.addComponents(
    ...(match.testMode && !match.privateLinkTest
      ? [
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId('showdown_username')
              .setLabel('Your Showdown username')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          ),
        ]
      : []),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('slot_1')
        .setLabel('Pokenauts slot 1')
        .setPlaceholder('Example: 1')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('slot_2')
        .setLabel('Pokenauts slot 2')
        .setPlaceholder('Example: 19')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('slot_3')
        .setLabel('Pokenauts slot 3')
        .setPlaceholder('Example: 33')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    )
  );

  await interaction.showModal(modal);
}

async function showPrivateJoinLink(
  interaction: ButtonInteraction,
  match: PokenautsMatch,
  pokenautsMatches: PokenautsMatchStore
): Promise<void> {
  const playerKey = pokenautsMatches.getPlayerKey(match, interaction.user.id);
  if (!playerKey) {
    await interaction.reply({
      content: 'Only match participants can get a private join link.',
      ephemeral: true,
    });
    return;
  }

  const joinLink = match.privateJoinLinks[playerKey];
  if (!joinLink) {
    await interaction.reply({
      content: 'Your private Showdown link is not ready yet. Both teams need to be submitted first.',
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: buildPrivatePokenautsJoinMessage(match, playerKey),
    ephemeral: true,
  });
}

async function revealPokenautsTeam(
  interaction: ButtonInteraction,
  match: PokenautsMatch,
  pokenautsMatches: PokenautsMatchStore
): Promise<void> {
  const playerKey = pokenautsMatches.getPlayerKey(match, interaction.user.id);
  if (!playerKey) {
    await interaction.reply({
      content: 'Only match participants can reveal a team.',
      ephemeral: true,
    });
    return;
  }

  const team = match.teams[playerKey];
  if (!team) {
    await interaction.reply({
      content: 'Submit your team first, then AshKetchup can reveal your private import text.',
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: buildPrivatePokenautsTeamMessage(match, playerKey),
    ephemeral: true,
  });
}

async function confirmPokenautsWagerPaid(
  interaction: ButtonInteraction,
  config: AppConfig,
  pokenautsMatches: PokenautsMatchStore,
  match: PokenautsMatch
): Promise<void> {
  const validationError = validateWagerResultAction(interaction, match, config);
  if (validationError) {
    await interaction.reply({content: validationError, ephemeral: true});
    return;
  }

  await interaction.deferReply({ephemeral: true});
  const updatedMatch = pokenautsMatches.confirmPayout(match.id);
  await updatePokenautsResultMessages(interaction.client, config, updatedMatch);
  await interaction.editReply(`${pokeball(config)} Wager marked paid. Scoreboard updated.`);
}

async function cancelPokenautsWager(
  interaction: ButtonInteraction,
  config: AppConfig,
  pokenautsMatches: PokenautsMatchStore,
  match: PokenautsMatch
): Promise<void> {
  const validationError = validateWagerResultAction(interaction, match, config, {
    allowTie: true,
  });
  if (validationError) {
    await interaction.reply({content: validationError, ephemeral: true});
    return;
  }

  await interaction.deferReply({ephemeral: true});
  const updatedMatch = pokenautsMatches.cancelWager(match.id);
  await updatePokenautsResultMessages(interaction.client, config, updatedMatch);
  await interaction.editReply(`${pokeball(config)} Wager canceled. Scoreboard updated.`);
}

async function showPokenautsTradeHelp(
  interaction: ButtonInteraction,
  config: AppConfig,
  match: PokenautsMatch
): Promise<void> {
  const participants = getWagerParticipants(match);
  if (!participants || match.wager === 0 || match.testMode) {
    await interaction.reply({
      content: 'There are no Pokenauts trade instructions for this match.',
      ephemeral: true,
    });
    return;
  }

  if (match.wagerCanceled) {
    await interaction.reply({
      content: 'This wager was canceled, so no Pokenauts trade is needed.',
      ephemeral: true,
    });
    return;
  }

  if (match.payoutConfirmed) {
    await interaction.reply({
      content: 'This wager is already marked paid.',
      ephemeral: true,
    });
    return;
  }

  if (
    interaction.user.id !== participants.winnerDiscordId &&
    interaction.user.id !== participants.loserDiscordId
  ) {
    await interaction.reply({
      content: 'Only the winner or loser can view the private trade instructions.',
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: buildPokenautsTradeHelpMessage(match, interaction.user.id, config),
    ephemeral: true,
  });
}

async function handlePokenautsMatchCommand(
  interaction: ChatInputCommandInteraction,
  config: AppConfig
): Promise<void> {
  const playerA = interaction.options.getUser('player_a', true);
  const playerAShowdown = interaction.options.getString('player_a_showdown', true);
  const playerB = interaction.options.getUser('player_b', true);
  const playerBShowdown = interaction.options.getString('player_b_showdown', true);

  if (playerA.id === playerB.id) {
    await interaction.reply({
      content: 'Player A and Player B must be different Discord users.',
      ephemeral: true,
    });
    return;
  }

  const match = showdownHarness.createHumanMatch({
    playerAUsername: playerAShowdown,
    playerBUsername: playerBShowdown,
    playerADiscordId: playerA.id,
    playerBDiscordId: playerB.id,
    pmUsers: false,
  });

  const channel = await resolveMatchChannel(interaction, config);
  await channel.send({
    content: buildPublicMatchMessage(match, playerA, playerB),
    components: [buildMatchButtons(match.id)],
  });

  await interaction.reply({
    content:
      `Created Pokenauts match ${match.id} and posted it in ` +
      `${formatChannelName(channel)}.`,
    ephemeral: true,
  });
}

async function handleMatchButton(interaction: ButtonInteraction): Promise<void> {
  const [namespace, action, matchId, playerKey] = interaction.customId.split(':');
  if (namespace !== 'pokenauts' || action !== 'team') return;

  if (playerKey !== 'a' && playerKey !== 'b') {
    await interaction.reply({content: 'Unknown team button.', ephemeral: true});
    return;
  }

  const match = showdownHarness.getHumanMatch(matchId);
  if (!match) {
    await interaction.reply({content: 'That match no longer exists.', ephemeral: true});
    return;
  }

  const player = match.players[playerKey];
  if (player.discordUserId && player.discordUserId !== interaction.user.id) {
    await interaction.reply({
      content: 'That team is assigned to the other player.',
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: buildPrivateTeamMessage(match, playerKey),
    ephemeral: true,
  });
}

async function resolveMatchChannel(
  interaction: ChatInputCommandInteraction,
  config: AppConfig
): Promise<TextChannel> {
  if (config.discordMatchChannelId) {
    const channel = await interaction.client.channels.fetch(config.discordMatchChannelId);
    if (channel instanceof TextChannel) return channel;
    throw new Error('DISCORD_MATCH_CHANNEL_ID does not point to a text channel');
  }

  const guild = interaction.guild;
  if (!guild) {
    throw new Error('This command must be used in a Discord server');
  }

  const channels = await guild.channels.fetch();
  const channel = channels.find(
    (candidate): candidate is TextChannel =>
      candidate instanceof TextChannel &&
      candidate.name === config.discordMatchChannelName
  );

  if (!channel) {
    throw new Error(`Could not find #${config.discordMatchChannelName}`);
  }

  return channel;
}

function wirePokenautsShowdownEvents(
  client: Client,
  config: AppConfig,
  pokenautsMatches: PokenautsMatchStore,
  battleRecords: BattleRecordStore
): void {
  for (const showdownClient of [showdownHarness.coordinator, showdownHarness.testBotA]) {
    showdownClient.on('message', message => {
      pokenautsMatches.recordShowdownMessage(message);
    });

    showdownClient.on('battleEnded', result => {
      const match = pokenautsMatches.recordBattleEnded(
        result.roomId,
        result.winner,
        result.tied
      );
      if (!match) return;

      updatePokenautsMatchMessage(client, config, match).catch(error => {
        console.warn(`[discord] Could not update match ${match.id}: ${formatError(error)}`);
      });
      announcePokenautsResult(client, config, pokenautsMatches, battleRecords, match).catch(error => {
        console.warn(`[discord] Could not announce match ${match.id}: ${formatError(error)}`);
      });
    });
  }

  showdownHarness.testBotA.on('battleStarted', ({roomId}) => {
    const match = pokenautsMatches.findPendingSoloBotBattle();
    if (!match) return;

    const updatedMatch = pokenautsMatches.watchRoom(match.id, roomId);
    updatePokenautsMatchMessage(client, config, updatedMatch).catch(error => {
      console.warn(`[discord] Could not update solo test match ${match.id}: ${formatError(error)}`);
    });
    announceSoloRoomDetected(client, config, updatedMatch).catch(error => {
      console.warn(`[discord] Could not announce solo room ${roomId}: ${formatError(error)}`);
    });
  });
}

async function maybeStartSoloBotChallenge(
  client: Client,
  config: AppConfig,
  pokenautsMatches: PokenautsMatchStore,
  match: PokenautsMatch
): Promise<string | undefined> {
  if (!match.testMode || match.privateLinkTest || match.botChallengeSent) return undefined;
  const humanTeam = match.teams.challenger;
  const botTeam = match.teams.opponent;
  if (!humanTeam || !botTeam || !match.escrowConfirmed) return undefined;

  try {
    const packedBotTeam = packTeamImport(config, botTeam.importText);
    await showdownHarness.challengeWithTestBot(
      humanTeam.showdownUsername,
      packedBotTeam,
      match.format
    );
    const updatedMatch = pokenautsMatches.markBotChallengeSent(match.id);
    await updatePokenautsMatchMessage(client, config, updatedMatch);
    return (
      `${pokeball(config)} The training bot threw down the gauntlet: ${config.showdownTestBotAUsername} challenged ${humanTeam.showdownUsername}. ` +
      'Import your revealed team, accept the challenge, then forfeit when you want the bot-win test result.'
    );
  } catch (error) {
    return `Could not send the TestBotA challenge yet: ${formatError(error)}`;
  }
}

async function maybeCreatePrivateShowdownLinks(
  client: Client,
  config: AppConfig,
  pokenautsMatches: PokenautsMatchStore,
  match: PokenautsMatch,
  requestingPlayerKey: PokenautsPlayerKey | undefined
): Promise<string | undefined> {
  if ((match.testMode && !match.privateLinkTest) || match.privateLinksCreated) return undefined;
  if (!match.teams.challenger || !match.teams.opponent) return undefined;

  try {
    const challenger = await client.users.fetch(match.challengerDiscordId);
    const opponent = await client.users.fetch(match.opponentDiscordId);
    const privateMatch = await createShowdownPrivateLinkMatch(config, match, {
      challenger: {
        key: 'challenger',
        discordId: match.challengerDiscordId,
        displayName: displayNameForShowdown(challenger),
      },
      opponent: {
        key: 'opponent',
        discordId: match.opponentDiscordId,
        displayName: displayNameForShowdown(opponent),
      },
    });

    const updatedMatch = pokenautsMatches.markPrivateLinksCreated(
      match.id,
      privateMatch.roomId,
      privateMatch.joinLinks,
      privateMatch.players
    );
    await updatePokenautsMatchMessage(client, config, updatedMatch);

    if (!requestingPlayerKey) {
      return `${pokeball(config)} Private Showdown links are ready. Click Join Battle on the match card.`;
    }
    return buildPrivatePokenautsJoinMessage(updatedMatch, requestingPlayerKey);
  } catch (error) {
    return `Could not create private Showdown links yet: ${formatError(error)}`;
  }
}

export async function handlePokenautsShowdownResultCallback(
  requestBody: unknown,
  authorizationHeader: string | undefined
): Promise<{statusCode: number; body: Record<string, unknown>}> {
  if (!activePokenautsContext) {
    return {statusCode: 503, body: {ok: false, error: 'Discord bot is not ready'}};
  }

  const {client, config, pokenautsMatches, battleRecords} = activePokenautsContext;
  const expectedSecret = config.pokenautsShowdownApiSecret;
  const providedSecret = authorizationHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return {statusCode: 403, body: {ok: false, error: 'Missing or invalid Pokenauts API secret'}};
  }

  const payload = requestBody as {
    matchId?: string;
    roomId?: string;
    winner?: string | null;
    winnerDiscordId?: string | null;
    tied?: boolean;
    players?: Array<{
      key: PokenautsPlayerKey;
      discordId: string;
      showdownName: string;
      slot: string;
    }>;
  };

  if (!payload.matchId || !payload.roomId) {
    return {statusCode: 400, body: {ok: false, error: 'matchId and roomId are required'}};
  }

  const match = pokenautsMatches.recordPrivateBattleResult({
    matchId: payload.matchId,
    roomId: payload.roomId,
    winner: payload.winner,
    winnerDiscordId: payload.winnerDiscordId,
    tied: payload.tied,
    players: payload.players,
  });
  if (!match) return {statusCode: 404, body: {ok: false, error: 'Match not found'}};

  await updatePokenautsMatchMessage(client, config, match);
  await announcePokenautsResult(client, config, pokenautsMatches, battleRecords, match);

  return {statusCode: 200, body: {ok: true}};
}

async function announceSoloRoomDetected(
  client: Client,
  config: AppConfig,
  match: PokenautsMatch
): Promise<void> {
  if (!match.discordChannelId || !match.testMode || !match.roomId) return;

  const channel = await client.channels.fetch(match.discordChannelId);
  if (!(channel instanceof TextChannel)) return;

  console.log(`Solo test match ${match.id}: AshKetchup is watching ${match.roomId}.`);
  await channel.send(
    `${pokeball(config)} AshKetchup is watching! This match is happening. Watch here: ${buildShowdownRoomUrl(match)}`
  );
}

function buildSoloTestBotTeam(config: AppConfig): GeneratedPokenautsTeam {
  const now = new Date().toISOString();
  const entries: PokenautsInventoryEntry[] = [
    {
      slot: 9001,
      species: 'Pikachu',
      level: 50,
      ivPercent: 100,
      rawLine: 'Solo test bot Pikachu',
      sourceMessageId: 'solo-test-bot',
      updatedAt: now,
    },
    {
      slot: 9002,
      species: 'Charizard',
      level: 50,
      ivPercent: 100,
      rawLine: 'Solo test bot Charizard',
      sourceMessageId: 'solo-test-bot',
      updatedAt: now,
    },
    {
      slot: 9003,
      species: 'Blastoise',
      level: 50,
      ivPercent: 100,
      rawLine: 'Solo test bot Blastoise',
      sourceMessageId: 'solo-test-bot',
      updatedAt: now,
    },
  ];

  return generatePokenautsTeam(config, entries);
}

async function updatePokenautsMatchMessage(
  client: Client,
  config: AppConfig,
  match: PokenautsMatch
): Promise<void> {
  if (!match.discordChannelId || !match.discordMessageId) return;

  const channel = await client.channels.fetch(match.discordChannelId);
  if (!(channel instanceof TextChannel)) return;

  const message = await channel.messages.fetch(match.discordMessageId);
  await message.edit({
    content: buildPokenautsPublicMatchMessage(match, config),
    components: buildPokenautsMatchComponents(match),
  });
}

async function updatePokenautsResultMessages(
  client: Client,
  config: AppConfig,
  match: PokenautsMatch
): Promise<void> {
  const content = buildPokenautsResultMessage(match, config);
  const components = buildPokenautsResultComponents(match);

  for (const messageRef of match.resultDiscordMessages) {
    try {
      const channel = await client.channels.fetch(messageRef.channelId);
      if (!(channel instanceof TextChannel)) continue;

      const message = await channel.messages.fetch(messageRef.messageId);
      await message.edit({content, components});
    } catch (error) {
      console.warn(
        `[discord] Could not update result message ${messageRef.messageId}: ${formatError(error)}`
      );
    }
  }
}

async function announcePokenautsResult(
  client: Client,
  config: AppConfig,
  pokenautsMatches: PokenautsMatchStore,
  battleRecords: BattleRecordStore,
  match: PokenautsMatch
): Promise<void> {
  if (match.resultPosted || !match.discordChannelId) return;

  const resultRecords = await battleRecords.recordMatchResult(match);
  const matchWithRecords = pokenautsMatches.setResultRecords(match.id, resultRecords);

  const channels = await resolveResultChannels(client, config, matchWithRecords);
  if (channels.length === 0) {
    console.warn(`[discord] Could not resolve any result channels for match ${match.id}`);
    return;
  }

  const resultMessage = buildPokenautsResultMessage(matchWithRecords, config);
  const resultComponents = buildPokenautsResultComponents(matchWithRecords);
  const sentMessages: DiscordMessageRef[] = [];
  for (const channel of channels) {
    try {
      const sentMessage = await channel.send({
        content: resultMessage,
        components: resultComponents,
      });
      sentMessages.push({
        channelId: sentMessage.channelId,
        messageId: sentMessage.id,
      });
    } catch (error) {
      console.warn(
        `[discord] Could not send result for match ${match.id} to #${channel.name}: ${formatError(error)}`
      );
    }
  }
  pokenautsMatches.markResultPosted(matchWithRecords.id, sentMessages);
}

async function resolveResultChannels(
  client: Client,
  config: AppConfig,
  match: PokenautsMatch
): Promise<TextChannel[]> {
  const channels = new Map<string, TextChannel>();
  const hasExplicitResultChannels =
    config.discordResultChannelIds.length > 0 ||
    config.discordResultChannelNames.length > 0;

  if (!hasExplicitResultChannels && match.discordChannelId) {
    await addTextChannelById(client, channels, match.discordChannelId);
    return [...channels.values()];
  }

  for (const channelId of config.discordResultChannelIds) {
    await addTextChannelById(client, channels, channelId);
  }

  if (config.discordResultChannelNames.length > 0) {
    await addTextChannelsByName(client, config, channels);
  }

  return [...channels.values()];
}

async function addTextChannelById(
  client: Client,
  channels: Map<string, TextChannel>,
  channelId: string
): Promise<void> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel instanceof TextChannel) {
      channels.set(channel.id, channel);
      return;
    }
    console.warn(`[discord] Result channel ${channelId} is not a text channel`);
  } catch (error) {
    console.warn(`[discord] Could not fetch result channel ${channelId}: ${formatError(error)}`);
  }
}

async function addTextChannelsByName(
  client: Client,
  config: AppConfig,
  channels: Map<string, TextChannel>
): Promise<void> {
  const guild = config.discordGuildId
    ? await client.guilds.fetch(config.discordGuildId)
    : client.guilds.cache.first();

  if (!guild) {
    console.warn('[discord] Cannot resolve named result channels without a guild');
    return;
  }

  const guildChannels = await guild.channels.fetch();
  const wantedNames = new Set(config.discordResultChannelNames.map(name => normalizeChannelName(name)));

  for (const channel of guildChannels.values()) {
    if (!(channel instanceof TextChannel)) continue;
    if (wantedNames.has(normalizeChannelName(channel.name))) {
      channels.set(channel.id, channel);
    }
  }

  for (const name of wantedNames) {
    const found = [...channels.values()].some(
      channel => normalizeChannelName(channel.name) === name
    );
    if (!found) {
      console.warn(`[discord] Could not find result channel named #${name}`);
    }
  }
}

function buildPokenautsPublicMatchMessage(
  match: PokenautsMatch,
  config?: AppConfig
): string {
  const challengerTeam = match.teams.challenger;
  const opponentTeam = match.teams.opponent;
  const steps =
    match.privateLinkTest
      ? [
          '1. Run `@Pokenauts pokemon` in this channel and page until your 3 chosen slots are visible.',
          '2. Click Submit Team and enter your 3 inventory slot numbers.',
          '3. AshKetchup will privately give you both Showdown links.',
          '4. Open each link in a different browser/incognito window, then forfeit one side to test the result.',
        ]
      : match.testMode
      ? [
          '1. Go to Showdown and create a username:',
          match.showdownUrl,
          '2. Run `@Pokenauts pokemon` in this channel and page until your 3 chosen slots are visible.',
          '3. Click Submit Team to get your private Teambuilder import text.',
          `4. ${config?.showdownTestBotAUsername || 'PokenautsTestBotA'} auto-challenges after your team is submitted. Import your team, accept the challenge, then forfeit when you want the test result.`,
        ]
      : match.wager > 0
      ? [
          '1. Run `@Pokenauts pokemon` in this channel and page until your 3 chosen slots are visible.',
          '2. Click Submit Team and enter your 3 inventory slot numbers.',
          '3. When both teams are selected, click Join Battle for your private Showdown link.',
          `4. Wager agreed: loser pays winner ${match.wager} Pokecoins after AshKetchup posts the result.`,
        ]
      : [
          '1. Run `@Pokenauts pokemon` in this channel and page until your 3 chosen slots are visible.',
          '2. Click Submit Team and enter your 3 inventory slot numbers.',
          '3. When both teams are selected, click Join Battle for your private Showdown link.',
        ];

  return [
    `${pokeball(config)} ${match.testMode ? 'Training battle!' : 'A challenger appeared!'} AshKetchup Showdown 3v3`,
    `<@${match.challengerDiscordId}> vs <@${match.opponentDiscordId}>`,
    formatWagerLine(match),
    match.testMode && match.wager > 0
      ? 'Solo test mode: coins are fake/auto-confirmed and no real Pokecoins should move.'
      : '',
    `Status: ${formatMatchStatus(match.status)}`,
    `Format: ${formatMatchFormat(match)}`,
    match.privateLinksCreated
      ? `${pokeball(config)} Private Showdown links are ready. Each player can click Join Battle.`
      : '',
    '',
    'Steps:',
    ...steps,
    match.testMode && !match.privateLinkTest
      ? 'AshKetchup should auto-detect the battle room after you accept.'
      : '',
    '',
    `Challenger team: ${formatTeamSelectionStatus(challengerTeam)}`,
    `Opponent team: ${formatTeamSelectionStatus(opponentTeam)}`,
    `Battle room: ${match.roomId || 'not set'}`,
    formatWinnerLine(match),
    formatAuditLine(match),
  ]
    .filter(Boolean)
    .join('\n');
}

function buildPokenautsMatchComponents(
  match: PokenautsMatch
): Array<ActionRowBuilder<ButtonBuilder>> {
  if (match.privateLinksCreated && match.status !== 'ended' && match.status !== 'refunded') {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`pnm:join:${match.id}`)
          .setLabel('Join Battle')
          .setStyle(ButtonStyle.Success)
      ),
    ];
  }

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`pnm:submit:${match.id}`)
        .setLabel('Submit Team')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(match.status === 'ended' || match.status === 'refunded')
    ),
  ];
}

function formatWagerLine(match: PokenautsMatch): string {
  if (match.wager === 0) return '';
  return `Wager: ${match.wager} Pokecoins | loser pays winner after the result`;
}

function buildPrivatePokenautsTeamMessage(
  match: PokenautsMatch,
  playerKey: PokenautsPlayerKey
): string {
  if (!match.testMode || match.privateLinkTest) {
    if (match.privateJoinLinks[playerKey]) return buildPrivatePokenautsJoinMessage(match, playerKey);

    const team = match.teams[playerKey];
    return [
      `${pokeball()} Team locked in.`,
      'AshKetchup is waiting for both trainers to submit. When the private Showdown links are ready, click Join Battle on the match card.',
      '',
      team ? formatPrivateSelectedPokemon(team) : '',
    ].filter(Boolean).join('\n');
  }

  const team = match.teams[playerKey];
  const opponentKey = playerKey === 'challenger' ? 'opponent' : 'challenger';
  const opponentTeam = match.teams[opponentKey];
  if (!team) return 'Submit your team first.';

  const challengeCommand = `/challenge ${
    opponentTeam?.showdownUsername || '<opponent-showdown-username>'
  }, ${match.format}`;
  const roomCommand = `/ashketchup room match_id:${match.id} room_id:<battle-room-id>`;

  return [
    `${pokeball()} Your Pokenauts 3v3 match: ${match.id}`,
    `Showdown link: ${match.showdownUrl}`,
    `Your Showdown username: ${team.showdownUsername}`,
    opponentTeam ? `Opponent: ${opponentTeam.showdownUsername}` : 'Opponent: waiting for team submission',
    opponentTeam && (match.testMode && playerKey === 'challenger')
      ? `Accept the challenge from ${opponentTeam.showdownUsername} in ${match.format}.`
      : opponentTeam && playerKey === 'challenger'
      ? ['Challenge with this exact command:', '```', challengeCommand, '```'].join('\n')
      : opponentTeam
      ? `Accept the challenge from ${opponentTeam.showdownUsername} in ${match.format}.`
      : ['Challenge with this command once you know their Showdown username:', '```', challengeCommand, '```'].join('\n'),
    match.testMode
      ? 'For the solo test, AshKetchup should auto-detect the battle room after you accept.'
      : [
          'After the battle starts, copy the battle room id from the Showdown URL.',
          'Example: if the URL ends in `/battle-gen9customgame-123`, the room id is `battle-gen9customgame-123`.',
          'Then run:',
          '```',
          roomCommand,
          '```',
        ].join('\n'),
    '',
    'Selected Pokenauts Pokemon:',
    team.expectedPokemon
      .map(
        pokemon =>
          `- Slot ${pokemon.slot}: ${pokemon.species} L${pokemon.pokenautsLevel} -> Showdown L${pokemon.showdownLevel}`
      )
      .join('\n'),
    '',
    `Import this team in Teambuilder for ${formatTeambuilderFormat(match.format)}:`,
    '```',
    team.importText,
    '```',
  ].join('\n');
}

function buildPrivatePokenautsJoinMessage(
  match: PokenautsMatch,
  playerKey: PokenautsPlayerKey
): string {
  const team = match.teams[playerKey];
  const joinLink = match.privateJoinLinks[playerKey];
  if (!team || !joinLink) return `${pokeball()} Your private Showdown link is not ready yet.`;

  if (match.privateLinkTest) {
    return [
      `${pokeball()} Solo private-link test is ready.`,
      `Your side: ${match.privateJoinLinks.challenger || 'not ready'}`,
      `AshKetchup test side: ${match.privateJoinLinks.opponent || 'not ready'}`,
      '',
      'Open each link in a different browser/incognito window. Forfeit one side when you want to test the result post.',
      '',
      'Your selected Pokenauts Pokemon:',
      formatPrivateSelectedPokemon(team),
    ].join('\n');
  }

  return [
    `${pokeball()} Your private AshKetchup battle link is ready.`,
    `Go here: ${joinLink}`,
    '',
    'Your selected Pokenauts Pokemon:',
    formatPrivateSelectedPokemon(team),
    '',
    'No Teambuilder needed. Open the link and AshKetchup will drop you into the battle with this team.',
  ].join('\n');
}

function buildPokenautsResultMessage(match: PokenautsMatch, config: AppConfig): string {
  if (match.testMode) {
    const winner =
      match.winnerDiscordId
        ? formatDiscordUserWithRecord(match, match.winnerDiscordId)
        : match.winnerShowdownUsername || 'unknown';
    const payoutPreview = match.wager === 0
      ? ''
      : match.tied
      ? `Wager output preview: refund ${match.wager} Pokecoins to the human player.`
      : `Wager output preview: loser would pay ${winner} ${match.wager} Pokecoins.`;

    return [
      `${pokeball(config)} Training battle is in the books.`,
      `Winner: ${match.tied ? 'tie' : winner}`,
      payoutPreview,
      match.wager > 0 ? 'No real Pokecoins were moved for this solo test.' : '',
      '',
      formatResultTeams(match),
      formatAuditLine(match),
    ].filter(Boolean).join('\n');
  }

  if (match.tied) {
    return [
      `${pokeball(config)} AshKetchup match ended in a tie. The crowd goes quiet.`,
      match.wager === 0
        ? ''
        : 'Wager canceled: tied battle.',
      '',
      formatResultTeams(match),
      formatAuditLine(match),
    ].filter(Boolean).join('\n');
  }

  const winner =
    match.winnerDiscordId
      ? formatDiscordUserWithRecord(match, match.winnerDiscordId)
      : match.winnerShowdownUsername || 'unknown';
  const auditWarning =
    match.illegalPokemon.length > 0
      ? 'Audit warning: unexpected Pokemon or levels were detected. Review before payment.'
      : 'Audit passed: no unexpected Pokemon or levels detected.';

  return [
    `${pokeball(config)} AshKetchup winner: ${winner}. Victory road starts here.`,
    formatWagerSettlementLine(match),
    '',
    formatResultTeams(match),
    auditWarning,
  ].filter(Boolean).join('\n');
}

function buildPokenautsResultComponents(
  match: PokenautsMatch
): Array<ActionRowBuilder<ButtonBuilder>> {
  if (match.wager === 0 || match.testMode || match.status !== 'ended' || !match.winnerDiscordId || match.tied) {
    return [];
  }

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`pnm:paid:${match.id}`)
        .setLabel('Confirm Paid')
        .setStyle(ButtonStyle.Success)
        .setDisabled(match.payoutConfirmed || match.wagerCanceled),
      new ButtonBuilder()
        .setCustomId(`pnm:wagercancel:${match.id}`)
        .setLabel('Wager Canceled')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(match.payoutConfirmed || match.wagerCanceled),
      new ButtonBuilder()
        .setCustomId(`pnm:tradehelp:${match.id}`)
        .setLabel('Trade Help')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(match.payoutConfirmed || match.wagerCanceled)
    ),
  ];
}

function buildPublicMatchMessage(
  match: HumanMatch,
  playerA: User,
  playerB: User
): string {
  return [
    `Pokenauts Showdown match created: ${match.id}`,
    `${playerA} (${match.players.a.username}) vs ${playerB} (${match.players.b.username})`,
    `Showdown: ${match.showdownUrl}`,
    `Format: ${match.format}`,
    `${playerA}: challenge ${match.players.b.username}.`,
    `${playerB}: accept the challenge from ${match.players.a.username}.`,
    'Each player: click your button below to see your assigned team privately.',
    'After the battle starts, copy the battle room id from the browser URL and give it to the coordinator.',
  ].join('\n');
}

function buildMatchButtons(matchId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`pokenauts:team:${matchId}:a`)
      .setLabel('Show Team A')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`pokenauts:team:${matchId}:b`)
      .setLabel('Show Team B')
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildPrivateTeamMessage(match: HumanMatch, playerKey: 'a' | 'b'): string {
  const player = match.players[playerKey];
  const opponent = playerKey === 'a' ? match.players.b : match.players.a;
  const challengeInstruction =
    playerKey === 'a'
      ? `Challenge ${opponent.username} in ${match.format}.`
      : `Accept the challenge from ${opponent.username}.`;

  return [
    `Your Pokenauts match: ${match.id}`,
    `Showdown link: ${match.showdownUrl}`,
    `Your Showdown username: ${player.username}`,
    `Opponent: ${opponent.username}`,
    challengeInstruction,
    `Import this team in Teambuilder for ${match.format}:`,
    '```',
    player.team.importText,
    '```',
  ].join('\n');
}

function validateWagerResultAction(
  interaction: ButtonInteraction,
  match: PokenautsMatch,
  config: AppConfig,
  options: {allowTie?: boolean} = {}
): string | null {
  if (match.wager === 0 || match.testMode) {
    return 'This match has no real wager to settle.';
  }

  if (match.status !== 'ended') {
    return 'Wait for AshKetchup to post the battle result before settling the wager.';
  }

  if (match.tied && !options.allowTie) {
    return 'This battle tied, so there is no winner to pay.';
  }

  if (!canManagePokenautsWager(interaction, match, config)) {
    return 'Only a match participant, banker, or server manager can update the wager.';
  }

  if (match.payoutConfirmed) {
    return 'This wager is already marked paid.';
  }

  if (match.wagerCanceled) {
    return 'This wager is already canceled.';
  }

  return null;
}

function canManagePokenautsWager(
  interaction: ButtonInteraction,
  match: PokenautsMatch,
  config: AppConfig
): boolean {
  return Boolean(
    getParticipantKey(match, interaction.user.id) ||
      isBanker(interaction.user.id, config) ||
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  );
}

function buildPokenautsTradeHelpMessage(
  match: PokenautsMatch,
  discordUserId: string,
  config: AppConfig
): string {
  const participants = getWagerParticipants(match);
  if (!participants) return 'No wager trade is available for this match.';

  if (discordUserId === participants.winnerDiscordId) {
    return [
      `${pokeball(config)} You won the wager.`,
      `<@${participants.loserDiscordId}> owes you ${match.wager} Pokecoins.`,
      '',
      'Have the loser start a Pokenauts trade with you, add the coins, then both of you confirm after the amount looks right:',
      '```',
      '@Pokenauts trade @winner',
      `@Pokenauts trade add pc ${match.wager}`,
      '@Pokenauts trade confirm',
      '```',
      'After the coins land, click Confirm Paid on the result message.',
    ].join('\n');
  }

  return [
    `${pokeball(config)} You lost the wager.`,
    `Pay <@${participants.winnerDiscordId}> ${match.wager} Pokecoins with a Pokenauts trade:`,
    '```',
    '@Pokenauts trade @winner',
    `@Pokenauts trade add pc ${match.wager}`,
    '@Pokenauts trade confirm',
    '```',
    'Replace `@winner` with the winner mention. After the trade is complete, click Confirm Paid on the result message.',
  ].join('\n');
}

function getWagerParticipants(
  match: PokenautsMatch
): {winnerDiscordId: string; loserDiscordId: string} | null {
  if (match.tied || !match.winnerDiscordId) return null;

  const loserDiscordId = match.winnerDiscordId === match.challengerDiscordId
    ? match.opponentDiscordId
    : match.challengerDiscordId;

  return {
    winnerDiscordId: match.winnerDiscordId,
    loserDiscordId,
  };
}

function formatWagerSettlementLine(match: PokenautsMatch): string {
  if (match.wager === 0 || match.testMode) return '';
  if (match.wagerCanceled) return 'Wager canceled. No Pokecoins need to move.';
  if (match.payoutConfirmed) return `Wager paid: ${match.wager} Pokecoins.`;

  const participants = getWagerParticipants(match);
  if (!participants) return '';

  return `Wager payment: <@${participants.loserDiscordId}> pays <@${participants.winnerDiscordId}> ${match.wager} Pokecoins. Winner/loser can click Trade Help for private Pokenauts trade steps.`;
}

function formatTeamSelectionStatus(team: PokenautsMatch['teams'][PokenautsPlayerKey]): string {
  return team ? 'selected' : 'waiting';
}

function formatPrivateSelectedPokemon(team: PokenautsMatch['teams'][PokenautsPlayerKey]): string {
  if (!team) return 'No team submitted yet.';
  return team.expectedPokemon
    .map(
      pokemon =>
        `- Slot ${pokemon.slot}: ${pokemon.species} L${pokemon.pokenautsLevel} -> Showdown L${pokemon.showdownLevel}`
    )
    .join('\n');
}

function formatResultTeams(match: PokenautsMatch): string {
  if (match.tied || !match.winnerDiscordId) {
    return [
      'Teams:',
      `Challenger: ${formatResultTeam(match, 'challenger')}`,
      `Opponent: ${formatResultTeam(match, 'opponent')}`,
    ].join('\n');
  }

  const winnerKey = match.winnerDiscordId === match.challengerDiscordId
    ? 'challenger'
    : 'opponent';
  const loserKey = winnerKey === 'challenger' ? 'opponent' : 'challenger';

  return [
    'Teams:',
    `Winner: ${formatResultTeam(match, winnerKey)}`,
    `Loser: ${formatResultTeam(match, loserKey)}`,
  ].join('\n');
}

function formatResultTeam(match: PokenautsMatch, playerKey: PokenautsPlayerKey): string {
  const team = match.teams[playerKey];
  if (!team) return 'not submitted';

  const discordId = playerKey === 'challenger'
    ? match.challengerDiscordId
    : match.opponentDiscordId;
  const pokemon = team.expectedPokemon
    .map(entry => `${entry.species} L${entry.showdownLevel}`)
    .join(', ');

  return `${formatDiscordUserWithRecord(match, discordId)} (${team.showdownUsername}) - ${pokemon}`;
}

function formatDiscordUserWithRecord(match: PokenautsMatch, discordUserId: string): string {
  const playerKey = getParticipantKey(match, discordUserId);
  const record = playerKey ? match.resultRecords[playerKey] : undefined;
  return `<@${discordUserId}>${formatRecordSuffix(record)}`;
}

function formatRecordSuffix(record: PlayerBattleRecord | undefined): string {
  if (!record) return '';
  return ` [${record.wins}W-${record.losses}L-${record.draws}D]`;
}

function formatMatchStatus(status: PokenautsMatch['status']): string {
  return status.replace(/_/g, ' ');
}

function formatWinnerLine(match: PokenautsMatch): string {
  if (match.status !== 'ended') return '';
  if (match.tied) return 'Result: tie';
  return `Result: winner ${match.winnerShowdownUsername || 'unknown'}`;
}

function formatAuditLine(match: PokenautsMatch): string {
  if (!match.roomId) return 'Audit: waiting for battle room';
  if (match.illegalPokemon.length === 0) return 'Audit: no unexpected Pokemon detected';
  return `Audit: ${match.illegalPokemon.length} unexpected Pokemon/level record(s) detected`;
}

function formatBanker(config: AppConfig): string {
  return config.discordBankerUserId ? `<@${config.discordBankerUserId}>` : '(not configured)';
}

function isBanker(discordUserId: string, config: AppConfig): boolean {
  return Boolean(config.discordBankerUserId && discordUserId === config.discordBankerUserId);
}

function canManagePokenautsMatch(
  interaction: ChatInputCommandInteraction,
  match: PokenautsMatch,
  config: AppConfig
): boolean {
  return Boolean(
    getParticipantKey(match, interaction.user.id) ||
      isBanker(interaction.user.id, config) ||
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  );
}

function getParticipantKey(
  match: PokenautsMatch,
  discordUserId: string
): PokenautsPlayerKey | undefined {
  if (match.challengerDiscordId === discordUserId) return 'challenger';
  if (match.opponentDiscordId === discordUserId) return 'opponent';
  return undefined;
}

function formatChannelName(channel: TextChannel): string {
  return `#${channel.name}`;
}

function displayNameForShowdown(user: User): string {
  return user.globalName || user.username;
}

function formatResultChannelConfig(config: AppConfig): string {
  const channels = [
    ...config.discordResultChannelIds.map(channelId => `id:${channelId}`),
    ...config.discordResultChannelNames.map(channelName => `#${channelName}`),
  ];

  if (channels.length === 0) {
    return 'match channel only';
  }

  return channels.join(', ');
}

function normalizeChannelName(name: string): string {
  return name.trim().replace(/^#/, '').toLowerCase();
}

function pokeball(config?: Pick<AppConfig, 'discordPokeballEmoji'>): string {
  return config?.discordPokeballEmoji || '<:pokeball:1510466501482905690>';
}

function buildShowdownRoomUrl(match: Pick<PokenautsMatch, 'showdownUrl' | 'roomId'>): string {
  const baseUrl = match.showdownUrl.replace(/\/+$/, '');
  return match.roomId ? `${baseUrl}/${match.roomId}` : baseUrl;
}

function formatMatchFormat(match: Pick<PokenautsMatch, 'format'>): string {
  return formatTeambuilderFormat(match.format);
}

function formatTeambuilderFormat(format: string): string {
  return format.split('@@@', 1)[0];
}

function hasHiddenTeamPreview(format: string): boolean {
  return format.toLowerCase().includes('!teampreview') ||
    format.toLowerCase().includes('!team preview');
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
