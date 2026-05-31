import {EventEmitter} from 'events';
import WebSocket from 'ws';

export interface ShowdownClientOptions {
  name: string;
  wsUrl: string;
  username?: string;
  password?: string;
  loginUrl?: string;
}

export interface ParsedShowdownMessage {
  clientName: string;
  raw: string;
  roomId?: string;
  type?: string;
  args: string[];
}

export interface ShowdownClientStatus {
  name: string;
  wsUrl: string;
  username?: string;
  connected: boolean;
  authenticating: boolean;
  loggedInUsername: string | null;
  lastUserName: string | null;
  latestBattleRoomId: string | null;
}

interface LoginResponse {
  assertion?: string;
}

const DEFAULT_LOGIN_URL = 'https://play.pokemonshowdown.com/action.php';

export declare interface ShowdownClient {
  on(event: 'connected', listener: () => void): this;
  on(event: 'disconnected', listener: (details: {code: number; reason: string}) => void): this;
  on(event: 'message', listener: (message: ParsedShowdownMessage) => void): this;
  on(event: 'challstr', listener: (challstr: string) => void): this;
  on(event: 'updateuser', listener: (details: {username: string; named: boolean}) => void): this;
  on(event: 'battleStarted', listener: (details: {roomId: string}) => void): this;
  on(event: 'battleEnded', listener: (details: {roomId?: string; winner?: string; tied: boolean}) => void): this;
}

export class ShowdownClient extends EventEmitter {
  private socket: WebSocket | null = null;
  private authenticating = false;
  private loggedInUsername: string | null = null;
  private lastUserName: string | null = null;
  private latestBattleRoomId: string | null = null;

  constructor(private readonly options: ShowdownClientOptions) {
    super();
  }

