import {AppConfig} from './config';
import {ParsedShowdownMessage} from './showdownClient';
import {
  GeneratedPokenautsPokemon,
  GeneratedPokenautsTeam,
  generatePokenautsTeam,
} from './showdownTeamBuilder';
import {PokenautsInventoryEntry} from './pokenautsInventory';

export type PokenautsPlayerKey = 'challenger' | 'opponent';
export type PokenautsMatchStatus =
  | 'collecting_teams'
  | 'awaiting_escrow'
  | 'ready'
  | 'watching'
  | 'ended'
  | 'refunded';

export interface SubmittedPokenautsTeam extends GeneratedPokenautsTeam {
  showdownUsername: string;
  submittedAt: string;
}

export interface PokenautsBattlePokemonRecord {
  side?: string;
  username?: string;
  playerKey?: PokenautsPlayerKey;
  species: string;
  level?: number;
  roomId: string;
}

export interface DiscordMessageRef {
  channelId: string;
  messageId: string;
}

export interface PokenautsMatch {
  id: string;
  challengerDiscordId: string;
  opponentDiscordId: string;
  wager: number;
  pot: number;
  format: string;
  showdownUrl: string;
  status: PokenautsMatchStatus;
  teams: Partial<Record<PokenautsPlayerKey, SubmittedPokenautsTeam>>;
  escrowConfirmed: boolean;
  payoutConfirmed: boolean;
  wagerCanceled: boolean;
  roomId: string | null;
  sideByUsername: Record<string, string>;
  seenPokemon: PokenautsBattlePokemonRecord[];
  illegalPokemon: PokenautsBattlePokemonRecord[];
  winnerShowdownUsername: string | null;
  winnerDiscordId: string | null;
  tied: boolean;
  resultPosted: boolean;
  testMode: boolean;
  botChallengeSent: boolean;
  discordChannelId: string | null;
  discordMessageId: string | null;
  resultDiscordMessages: DiscordMessageRef[];
  createdAt: string;
  updatedAt: string;
}

export class PokenautsMatchStore {
  private readonly matches = new Map<string, PokenautsMatch>();

  constructor(private readonly config: AppConfig) {}

  createMatch(
    challengerDiscordId: string,
    opponentDiscordId: string,
    wager: number,
    options: {testMode?: boolean} = {}
  ): PokenautsMatch {
    if (challengerDiscordId === opponentDiscordId) {
      throw new Error('You cannot challenge yourself');
    }

    if (!Number.isInteger(wager) || wager < 0) {
      throw new Error('Wager must be a non-negative integer');
    }

    const now = new Date().toISOString();
    const match: PokenautsMatch = {
      id: createMatchId(),
      challengerDiscordId,
      opponentDiscordId,
      wager,
      pot: wager,
      format: this.config.showdownPokenautsFormat,
      showdownUrl: this.config.showdownPublicUrl,
      status: 'collecting_teams',
      teams: {},
      escrowConfirmed: true,
      payoutConfirmed: false,
      wagerCanceled: false,
      roomId: null,
      sideByUsername: {},
      seenPokemon: [],
      illegalPokemon: [],
      winnerShowdownUsername: null,
      winnerDiscordId: null,
      tied: false,
      resultPosted: false,
      testMode: options.testMode === true,
      botChallengeSent: false,
      discordChannelId: null,
      discordMessageId: null,
      resultDiscordMessages: [],
      createdAt: now,
      updatedAt: now,
    };

    this.matches.set(match.id, match);
    return match;
  }

  createSoloBotTestMatch(
    humanDiscordId: string,
    botDiscordId: string,
    wager: number
  ): PokenautsMatch {
    const match = this.createMatch(humanDiscordId, botDiscordId, wager, {testMode: true});
    match.escrowConfirmed = true;
    this.refreshStatus(match);
    return match;
  }

  listMatches(): PokenautsMatch[] {
    return [...this.matches.values()];
  }

  getMatch(id: string): PokenautsMatch | undefined {
    return this.matches.get(id);
  }

  setDiscordMessage(matchId: string, channelId: string, messageId: string): PokenautsMatch {
    const match = this.requireMatch(matchId);
    match.discordChannelId = channelId;
    match.discordMessageId = messageId;
    match.updatedAt = new Date().toISOString();
    return match;
  }

