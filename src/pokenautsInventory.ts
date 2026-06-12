import {Client, Embed, Message, PartialMessage} from 'discord.js';
import {AppConfig} from './config';

const REQUEST_TTL_MS = 60_000;
const UNATTRIBUTED_WARNING_TTL_MS = 15_000;

export interface PokenautsInventoryEntry {
  slot: number;
  species: string;
  level: number;
  ivPercent: number;
  rawLine: string;
  sourceMessageId: string;
  updatedAt: string;
}

export interface PokenautsInventorySnapshot {
  discordUserId: string;
  entries: PokenautsInventoryEntry[];
  updatedAt: string;
}

interface RecentInventoryRequest {
  discordUserId: string;
  requestedAt: number;
}

export class PokenautsInventoryTracker {
  private readonly recentRequestsByChannel = new Map<string, RecentInventoryRequest>();
  private readonly ownerByPokenautsMessageId = new Map<string, string>();
  private readonly entriesByUser = new Map<string, Map<number, PokenautsInventoryEntry>>();
  private readonly unattributedWarningAtByMessageId = new Map<string, number>();

  constructor(private readonly config: AppConfig) {}

  install(client: Client): void {
    client.on('messageCreate', message => {
      this.handleMessageCreate(message).catch(error => {
        console.warn(`[pokenauts-inventory] Could not handle message: ${formatError(error)}`);
      });
    });
    client.on('messageUpdate', (_oldMessage, newMessage) =>
      this.handlePokenautsInventoryMessage(newMessage).catch(error => {
        console.warn(`[pokenauts-inventory] Could not handle message edit: ${formatError(error)}`);
      })
    );
  }

  getSnapshot(discordUserId: string): PokenautsInventorySnapshot {
    const entries = [...(this.entriesByUser.get(discordUserId)?.values() || [])].sort(
      (a, b) => a.slot - b.slot
    );

    return {
      discordUserId,
      entries,
      updatedAt:
        entries.reduce<string | undefined>(
          (latest, entry) =>
            !latest || entry.updatedAt > latest ? entry.updatedAt : latest,
          undefined
        ) || new Date(0).toISOString(),
    };
  }

  getEntries(discordUserId: string, slots: number[]): PokenautsInventoryEntry[] {
    const entries = this.entriesByUser.get(discordUserId);
    if (!entries) return [];

    return slots
      .map(slot => entries.get(slot))
      .filter((entry): entry is PokenautsInventoryEntry => Boolean(entry));
  }

  private async handleMessageCreate(message: Message): Promise<void> {
    if (!this.isTrackedChannel(message)) return;

    if (this.isInventoryCommand(message)) {
      this.recentRequestsByChannel.set(message.channelId, {
        discordUserId: message.author.id,
        requestedAt: Date.now(),
      });
      console.log(
        `[pokenauts-inventory] Inventory request from ${message.author.tag} in ${message.channelId}`
      );
      return;
    }

    await this.handlePokenautsInventoryMessage(message);
  }

  private async handlePokenautsInventoryMessage(
    message: Message | PartialMessage
  ): Promise<void> {
    if (!this.isTrackedChannel(message)) return;

    const parsedEntries = parsePokenautsInventoryMessage(message);
    if (parsedEntries.length === 0) return;

    const ownerId = await this.resolveOwner(message);
    if (!ownerId) {
      this.warnUnattributed(message);
      return;
    }

    this.ownerByPokenautsMessageId.set(message.id, ownerId);

    const entries = this.entriesByUser.get(ownerId) || new Map<number, PokenautsInventoryEntry>();
    for (const entry of parsedEntries) {
      entries.set(entry.slot, entry);
    }
    this.entriesByUser.set(ownerId, entries);

    console.log(
      `[pokenauts-inventory] Stored ${parsedEntries.length} visible slots for <@${ownerId}>: ` +
        parsedEntries.map(entry => `${entry.slot}:${entry.species} L${entry.level}`).join(', ')
    );
  }

  private async resolveOwner(message: Message | PartialMessage): Promise<string | undefined> {
    const knownOwner = this.ownerByPokenautsMessageId.get(message.id);
    if (knownOwner) return knownOwner;

    const interactionOwner = getInteractionOwnerId(message);
    if (interactionOwner) return interactionOwner;

    const referencedOwner = await this.resolveReferencedOwner(message);
    if (referencedOwner) return referencedOwner;

    const recentRequest = this.recentRequestsByChannel.get(message.channelId);
    if (!recentRequest) return undefined;

    if (Date.now() - recentRequest.requestedAt > REQUEST_TTL_MS) {
      this.recentRequestsByChannel.delete(message.channelId);
      return undefined;
    }

    return recentRequest.discordUserId;
  }

