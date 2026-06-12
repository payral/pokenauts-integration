import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  PlayerBattleRecord,
  PokenautsMatch,
  PokenautsPlayerKey,
} from './pokenautsMatchStore';

interface BattleRecordFile {
  users: Record<string, PlayerBattleRecord>;
}

export class BattleRecordStore {
  private readonly recordedMatchIds = new Set<string>();

  constructor(
    private readonly filePath = path.resolve(
      process.cwd(),
      'data',
      'discord-battle-records.json'
    )
  ) {}

  async recordMatchResult(
    match: PokenautsMatch
  ): Promise<Partial<Record<PokenautsPlayerKey, PlayerBattleRecord>>> {
    if (match.testMode || match.status !== 'ended') return {};

    if (this.recordedMatchIds.has(match.id)) {
      return this.getMatchRecords(match);
    }
    this.recordedMatchIds.add(match.id);

    const data = await this.load();
    const challengerRecord = ensureRecord(data.users, match.challengerDiscordId);
    const opponentRecord = ensureRecord(data.users, match.opponentDiscordId);

    if (match.tied) {
      challengerRecord.draws += 1;
      opponentRecord.draws += 1;
    } else if (match.winnerDiscordId === match.challengerDiscordId) {
      challengerRecord.wins += 1;
      opponentRecord.losses += 1;
    } else if (match.winnerDiscordId === match.opponentDiscordId) {
      opponentRecord.wins += 1;
      challengerRecord.losses += 1;
    } else {
      return {
        challenger: cloneRecord(challengerRecord),
        opponent: cloneRecord(opponentRecord),
      };
    }

    await this.save(data);

    return {
      challenger: cloneRecord(challengerRecord),
      opponent: cloneRecord(opponentRecord),
    };
  }

  private async getMatchRecords(
    match: PokenautsMatch
  ): Promise<Partial<Record<PokenautsPlayerKey, PlayerBattleRecord>>> {
    const data = await this.load();
    return {
      challenger: cloneRecord(ensureRecord(data.users, match.challengerDiscordId)),
      opponent: cloneRecord(ensureRecord(data.users, match.opponentDiscordId)),
    };
  }

  private async load(): Promise<BattleRecordFile> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<BattleRecordFile>;
      return {
        users: sanitizeUsers(parsed.users),
      };
    } catch (error) {
      if (isMissingFileError(error)) return {users: {}};
      throw error;
    }
  }

  private async save(data: BattleRecordFile): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), {recursive: true});
    const tmpPath = `${this.filePath}.tmp`;
    await fs.writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await fs.rename(tmpPath, this.filePath);
  }
}

function ensureRecord(
  users: Record<string, PlayerBattleRecord>,
  discordUserId: string
): PlayerBattleRecord {
  users[discordUserId] ||= {wins: 0, losses: 0, draws: 0};
  return users[discordUserId];
}

function sanitizeUsers(
  users: BattleRecordFile['users'] | undefined
): BattleRecordFile['users'] {
  const sanitized: BattleRecordFile['users'] = {};
  if (!users || typeof users !== 'object') return sanitized;

  for (const [discordUserId, record] of Object.entries(users)) {
    sanitized[discordUserId] = {
      wins: sanitizeCount(record?.wins),
      losses: sanitizeCount(record?.losses),
      draws: sanitizeCount(record?.draws),
    };
  }

  return sanitized;
}

function sanitizeCount(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

function cloneRecord(record: PlayerBattleRecord): PlayerBattleRecord {
  return {
    wins: record.wins,
    losses: record.losses,
    draws: record.draws,
  };
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
  );
}
