import {AppConfig} from './config';
import {PokenautsMatch, PokenautsPlayerKey} from './pokenautsMatchStore';
import {packTeamImport} from './showdownTeamBuilder';

export interface ShowdownPrivateLinkPlayer {
  key: PokenautsPlayerKey;
  discordId: string;
  displayName: string;
}

export interface ShowdownPrivateLinkResultPlayer {
  discordId: string;
  showdownName: string;
  slot: string;
}

export interface ShowdownPrivateLinkMatch {
  matchId: string;
  format: string;
  roomId: string;
  joinLinks: Partial<Record<PokenautsPlayerKey, string>>;
  players: Partial<Record<PokenautsPlayerKey, ShowdownPrivateLinkResultPlayer>>;
}

interface ShowdownPrivateLinkResponse {
  ok: boolean;
  error?: string;
  match?: ShowdownPrivateLinkMatch;
}

export async function createShowdownPrivateLinkMatch(
  config: AppConfig,
  match: PokenautsMatch,
  players: Record<PokenautsPlayerKey, ShowdownPrivateLinkPlayer>
): Promise<ShowdownPrivateLinkMatch> {
  if (!config.pokenautsShowdownApiSecret) {
    throw new Error('POKENAUTS_SHOWDOWN_API_SECRET is required for v2 private links');
  }

  const challengerTeam = match.teams.challenger;
  const opponentTeam = match.teams.opponent;
  if (!challengerTeam || !opponentTeam) {
    throw new Error('Both teams must be submitted before creating Showdown private links');
  }

  const response = await fetch(`${trimTrailingSlash(config.showdownInternalApiUrl)}/pokenauts/api/matches`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.pokenautsShowdownApiSecret}`,
    },
    body: JSON.stringify({
      matchId: match.id,
      format: match.format,
      publicBaseUrl: config.showdownPublicUrl,
      callbackUrl: config.showdownResultCallbackUrl,
      players: [
        {
          key: 'challenger',
          discordId: match.challengerDiscordId,
          displayName: players.challenger.displayName,
          team: packTeamImport(config, challengerTeam.importText),
          selectedPokemon: challengerTeam.expectedPokemon,
        },
        {
          key: 'opponent',
          discordId: match.opponentDiscordId,
          displayName: players.opponent.displayName,
          team: packTeamImport(config, opponentTeam.importText),
          selectedPokemon: opponentTeam.expectedPokemon,
        },
      ],
    }),
  });

  const payload = await response.json() as ShowdownPrivateLinkResponse;
  if (!response.ok || !payload.ok || !payload.match) {
    throw new Error(payload.error || `Showdown private-link API failed with HTTP ${response.status}`);
  }

  return payload.match;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
