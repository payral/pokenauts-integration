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
  showdownPokenautsFormat:
    process.env.SHOWDOWN_POKENAUTS_FORMAT || DEFAULT_POKENAUTS_FORMAT,
  showdownRoot: process.env.SHOWDOWN_ROOT || DEFAULT_SHOWDOWN_ROOT,
  discordToken: optionalEnv(process.env.DISCORD_TOKEN),
  discordClientId: optionalEnv(process.env.DISCORD_CLIENT_ID),
  discordGuildId: optionalEnv(process.env.DISCORD_GUILD_ID),
  discordBankerUserId: optionalEnv(process.env.DISCORD_BANKER_USER_ID),
  discordMatchChannelId: optionalEnv(process.env.DISCORD_MATCH_CHANNEL_ID),
  discordMatchChannelName:
    process.env.DISCORD_MATCH_CHANNEL_NAME || DEFAULT_DISCORD_MATCH_CHANNEL_NAME,
  pokenautsMessageProbe: readBoolean(process.env.POKENAUTS_MESSAGE_PROBE),
};
