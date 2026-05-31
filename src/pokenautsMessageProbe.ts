import {Client, Embed, Message, PartialMessage} from 'discord.js';
import {AppConfig} from './config';

interface ParsedPokenautsPokemon {
  slot: number;
  species: string;
  level: number;
}

interface ParsedPokenautsInfo {
  slot?: number;
  species?: string;
  level?: number;
  id?: string;
}

export function installPokenautsMessageProbe(
  client: Client,
  config: AppConfig
): void {
  if (!config.pokenautsMessageProbe) {
    console.log(
      '[pokenauts-probe] Disabled. Set POKENAUTS_MESSAGE_PROBE=true to log channel messages.'
    );
    return;
  }

  console.log(
    '[pokenauts-probe] Enabled. Listening for channel messages in ' +
      formatProbeChannel(config) +
      '.'
  );

  client.on('messageCreate', message => logProbeMessage('message', message, config));
  client.on('messageUpdate', (_oldMessage, newMessage) =>
    logProbeMessage('message edit', newMessage, config)
  );
}

function logProbeMessage(
  eventName: string,
  message: Message | PartialMessage,
  config: AppConfig
): void {
  if (!isProbeChannel(message, config)) return;

  const embedText = collectEmbedText(message.embeds);
  const searchableText = [message.content, embedText].filter(Boolean).join('\n');
  const pokemon = parsePokenautsPokemonList(searchableText);
  const info = parsePokenautsInfo(searchableText);
  const author = message.author?.tag ?? 'unknown';
  const isBot = message.author?.bot ?? 'unknown';

  console.log(
    `[pokenauts-probe] ${eventName} author=${author} ` +
      `bot=${isBot} channel=${message.channelId}`
  );
  console.log(`[pokenauts-probe] content:\n${message.content || '(empty)'}`);

  if (embedText) {
    console.log(`[pokenauts-probe] embeds:\n${embedText}`);
  }

  if (pokemon.length > 0) {
    console.log(
      '[pokenauts-probe] parsed pokemon list: ' +
        pokemon
          .map(entry => `${entry.slot}: ${entry.species} L${entry.level}`)
          .join('; ')
    );
  }

  if (info) {
    console.log(
      '[pokenauts-probe] parsed info: ' +
        [
          info.slot ? `slot=${info.slot}` : undefined,
          info.species ? `species=${info.species}` : undefined,
          info.level ? `level=${info.level}` : undefined,
          info.id ? `id=${info.id}` : undefined,
        ]
          .filter(Boolean)
          .join(' ')
    );
  }
}

function isProbeChannel(message: Message | PartialMessage, config: AppConfig): boolean {
  if (config.discordMatchChannelId) {
    return message.channelId === config.discordMatchChannelId;
  }

  return 'name' in message.channel && message.channel.name === config.discordMatchChannelName;
}

function formatProbeChannel(config: AppConfig): string {
  if (config.discordMatchChannelId) return `channel id ${config.discordMatchChannelId}`;
  return `#${config.discordMatchChannelName}`;
}

function collectEmbedText(embeds: Embed[]): string {
  return embeds
    .map(embed =>
      [
        embed.title,
        embed.description,
        ...embed.fields.flatMap(field => [field.name, field.value]),
        embed.footer?.text,
      ]
        .filter(Boolean)
        .join('\n')
    )
    .filter(Boolean)
    .join('\n--- embed ---\n');
}

function parsePokenautsPokemonList(text: string): ParsedPokenautsPokemon[] {
  const pokemon: ParsedPokenautsPokemon[] = [];
  const linePattern =
    /^\s*`?\s*(\d+)\s*`?\s+(.+?)\s*(?:\u2022|-)\s*Lvl\.?\s*(\d+)/gimu;
  let match: RegExpExecArray | null;

  while ((match = linePattern.exec(text)) !== null) {
    pokemon.push({
      slot: Number.parseInt(match[1], 10),
      species: normalizeSpecies(match[2]),
      level: Number.parseInt(match[3], 10),
    });
  }

  return pokemon;
}

function parsePokenautsInfo(text: string): ParsedPokenautsInfo | null {
  const levelSpeciesMatch = text.match(/\bLevel\s+(\d+)\s+([^\n]+)/i);
  const slotMatch = text.match(/Displaying pok(?:e|\u00e9)mon\s+(\d+)/i);
  const idMatch = text.match(/\bID:\s*([a-z0-9]+)/i);

  if (!levelSpeciesMatch && !slotMatch && !idMatch) return null;

  return {
    level: levelSpeciesMatch ? Number.parseInt(levelSpeciesMatch[1], 10) : undefined,
    species: levelSpeciesMatch ? normalizeSpecies(levelSpeciesMatch[2]) : undefined,
    slot: slotMatch ? Number.parseInt(slotMatch[1], 10) : undefined,
    id: idMatch?.[1],
  };
}

function normalizeSpecies(value: string): string {
  return normalizeText(value)
    .replace(/<a?:[^:>]+:\d+>/gu, '')
    .replace(/\*\*/gu, '')
    .replace(/[^\p{Letter}\p{Number}\s.'-]/gu, '')
    .trim();
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}
