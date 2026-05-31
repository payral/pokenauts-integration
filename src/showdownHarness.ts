import {config} from './config';
import {ParsedShowdownMessage, ShowdownClient} from './showdownClient';
import {
  HUMAN_PLAYER_A_TEAM,
  HUMAN_PLAYER_B_TEAM,
  HumanMatchTeamAssignment,
  TEST_TEAM_A_PACKED,
  TEST_TEAM_ALLOWED_SPECIES,
  TEST_TEAM_IMPORT_TEXT,
} from './showdownTeams';

type HumanMatchPlayerKey = 'a' | 'b';

interface HumanMatchPokemonRecord {
  username?: string;
  side?: string;
  species: string;
  roomId: string;
}

export interface HumanMatchPlayerState {
  username: string;
  discordUserId?: string;
  team: HumanMatchTeamAssignment;
  seenPokemon: HumanMatchPokemonRecord[];
  illegalPokemon: HumanMatchPokemonRecord[];
}

export interface HumanMatch {
  id: string;
  playerAUsername: string;
  playerBUsername: string;
  players: {
    a: HumanMatchPlayerState;
    b: HumanMatchPlayerState;
  };
  format: string;
  showdownUrl: string;
  instructions: string[];
  roomId: string | null;
  status: 'pending' | 'watching' | 'ended';
  winner: string | null;
  tied: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CreateHumanMatchOptions {
  playerAUsername: string;
  playerBUsername: string;
  playerADiscordId?: string;
  playerBDiscordId?: string;
  pmUsers?: boolean;
}

export class ShowdownHarness {
  readonly coordinator: ShowdownClient;
  readonly testBotA: ShowdownClient;
  private latestBattleRoomId: string | null = null;
  private lastServerFeedback: string | null = null;
  private readonly humanMatches = new Map<string, HumanMatch>();
  private lastChallenge:
    | {
        opponentUsername: string;
        format: string;
        sentAt: string;
      }
    | null = null;

  constructor() {
    this.coordinator = new ShowdownClient({
      name: 'coordinator',
      wsUrl: config.showdownWsUrl,
      username: config.showdownCoordinatorUsername,
      password: config.showdownCoordinatorPassword,
      loginUrl: config.showdownLoginUrl,
    });

    this.testBotA = new ShowdownClient({
      name: 'testBotA',
      wsUrl: config.showdownWsUrl,
      username: config.showdownTestBotAUsername,
      password: config.showdownTestBotAPassword,
      loginUrl: config.showdownLoginUrl,
    });

    this.wireClientEvents(this.coordinator);
    this.wireClientEvents(this.testBotA);
  }

  async connectAll(): Promise<void> {
    await Promise.all([
      this.coordinator.connect(),
      this.testBotA.connect(),
    ]);
  }

  async connectCoordinator(): Promise<void> {
    await this.coordinator.connect();
  }

  joinLobbyAll(): void {
    this.coordinator.joinRoom('lobby');
    this.testBotA.joinRoom('lobby');
  }

  async challengeHuman(opponentUsername: string): Promise<void> {
    const trimmedOpponent = opponentUsername.trim();
    if (!trimmedOpponent) {
      throw new Error('opponentUsername is required');
    }

    await this.waitForLoggedIn(this.testBotA, 'TestBotA');

    this.testBotA.setTeam(TEST_TEAM_A_PACKED);
    this.testBotA.challenge(trimmedOpponent, config.showdownTestFormat);
    this.lastChallenge = {
      opponentUsername: trimmedOpponent,
      format: config.showdownTestFormat,
      sentAt: new Date().toISOString(),
    };
  }

  async challengeWithTestBot(
    opponentUsername: string,
    packedTeam: string,
    format: string
  ): Promise<void> {
    const trimmedOpponent = opponentUsername.trim();
    if (!trimmedOpponent) {
      throw new Error('opponentUsername is required');
    }

    await Promise.all([this.coordinator.connect(), this.testBotA.connect()]);
    await this.waitForLoggedIn(this.testBotA, 'TestBotA');

    this.testBotA.setTeam(packedTeam);
    this.testBotA.challenge(trimmedOpponent, format);
    this.lastChallenge = {
      opponentUsername: trimmedOpponent,
      format,
      sentAt: new Date().toISOString(),
    };
  }

  disconnectAll(): void {
    this.coordinator.disconnect();
    this.testBotA.disconnect();
  }