  submitTeam(
    matchId: string,
    discordUserId: string,
    showdownUsername: string,
    entries: PokenautsInventoryEntry[]
  ): PokenautsMatch {
    const match = this.requireMatch(matchId);
    const playerKey = this.requireParticipant(match, discordUserId);
    const trimmedUsername = showdownUsername.trim();

    if (!trimmedUsername) {
      throw new Error('Showdown username is required');
    }

    const slots = entries.map(entry => entry.slot);
    if (new Set(slots).size !== slots.length) {
      throw new Error('Choose 3 different inventory slots');
    }

    const team = generatePokenautsTeam(this.config, entries);
    match.teams[playerKey] = {
      ...team,
      showdownUsername: trimmedUsername,
      submittedAt: new Date().toISOString(),
    };

    this.refreshStatus(match);
    return match;
  }

  submitFixedTeam(
    matchId: string,
    playerKey: PokenautsPlayerKey,
    showdownUsername: string,
    team: GeneratedPokenautsTeam
  ): PokenautsMatch {
    const match = this.requireMatch(matchId);
    const trimmedUsername = showdownUsername.trim();
    if (!trimmedUsername) throw new Error('Showdown username is required');

    match.teams[playerKey] = {
      ...team,
      showdownUsername: trimmedUsername,
      submittedAt: new Date().toISOString(),
    };

    this.refreshStatus(match);
    return match;
  }

  markBotChallengeSent(matchId: string): PokenautsMatch {
    const match = this.requireMatch(matchId);
    match.botChallengeSent = true;
    match.updatedAt = new Date().toISOString();
    return match;
  }

