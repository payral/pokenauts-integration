import {randomUUID} from 'crypto';

export type BattleRequestStatus = 'pending' | 'accepted' | 'cancelled';

export interface BattleRequest {
  id: string;
  challengerDiscordId: string;
  opponentDiscordId: string;
  wager: number;
  status: BattleRequestStatus;
  createdAt: string;
}

export class BattleStore {
  private readonly battles = new Map<string, BattleRequest>();

  createBattleRequest(
    challengerDiscordId: string,
    opponentDiscordId: string,
    wager: number
  ): BattleRequest {
    if (!challengerDiscordId) {
      throw new Error('challengerDiscordId is required');
    }

    if (!opponentDiscordId) {
      throw new Error('opponentDiscordId is required');
    }

    if (!Number.isInteger(wager) || wager <= 0) {
      throw new Error('wager must be a positive integer');
    }

    const battle: BattleRequest = {
      id: randomUUID(),
      challengerDiscordId,
      opponentDiscordId,
      wager,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    this.battles.set(battle.id, battle);
    return battle;
  }

  getBattleRequest(id: string): BattleRequest | undefined {
    return this.battles.get(id);
  }

  listBattleRequests(): BattleRequest[] {
    return [...this.battles.values()];
  }

  acceptBattleRequest(id: string, opponentDiscordId: string): BattleRequest {
    const battle = this.getBattleRequest(id);
    if (!battle) {
      throw new Error('battle request not found');
    }

    if (battle.status !== 'pending') {
      throw new Error(`battle request is ${battle.status}`);
    }

    if (battle.opponentDiscordId !== opponentDiscordId) {
      throw new Error('only the requested opponent can accept this battle');
    }

    battle.status = 'accepted';
    return battle;
  }
}

export const battleStore = new BattleStore();
