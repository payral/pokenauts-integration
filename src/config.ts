import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_PORT = 3001;
const DEFAULT_SHOWDOWN_WS_URL = 'ws://localhost:8000/showdown/websocket';
const DEFAULT_SHOWDOWN_PUBLIC_URL = 'http://localhost:8000';
const DEFAULT_SHOWDOWN_LOGIN_URL = 'https://play.pokemonshowdown.com/action.php';
const DEFAULT_COORDINATOR_USERNAME = 'PokenautsBot';
const DEFAULT_TESTBOT_A_USERNAME = 'PokenautsTestBotA';
const DEFAULT_TEST_FORMAT = 'gen9anythinggoes';
const DEFAULT_POKENAUTS_FORMAT = 'gen9customgame';
const DEFAULT_SHOWDOWN_ROOT = '../selfhosted-ps';
const DEFAULT_DISCORD_MATCH_CHANNEL_NAME = 'pokemon-in-space';
const DEFAULT_DISCORD_POKEBALL_EMOJI = '<:pokeball:1510466501482905690>';

export interface AppConfig {
  port: number;
  showdownWsUrl: string;
  showdownPublicUrl: string;
  showdownLoginUrl: string;
  showdownCoordinatorUsername: string;
  showdownCoordinatorPassword?: string;
  showdownTestBotAUsername: string;
  showdownTestBotAPassword?: string;
  showdownTestFormat: string;
  showdownPokenautsFormat: string;
  showdownRoot: string;
  discordToken?: string;
  discordClientId?: string;
  discordGuildId?: string;
  discordBankerUserId?: string;
  discordMatchChannelId?: string;
  discordMatchChannelName: string;
  discordResultChannelIds: string[];
  discordResultChannelNames: string[];
  discordPokeballEmoji: string;
  pokenautsMessageProbe: boolean;
}

function readPort(value: string | undefined): number {
  if (!value) return DEFAULT_PORT;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.warn(`[config] Invalid PORT "${value}", using ${DEFAULT_PORT}`);
    return DEFAULT_PORT;
  }

  return parsed;
}

function optionalEnv(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}

function readBoolean(value: string | undefined): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function readBooleanDefault(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function readList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function readSingleDiscordId(
  value: string | undefined,
  envName: string
): string | undefined {
  const items = readList(value);
  if (items.length === 0) return undefined;

  if (items.length > 1) {
    console.warn(
      `[config] ${envName} should be one channel ID. Using ${items[0]}; put extra channels in DISCORD_RESULT_CHANNEL_IDS.`
    );
  }

  return items[0];
}

function normalizeDiscordEmoji(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return DEFAULT_DISCORD_POKEBALL_EMOJI;
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return trimmed;
  if (/^\d+$/.test(trimmed)) return `<:pokeball:${trimmed}>`;
  if (['pokeball', ':pokeball:'].includes(trimmed.toLowerCase())) {
    return DEFAULT_DISCORD_POKEBALL_EMOJI;
  }
  return trimmed;
}

function buildPokenautsFormat(baseFormat: string, hideTeamPreview: boolean): string {
  if (!hideTeamPreview) return baseFormat;

  const [formatId, customRulesText] = baseFormat.split('@@@', 2);
  const customRules = customRulesText
    ? customRulesText.split(',').map(rule => rule.trim()).filter(Boolean)
    : [];
  const hasTeamPreviewOverride = customRules.some(rule =>
    ['!teampreview', '!team preview'].includes(rule.toLowerCase().replace(/\s+/g, ' '))
  );

  if (!hasTeamPreviewOverride) customRules.push('!teampreview');
  return `${formatId}@@@${customRules.join(',')}`;
}

export const config: AppConfig = {
  port: readPort(process.env.PORT),
  showdownWsUrl: process.env.SHOWDOWN_WS_URL || DEFAULT_SHOWDOWN_WS_URL,
  showdownPublicUrl: process.env.SHOWDOWN_PUBLIC_URL || DEFAULT_SHOWDOWN_PUBLIC_URL,
  showdownLoginUrl: process.env.SHOWDOWN_LOGIN_URL || DEFAULT_SHOWDOWN_LOGIN_URL,
  showdownCoordinatorUsername:
    process.env.SHOWDOWN_COORDINATOR_USERNAME || DEFAULT_COORDINATOR_USERNAME,
  showdownCoordinatorPassword: optionalEnv(process.env.SHOWDOWN_COORDINATOR_PASSWORD),
  showdownTestBotAUsername:
    process.env.SHOWDOWN_TESTBOT_A_USERNAME || DEFAULT_TESTBOT_A_USERNAME,
  showdownTestBotAPassword: optionalEnv(process.env.SHOWDOWN_TESTBOT_A_PASSWORD),
  showdownTestFormat: process.env.SHOWDOWN_TEST_FORMAT || DEFAULT_TEST_FORMAT,
  showdownPokenautsFormat: buildPokenautsFormat(
    process.env.SHOWDOWN_POKENAUTS_FORMAT || DEFAULT_POKENAUTS_FORMAT,
    readBooleanDefault(process.env.SHOWDOWN_HIDE_TEAM_PREVIEW, true)
  ),
  showdownRoot: process.env.SHOWDOWN_ROOT || DEFAULT_SHOWDOWN_ROOT,
  discordToken: optionalEnv(process.env.DISCORD_TOKEN),
  discordClientId: optionalEnv(process.env.DISCORD_CLIENT_ID),
  discordGuildId: optionalEnv(process.env.DISCORD_GUILD_ID),
  discordBankerUserId: optionalEnv(process.env.DISCORD_BANKER_USER_ID),
  discordMatchChannelId: readSingleDiscordId(
    process.env.DISCORD_MATCH_CHANNEL_ID,
    'DISCORD_MATCH_CHANNEL_ID'
  ),
  discordMatchChannelName:
    process.env.DISCORD_MATCH_CHANNEL_NAME || DEFAULT_DISCORD_MATCH_CHANNEL_NAME,
  discordResultChannelIds: readList(process.env.DISCORD_RESULT_CHANNEL_IDS),
  discordResultChannelNames: readList(process.env.DISCORD_RESULT_CHANNEL_NAMES),
  discordPokeballEmoji: normalizeDiscordEmoji(process.env.DISCORD_POKEBALL_EMOJI),
  pokenautsMessageProbe: readBoolean(process.env.POKENAUTS_MESSAGE_PROBE),
};