  createHumanMatch(options: CreateHumanMatchOptions): HumanMatch {
    const playerAUsername = options.playerAUsername.trim();
    const playerBUsername = options.playerBUsername.trim();

    if (!playerAUsername) throw new Error('playerAUsername is required');
    if (!playerBUsername) throw new Error('playerBUsername is required');
    if (playerAUsername.toLowerCase() === playerBUsername.toLowerCase()) {
      throw new Error('player usernames must be different');
    }

    const match: HumanMatch = {
      id: createMatchId(),
      playerAUsername,
      playerBUsername,
      players: {
        a: {
          username: playerAUsername,
          discordUserId: options.playerADiscordId,
          team: HUMAN_PLAYER_A_TEAM,
          seenPokemon: [],
          illegalPokemon: [],
        },
        b: {
          username: playerBUsername,
          discordUserId: options.playerBDiscordId,
          team: HUMAN_PLAYER_B_TEAM,
          seenPokemon: [],
          illegalPokemon: [],
        },
      },
      format: config.showdownTestFormat,
      showdownUrl: config.showdownPublicUrl,
      instructions: [
        `Both players: open ${config.showdownPublicUrl} and log in as your Showdown username.`,
        `${playerAUsername}: import Team A in Teambuilder for ${config.showdownTestFormat}.`,
        `${playerBUsername}: import Team B in Teambuilder for ${config.showdownTestFormat}.`,
        `${playerAUsername}: challenge ${playerBUsername} in ${config.showdownTestFormat}.`,
        `${playerBUsername}: accept the challenge from ${playerAUsername}.`,
        `After the battle starts, send this service the battle room id from the browser URL using POST /showdown/human-matches/${'MATCH_ID'}/watch.`,
      ],
      roomId: null,
      status: 'pending',
      winner: null,
      tied: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    match.instructions = match.instructions.map(instruction =>
      instruction.replace('MATCH_ID', match.id)
    );

    this.humanMatches.set(match.id, match);
    this.printHumanMatchInstructions(match);

    if (options.pmUsers) {
      this.pmHumanMatchInstructions(match);
    }

    return match;
  }

  listHumanMatches(): HumanMatch[] {
    return [...this.humanMatches.values()];
  }

  getHumanMatch(id: string): HumanMatch | undefined {
    return this.humanMatches.get(id);
  }

  watchHumanMatch(id: string, roomId: string): HumanMatch {
    const match = this.humanMatches.get(id);
    if (!match) throw new Error('human match not found');

    const normalizedRoomId = roomId.trim();
    if (!normalizedRoomId.startsWith('battle-')) {
      throw new Error('roomId must be a battle room id, like battle-gen9customgame-123');
    }

    match.roomId = normalizedRoomId;
    match.status = 'watching';
    match.updatedAt = new Date().toISOString();
    this.latestBattleRoomId = normalizedRoomId;

    this.coordinator.joinRoom(normalizedRoomId);
    console.log(`[harness] Watching human match ${match.id} in ${normalizedRoomId}`);
    return match;
  }

  getStatus(): object {
    return {
      coordinator: this.coordinator.getStatus(),
      testBotA: this.testBotA.getStatus(),
      latestBattleRoomId: this.latestBattleRoomId,
      lastServerFeedback: this.lastServerFeedback,
      lastChallenge: this.lastChallenge,
      humanMatches: this.listHumanMatches(),
      format: config.showdownTestFormat,
    };
  }

  private wireClientEvents(client: ShowdownClient): void {
    client.on('battleStarted', ({roomId}) => {
      this.latestBattleRoomId = roomId;

      if (client !== this.coordinator) {
        try {
          this.coordinator.joinRoom(roomId);
          console.log(`[harness] Coordinator joining detected battle room ${roomId}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[harness] Coordinator could not join ${roomId}: ${message}`);
        }
      }
    });

    client.on('battleEnded', result => {
      this.recordHumanMatchBattleEnd(result.roomId, result.winner, result.tied);

      if (result.tied) {
        console.log(`[harness] Battle ended in a tie: ${result.roomId || 'unknown room'}`);
        return;
      }

      console.log(
        `[harness] Battle winner detected: ${result.winner || 'unknown'} ` +
          `in ${result.roomId || 'unknown room'}`
      );
    });

    client.on('message', message => {
      this.recordHumanMatchMessage(message);

      if (
        message.type === 'updatechallenges' ||
        message.type === 'popup' ||
        message.type === 'error' ||
        message.raw.toLowerCase().includes('challenge')
      ) {
        this.lastServerFeedback = `${message.clientName}: ${message.raw}`;
        console.log(`[harness] ${message.clientName}: ${message.raw}`);
      }
    });
  }

  private printHumanMatchInstructions(match: HumanMatch): void {
    console.log('');
    console.log(`[human-match:${match.id}] ${match.playerAUsername} vs ${match.playerBUsername}`);
    console.log(`[human-match:${match.id}] Showdown link: ${match.showdownUrl}`);
    console.log(`[human-match:${match.id}] Format: ${match.format}`);
    console.log(`[human-match:${match.id}] Instructions:`);
    for (const instruction of match.instructions) {
      console.log(`[human-match:${match.id}] - ${instruction}`);
    }
    console.log(`[human-match:${match.id}] Team A for ${match.players.a.username}:`);
    console.log(match.players.a.team.importText);
    console.log('');
    console.log(`[human-match:${match.id}] Team B for ${match.players.b.username}:`);
    console.log(match.players.b.team.importText);
    console.log('');
  }

  private pmHumanMatchInstructions(match: HumanMatch): void {
    const shortInstructions = [
      `Pokenauts match ${match.id}: ${match.playerAUsername} vs ${match.playerBUsername}`,
      `Open ${match.showdownUrl}`,
      `Use format ${match.format}`,
      `${match.playerAUsername} challenges ${match.playerBUsername}; ${match.playerBUsername} accepts.`,
      `${match.playerAUsername} imports Team A; ${match.playerBUsername} imports Team B. Team text is printed in the integration terminal.`,
    ].join(' | ');

    try {
      this.coordinator.pmUser(match.playerAUsername, shortInstructions);
      this.coordinator.pmUser(match.playerBUsername, shortInstructions);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[harness] Could not PM human match instructions: ${message}`);
    }
  }

  private recordHumanMatchMessage(message: ParsedShowdownMessage): void {
    if (!message.roomId) return;

    const match = [...this.humanMatches.values()].find(
      candidate => candidate.roomId === message.roomId
    );
    if (!match) return;

    if (message.type === 'player') {
      match.updatedAt = new Date().toISOString();
      return;
    }

    const seen = this.extractSeenPokemon(message);
    if (!seen) return;

    const sideUsername = this.findUsernameForSide(match, seen.side);
    const playerKey = this.findPlayerKeyForSide(seen.side);
    if (!playerKey) return;

    const player = match.players[playerKey];
    const record = {
      username: sideUsername,
      side: seen.side,
      species: seen.species,
      roomId: message.roomId,
    };

    if (
      !player.seenPokemon.some(
        pokemon =>
          pokemon.roomId === record.roomId &&
          pokemon.side === record.side &&
          pokemon.species === record.species
      )
    ) {
      player.seenPokemon.push(record);
    }

    if (!player.team.expectedSpecies.includes(seen.species)) {
      if (
        !player.illegalPokemon.some(
          pokemon =>
            pokemon.roomId === record.roomId &&
            pokemon.side === record.side &&
            pokemon.species === record.species
        )
      ) {
        player.illegalPokemon.push(record);
        console.warn(
          `[harness] Illegal Pokemon detected in ${match.id}: ` +
            `${sideUsername || seen.side || 'unknown'} used ${seen.species}`
        );
      }
    }

    match.updatedAt = new Date().toISOString();
  }

  private recordHumanMatchBattleEnd(
    roomId: string | undefined,
    winner: string | undefined,
    tied: boolean
  ): void {
    if (!roomId) return;

    const match = [...this.humanMatches.values()].find(
      candidate => candidate.roomId === roomId
    );
    if (!match) return;

    match.status = 'ended';
    match.winner = winner || null;
    match.tied = tied;
    match.updatedAt = new Date().toISOString();

    const illegalCount =
      match.players.a.illegalPokemon.length + match.players.b.illegalPokemon.length;
    const legality = illegalCount === 0 ? 'no illegal Pokemon detected' : 'illegal Pokemon detected';
    const result = tied ? 'tie' : `winner=${winner || 'unknown'}`;
    console.log(`[human-match:${match.id}] Battle ended: ${result}; ${legality}`);
  }

  private extractSeenPokemon(
    message: ParsedShowdownMessage
  ): {side?: string; species: string} | null {
    if (message.type === 'poke') {
      return {
        side: message.args[0],
        species: normalizeSpecies(message.args[1] || ''),
      };
    }

    if (message.type === 'switch' || message.type === 'drag') {
      return {
        side: parsePokemonIdentSide(message.args[0] || ''),
        species: normalizeSpecies(message.args[1] || ''),
      };
    }

    return null;
  }

  private findUsernameForSide(match: HumanMatch, side?: string): string | undefined {
    if (side === 'p1') return match.playerAUsername;
    if (side === 'p2') return match.playerBUsername;
    return undefined;
  }

  private findPlayerKeyForSide(side?: string): HumanMatchPlayerKey | undefined {
    if (side === 'p1') return 'a';
    if (side === 'p2') return 'b';
    return undefined;
  }

  private async waitForLoggedIn(
    client: ShowdownClient,
    label: string,
    timeoutMs = 8000
  ): Promise<void> {
    const status = client.getStatus();
    if (!status.connected) {
      throw new Error(`${label} is not connected. Call /showdown/test/connect first.`);
    }

    if (status.loggedInUsername) return;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `${label} is connected but not logged in. If the username is registered, ` +
              `set the matching SHOWDOWN_*_PASSWORD env var.`
          )
        );
      }, timeoutMs);

      const onUpdateUser = (details: {username: string; named: boolean}): void => {
        if (!details.named) return;
        cleanup();
        resolve();
      };

      const cleanup = (): void => {
        clearTimeout(timeout);
        client.off('updateuser', onUpdateUser);
      };

      client.on('updateuser', onUpdateUser);
    });
  }
}

export const showdownHarness = new ShowdownHarness();

function createMatchId(): string {
  return `hm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parsePokemonIdentSide(ident: string): string | undefined {
  const match = ident.match(/^(p[12])[^:]*:/);
  return match?.[1];
}

function normalizeSpecies(details: string): string {
  return details.split(',')[0].trim();
}