  findPendingSoloBotBattle(): PokenautsMatch | undefined {
    return [...this.matches.values()]
      .filter(
        match =>
          match.testMode &&
          match.botChallengeSent &&
          !match.roomId &&
          match.status !== 'ended' &&
          match.status !== 'refunded'
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  }

  confirmEscrow(matchId: string): PokenautsMatch {
    const match = this.requireMatch(matchId);
    match.escrowConfirmed = true;
    this.refreshStatus(match);
    return match;
  }

  markRefunded(matchId: string): PokenautsMatch {
    const match = this.requireMatch(matchId);
    match.status = 'refunded';
    match.wagerCanceled = true;
    match.payoutConfirmed = false;
    match.updatedAt = new Date().toISOString();
    return match;
  }

  confirmPayout(matchId: string): PokenautsMatch {
    const match = this.requireMatch(matchId);
    match.payoutConfirmed = true;
    match.wagerCanceled = false;
    match.updatedAt = new Date().toISOString();
    return match;
  }

  cancelWager(matchId: string): PokenautsMatch {
    const match = this.requireMatch(matchId);
    match.wagerCanceled = true;
    match.payoutConfirmed = false;
    match.updatedAt = new Date().toISOString();
    return match;
  }

  watchRoom(matchId: string, roomId: string): PokenautsMatch {
    const match = this.requireMatch(matchId);
    const normalizedRoomId = roomId.trim();

    if (!normalizedRoomId.startsWith('battle-')) {
      throw new Error('room_id must be a battle room id, like battle-gen9customgame-123');
    }

    match.roomId = normalizedRoomId;
    match.status = 'watching';
    match.updatedAt = new Date().toISOString();
    return match;
  }

  recordShowdownMessage(message: ParsedShowdownMessage): PokenautsMatch | undefined {
    if (!message.roomId) return undefined;

    const match = this.findMatchByRoom(message.roomId);
    if (!match) return undefined;

    if (message.type === 'player') {
      const side = message.args[0];
      const username = message.args[1];
      if (side && username) {
        match.sideByUsername[toId(username)] = side;
        match.updatedAt = new Date().toISOString();
        return match;
      }
    }

    const seen = extractSeenPokemon(message);
    if (!seen) return undefined;

    const playerKey = this.findPlayerForSeenPokemon(match, seen.side);
    const username = playerKey ? match.teams[playerKey]?.showdownUsername : undefined;
    const record: PokenautsBattlePokemonRecord = {
      side: seen.side,
      username,
      playerKey,
      species: seen.species,
      level: seen.level,
      roomId: message.roomId,
    };

    addUniqueRecord(match.seenPokemon, record);

    if (playerKey && !isExpectedPokemon(match.teams[playerKey], seen.species, seen.level)) {
      addUniqueRecord(match.illegalPokemon, record);
    }

    match.updatedAt = new Date().toISOString();
    return match;
  }

  recordBattleEnded(
    roomId: string | undefined,
    winner: string | undefined,
    tied: boolean
  ): PokenautsMatch | undefined {
    if (!roomId) return undefined;

    const match = this.findMatchByRoom(roomId);
    if (!match) return undefined;

    match.status = 'ended';
    match.winnerShowdownUsername = winner || null;
    match.winnerDiscordId = tied || !winner ? null : this.findDiscordIdForWinner(match, winner);
    match.tied = tied;
    match.updatedAt = new Date().toISOString();
    return match;
  }

  markResultPosted(matchId: string, messages: DiscordMessageRef[] = []): void {
    const match = this.requireMatch(matchId);
    match.resultPosted = true;
    match.resultDiscordMessages = messages;
    match.updatedAt = new Date().toISOString();
  }

  getPlayerKey(match: PokenautsMatch, discordUserId: string): PokenautsPlayerKey | undefined {
    if (match.challengerDiscordId === discordUserId) return 'challenger';
    if (match.opponentDiscordId === discordUserId) return 'opponent';
    return undefined;
  }

  private requireMatch(matchId: string): PokenautsMatch {
    const match = this.matches.get(matchId);
    if (!match) throw new Error('Pokenauts match not found');
    return match;
  }

  private requireParticipant(match: PokenautsMatch, discordUserId: string): PokenautsPlayerKey {
    const playerKey = this.getPlayerKey(match, discordUserId);
    if (!playerKey) throw new Error('Only match participants can do that');
    return playerKey;
  }

  private refreshStatus(match: PokenautsMatch): void {
    if (match.status === 'ended' || match.status === 'refunded' || match.status === 'watching') {
      match.updatedAt = new Date().toISOString();
      return;
    }

    const bothTeamsSubmitted = Boolean(match.teams.challenger && match.teams.opponent);
    if (!bothTeamsSubmitted) {
      match.status = 'collecting_teams';
    } else {
      match.status = 'ready';
    }

    match.updatedAt = new Date().toISOString();
  }

  private findMatchByRoom(roomId: string): PokenautsMatch | undefined {
    return [...this.matches.values()].find(match => match.roomId === roomId);
  }

  private findPlayerForSeenPokemon(
    match: PokenautsMatch,
    side: string | undefined
  ): PokenautsPlayerKey | undefined {
    if (!side) return undefined;

    for (const playerKey of ['challenger', 'opponent'] as const) {
      const username = match.teams[playerKey]?.showdownUsername;
      if (username && match.sideByUsername[toId(username)] === side) return playerKey;
    }

    if (side === 'p1') return 'challenger';
    if (side === 'p2') return 'opponent';
    return undefined;
  }

  private findDiscordIdForWinner(match: PokenautsMatch, winner: string): string | null {
    const winnerId = toId(winner);
    if (toId(match.teams.challenger?.showdownUsername || '') === winnerId) {
      return match.challengerDiscordId;
    }
    if (toId(match.teams.opponent?.showdownUsername || '') === winnerId) {
      return match.opponentDiscordId;
    }
    return null;
  }
}

function createMatchId(): string {
  return `pnm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function extractSeenPokemon(
  message: ParsedShowdownMessage
): {side?: string; species: string; level?: number} | null {
  if (message.type === 'poke') {
    return {
      side: message.args[0],
      ...parsePokemonDetails(message.args[1] || ''),
    };
  }

  if (message.type === 'switch' || message.type === 'drag') {
    return {
      side: parsePokemonIdentSide(message.args[0] || ''),
      ...parsePokemonDetails(message.args[1] || ''),
    };
  }

  return null;
}

function parsePokemonDetails(details: string): {species: string; level?: number} {
  const parts = details.split(',').map(part => part.trim());
  const levelPart = parts.find(part => /^L\d+$/i.test(part));

  return {
    species: parts[0] || details.trim(),
    level: levelPart ? Number.parseInt(levelPart.slice(1), 10) : undefined,
  };
}

function parsePokemonIdentSide(ident: string): string | undefined {
  const match = ident.match(/^(p[12])[^:]*:/);
  return match?.[1];
}

function isExpectedPokemon(
  team: SubmittedPokenautsTeam | undefined,
  species: string,
  level: number | undefined
): boolean {
  if (!team) return false;

  const expected = team.expectedPokemon.find(
    pokemon => toId(pokemon.species) === toId(species)
  );
  if (!expected) return false;

  return level === undefined || level === expected.showdownLevel;
}

function addUniqueRecord(
  records: PokenautsBattlePokemonRecord[],
  record: PokenautsBattlePokemonRecord
): void {
  if (
    records.some(
      existing =>
        existing.roomId === record.roomId &&
        existing.side === record.side &&
        toId(existing.species) === toId(record.species) &&
        existing.level === record.level
    )
  ) {
    return;
  }

  records.push(record);
}

export function toId(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