  connect(): Promise<void> {
    if (this.socket && this.isConnected()) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      console.log(`[showdown:${this.options.name}] Connecting to ${this.options.wsUrl}`);
      const socket = new WebSocket(this.options.wsUrl);
      this.socket = socket;
      this.loggedInUsername = null;
      this.lastUserName = null;

      const handleInitialError = (error: Error): void => {
        socket.off('open', handleOpen);
        reject(error);
      };

      const handleOpen = (): void => {
        socket.off('error', handleInitialError);
        console.log(`[showdown:${this.options.name}] Websocket connected`);
        this.emit('connected');
        resolve();
      };

      socket.once('open', handleOpen);
      socket.once('error', handleInitialError);

      socket.on('message', data => {
        const message = data.toString();
        console.log(`[showdown:${this.options.name}] <- ${message}`);
        this.handleMessage(message).catch(error => {
          const messageText = error instanceof Error ? error.message : String(error);
          console.warn(`[showdown:${this.options.name}] Failed to handle message: ${messageText}`);
        });
      });

      socket.on('error', error => {
        console.warn(`[showdown:${this.options.name}] Websocket error: ${error.message}`);
      });

      socket.on('close', (code, reason) => {
        const reasonText = reason.toString();
        const suffix = reasonText.length > 0 ? `: ${reasonText}` : '';
        console.log(`[showdown:${this.options.name}] Websocket closed (${code})${suffix}`);

        if (this.socket === socket) {
          this.socket = null;
          this.authenticating = false;
          this.loggedInUsername = null;
        }

        this.emit('disconnected', {code, reason: reasonText});
      });
    });
  }

  disconnect(): void {
    if (!this.socket) return;

    console.log(`[showdown:${this.options.name}] Disconnecting websocket`);
    this.socket.close();
    this.socket = null;
    this.authenticating = false;
    this.loggedInUsername = null;
  }

  sendRaw(message: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error(`[showdown:${this.options.name}] websocket is not open`);
    }

    console.log(`[showdown:${this.options.name}] -> ${this.redactOutboundMessage(message)}`);
    this.socket.send(message);
  }

  sendCommand(roomId: string, command: string): void {
    this.sendRaw(`${roomId}|${command}`);
  }

  joinRoom(roomId: string): void {
    this.sendRaw(`|/join ${roomId}`);
  }

  pmUser(username: string, message: string): void {
    this.sendRaw(`|/pm ${username}, ${message}`);
  }

  setTeam(packedTeam: string): void {
    this.sendRaw(`|/utm ${packedTeam}`);
  }

  challenge(username: string, format: string): void {
    this.sendRaw(`|/challenge ${username}, ${format}`);
  }

  getStatus(): ShowdownClientStatus {
    return {
      name: this.options.name,
      wsUrl: this.options.wsUrl,
      username: this.options.username,
      connected: this.isConnected(),
      authenticating: this.authenticating,
      loggedInUsername: this.loggedInUsername,
      lastUserName: this.lastUserName,
      latestBattleRoomId: this.latestBattleRoomId,
    };
  }

  private isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  private async handleMessage(message: string): Promise<void> {
    let roomId: string | undefined;

    for (const line of message.split('\n')) {
      if (!line) continue;

      if (line.startsWith('>')) {
        roomId = line.slice(1);
        this.detectBattleRoom(roomId);
        continue;
      }

      await this.handleProtocolLine(line, roomId);
    }
  }

  private async handleProtocolLine(line: string, roomId?: string): Promise<void> {
    const parsed = this.parseProtocolLine(line, roomId);
    this.emit('message', parsed);

    if (parsed.type === 'challstr') {
      const challstr = parsed.args.join('|');
      this.emit('challstr', challstr);
      await this.handleChallstr(challstr);
      return;
    }

    if (parsed.type === 'updateuser') {
      this.handleUpdateUser(parsed);
      return;
    }

    if (parsed.type && parsed.type.toLowerCase().includes('challenge')) {
      console.log(`[showdown:${this.options.name}] Challenge message: ${line}`);
    }

    if (roomId) {
      this.detectBattleRoom(roomId);
    }

    if (parsed.type === 'win') {
      const winner = parsed.args[0];
      console.log(`[showdown:${this.options.name}] Battle ended: winner=${winner || 'unknown'}`);
      this.emit('battleEnded', {roomId, winner, tied: false});
      return;
    }

    if (parsed.type === 'tie') {
      console.log(`[showdown:${this.options.name}] Battle ended: tie`);
      this.emit('battleEnded', {roomId, tied: true});
    }
  }

  private parseProtocolLine(line: string, roomId?: string): ParsedShowdownMessage {
    if (!line.startsWith('|')) {
      return {
        clientName: this.options.name,
        raw: line,
        roomId,
        args: [line],
      };
    }

    const parts = line.split('|');
    return {
      clientName: this.options.name,
      raw: line,
      roomId,
      type: parts[1],
      args: parts.slice(2),
    };
  }

  private async handleChallstr(challstr: string): Promise<void> {
    if (!this.options.username) {
      console.log(
        `[showdown:${this.options.name}] Received challstr with no username configured; staying anonymous.`
      );
      return;
    }

    if (this.authenticating || this.loggedInUsername) return;

    this.authenticating = true;

    try {
      console.log(`[showdown:${this.options.name}] Authenticating as ${this.options.username}`);
      const assertion = await this.requestAssertion(challstr);
      this.sendRaw(`|/trn ${this.options.username},0,${assertion}`);
      console.log(`[showdown:${this.options.name}] Sent login assertion for ${this.options.username}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const credentialHint = this.options.password
        ? 'Verify SHOWDOWN_LOGIN_URL, username, and password.'
        : `If ${this.options.username} is registered, set its password in the matching SHOWDOWN_*_PASSWORD env var.`;
      console.warn(
        `[showdown:${this.options.name}] Login failed for ${this.options.username}: ${message}. ${credentialHint}`
      );
    } finally {
      this.authenticating = false;
    }
  }

  private handleUpdateUser(message: ParsedShowdownMessage): void {
    const username = message.args[0] || '';
    const named = message.args[1] === '1';
    this.lastUserName = username;

    if (named) {
      this.loggedInUsername = username;
      console.log(`[showdown:${this.options.name}] Logged in as ${username}`);
    } else {
      console.log(`[showdown:${this.options.name}] Connected anonymously as ${username}`);
    }

    this.emit('updateuser', {username, named});
  }

  private detectBattleRoom(roomId: string): void {
    if (!roomId.startsWith('battle-')) return;
    if (this.latestBattleRoomId === roomId) return;

    this.latestBattleRoomId = roomId;
    console.log(`[showdown:${this.options.name}] Detected battle room ${roomId}`);
    this.emit('battleStarted', {roomId});
  }

  private async requestAssertion(challstr: string): Promise<string> {
    if (!this.options.username) {
      throw new Error('username is required for login');
    }

    if (!this.options.password) {
      return this.requestGuestAssertion(challstr);
    }

    return this.requestPasswordAssertion(challstr);
  }

  private async requestGuestAssertion(challstr: string): Promise<string> {
    const loginUrl = this.options.loginUrl || DEFAULT_LOGIN_URL;
    const username = this.options.username || '';
    const url = new URL(loginUrl);
    url.search = new URLSearchParams({
      act: 'getassertion',
      userid: toId(username),
      challstr,
    }).toString();

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`login server returned HTTP ${response.status}`);
    }

    const assertion = await response.text();
    if (!assertion || assertion.startsWith(';')) {
      throw new Error(`login server did not return a guest assertion for ${username}`);
    }

    return assertion;
  }

  private async requestPasswordAssertion(challstr: string): Promise<string> {
    const loginUrl = this.options.loginUrl || DEFAULT_LOGIN_URL;
    const username = this.options.username || '';
    const response = await fetch(loginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        act: 'login',
        name: username,
        pass: this.options.password || '',
        challstr,
      }),
    });

    if (!response.ok) {
      throw new Error(`login server returned HTTP ${response.status}`);
    }

    const rawText = await response.text();
    const jsonText = rawText.startsWith(']') ? rawText.slice(1) : rawText;
    const loginResponse = JSON.parse(jsonText) as LoginResponse;

    if (!loginResponse.assertion) {
      throw new Error('login server did not return an assertion');
    }

    return loginResponse.assertion;
  }

  private redactOutboundMessage(message: string): string {
    if (!this.options.username || !message.startsWith(`|/trn ${this.options.username},0,`)) {
      return message;
    }

    return `|/trn ${this.options.username},0,[assertion redacted]`;
  }
}

function toId(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