  private async resolveReferencedOwner(
    message: Message | PartialMessage
  ): Promise<string | undefined> {
    const referenceId = message.reference?.messageId;
    if (!referenceId || !('messages' in message.channel)) return undefined;

    try {
      const referencedMessage = await message.channel.messages.fetch(referenceId);
      if (referencedMessage.author.bot) return undefined;

      this.recentRequestsByChannel.set(message.channelId, {
        discordUserId: referencedMessage.author.id,
        requestedAt: Date.now(),
      });
      return referencedMessage.author.id;
    } catch (error) {
      console.warn(
        `[pokenauts-inventory] Could not fetch referenced inventory command ${referenceId}: ${formatError(error)}`
      );
      return undefined;
    }
  }

  private warnUnattributed(message: Message | PartialMessage): void {
    const now = Date.now();
    const lastWarnedAt = this.unattributedWarningAtByMessageId.get(message.id);
    if (lastWarnedAt && now - lastWarnedAt < UNATTRIBUTED_WARNING_TTL_MS) return;

    this.unattributedWarningAtByMessageId.set(message.id, now);
    console.warn(
      `[pokenauts-inventory] Saw Pokenauts inventory message ${message.id} but could not attribute it to a user`
    );
  }

  private isInventoryCommand(message: Message): boolean {
    if (message.author.bot) return false;

    const content = message.content.toLowerCase();
    const mentionsPokenauts = [...message.mentions.users.values()].some(user =>
      user.username.toLowerCase().includes('pokenauts')
    );

    const mentionsByText = content.includes('pokenauts');
    return (mentionsPokenauts || mentionsByText) && /\b(pokemon|p)\b/.test(content);
  }

  private isTrackedChannel(message: Message | PartialMessage): boolean {
    if (this.config.discordMatchChannelId) {
      return message.channelId === this.config.discordMatchChannelId;
    }

    return (
      'name' in message.channel &&
      message.channel.name === this.config.discordMatchChannelName
    );
  }
}

export function parsePokenautsInventoryMessage(
  message: Message | PartialMessage
): PokenautsInventoryEntry[] {
  const text = collectEmbedText(message.embeds);
  const entries = parsePokenautsPokemonList(text);
  const now = new Date().toISOString();

  return entries.map(entry => ({
    ...entry,
    sourceMessageId: message.id,
    updatedAt: now,
  }));
}

export function parsePokenautsPokemonList(
  text: string
): Array<Omit<PokenautsInventoryEntry, 'sourceMessageId' | 'updatedAt'>> {
  const pokemon: Array<Omit<PokenautsInventoryEntry, 'sourceMessageId' | 'updatedAt'>> = [];
  const linePattern =
    /^\s*`?\s*(\d+)\s*`?\s+(.+?)\s*(?:\u2022|-)\s*Lvl\.?\s*(\d+)\s*(?:\u2022|-)\s*([\d.]+)%/gimu;
  let match: RegExpExecArray | null;

  while ((match = linePattern.exec(text)) !== null) {
    pokemon.push({
      slot: Number.parseInt(match[1], 10),
      species: normalizeSpecies(match[2]),
      level: Number.parseInt(match[3], 10),
      ivPercent: Number.parseFloat(match[4]),
      rawLine: match[0],
    });
  }

  return pokemon;
}

function collectEmbedText(embeds: readonly Embed[]): string {
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

function normalizeSpecies(value: string): string {
  return value
    .replace(/<a?:[^:>]+:\d+>/gu, '')
    .replace(/\s*["“][^"”]*["”]/gu, '')
    .replace(/\*\*/gu, '')
    .replace(/`/gu, '')
    .replace(/Nidoran\s*♀/giu, 'Nidoran-F')
    .replace(/Nidoran\s*♂/giu, 'Nidoran-M')
    .replace(/[’]/gu, "'")
    .replace(/[^\p{Letter}\p{Number}\s.'':-]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function getInteractionOwnerId(message: Message | PartialMessage): string | undefined {
  const maybeMessage = message as Message & {
    interaction?: {user?: {id?: string}};
    interactionMetadata?: {user?: {id?: string}};
  };

  return maybeMessage.interactionMetadata?.user?.id || maybeMessage.interaction?.user?.id;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
