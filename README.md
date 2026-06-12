# Pokenauts Integration

Standalone TypeScript service for connecting a future Discord/Pokenauts battle flow to a self-hosted Pokemon Showdown server.

## Setup

```sh
npm install
```

Copy `.env.example` to `.env` if you want to override defaults:

```env
PORT=3001
SHOWDOWN_WS_URL=ws://localhost:8000/showdown/websocket
SHOWDOWN_PUBLIC_URL=http://localhost:8000
SHOWDOWN_LOGIN_URL=https://play.pokemonshowdown.com/action.php

SHOWDOWN_COORDINATOR_USERNAME=PokenautsBot
SHOWDOWN_COORDINATOR_PASSWORD=

SHOWDOWN_TESTBOT_A_USERNAME=PokenautsTestBotA
SHOWDOWN_TESTBOT_A_PASSWORD=

SHOWDOWN_TEST_FORMAT=gen9anythinggoes
SHOWDOWN_POKENAUTS_FORMAT=gen9customgame
SHOWDOWN_HIDE_TEAM_PREVIEW=true
SHOWDOWN_ROOT=../selfhosted-ps

DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
DISCORD_BANKER_USER_ID=
DISCORD_MATCH_CHANNEL_ID=
DISCORD_MATCH_CHANNEL_NAME=pokemon-in-space
DISCORD_RESULT_CHANNEL_IDS=
DISCORD_RESULT_CHANNEL_NAMES=
DISCORD_POKEBALL_EMOJI=<:pokeball:1510466501482905690>
POKENAUTS_MESSAGE_PROBE=false
```

Use the full Discord token for `DISCORD_POKEBALL_EMOJI`, not the human shorthand `:pokeball:`.

The API runs without Discord credentials. If `DISCORD_TOKEN` is missing, the service logs:

```text
Discord bot not started because DISCORD_TOKEN is missing.
```

## Local Showdown Harness

This dev harness owns exactly two Showdown websocket clients:

- `PokenautsBot`: coordinator/spectator
- `PokenautsTestBotA`: challenger bot

The human developer is the opponent. Open the local Showdown UI, choose or log into a username, then send a challenge to that username through the API.

### Terminal 1

Start Pokemon Showdown:

```powershell
cd C:\Users\Peter\Documents\Code\pokemon\selfhosted-ps
node pokemon-showdown
```

If you normally use `npm start`, that is fine too.

### Browser

Open:

```text
http://localhost:8000
```

Choose or log into a Showdown username. Remember the username exactly.

### Terminal 2

Start the integration service:

```powershell
cd C:\Users\Peter\Documents\Code\pokemon\pokenauts-integration
npm run dev
```

### Test the Harness

```powershell
curl http://localhost:3001/health
curl -X POST http://localhost:3001/showdown/test/connect
curl -X POST http://localhost:3001/showdown/test/join-lobby
curl -X POST http://localhost:3001/showdown/test/challenge-human -H "Content-Type: application/json" -d "{\"opponentUsername\":\"YOUR_SHOWDOWN_USERNAME\"}"
curl http://localhost:3001/showdown/status
```

Then in the browser, accept the challenge from `PokenautsTestBotA` manually.

The service logs battle protocol messages and detects:

```text
|win|username
|tie|
```

If a battle room id such as `battle-gen9customgame-123` is detected, `PokenautsBot` attempts to join/spectate that room.

## Human vs Human Coordinator Flow

This flow keeps Showdown stock. The coordinator prints instructions and the Discord bot posts them in `#pokemon-in-space`, but it still needs the battle room id after the humans accept the challenge.

Create a human match:

```powershell
Invoke-RestMethod `
  -Uri http://localhost:3001/showdown/human-matches `
  -Method Post `
  -ContentType "application/json" `
  -Body (@{
    playerAUsername = "payraluser"
    playerBUsername = "dave1234567"
    pmUsers = $true
  } | ConvertTo-Json)
```

The integration terminal and Discord match card use `SHOWDOWN_PUBLIC_URL` for the Showdown link. For local-only testing, leave it as `http://localhost:8000`. For players outside your network, set it to your public address:

```env
SHOWDOWN_PUBLIC_URL=http://YOUR_PUBLIC_IP:8000
```

The integration terminal prints:

- the configured Showdown link
- Team A import text for `playerAUsername`
- Team B import text for `playerBUsername`
- which user should challenge
- the match id

Use **Anything Goes** in the Showdown challenge/team format dropdown. The env format id for that is:

```env
SHOWDOWN_TEST_FORMAT=gen9anythinggoes
```

After the battle starts, copy the room id from the browser URL. For example, if the URL contains:

```text
battle-gen9customgame-123
```

tell the coordinator to watch it:

```powershell
Invoke-RestMethod `
  -Uri http://localhost:3001/showdown/human-matches/<match-id>/watch `
  -Method Post `
  -ContentType "application/json" `
  -Body (@{
    roomId = "battle-gen9customgame-123"
  } | ConvertTo-Json)
```

Check result and species audit:

```powershell
Invoke-RestMethod http://localhost:3001/showdown/human-matches/<match-id>
```

The coordinator records `winner`, `tied`, and per-player `seenPokemon` / `illegalPokemon`. This is a basic species-level audit from battle protocol messages; it does not prove EVs, nature, unrevealed moves, or unrevealed items.

### Login Notes

Both harness clients use the standard Showdown assertion flow. If a bot username is unregistered, blank passwords may work through `getassertion`. If the username is registered, set the matching password:

```env
SHOWDOWN_COORDINATOR_PASSWORD=...
SHOWDOWN_TESTBOT_A_PASSWORD=...
```

If login fails, the service does not fake success; it logs what credential/env value is likely needed.

## Discord Bot

To enable the Discord bot:

1. Open the Discord Developer Portal.
2. Create a new application.
3. In the application, open the Bot page and create a bot.
4. Copy the bot token into `DISCORD_TOKEN`.
5. Open OAuth2 settings and copy the application/client ID into `DISCORD_CLIENT_ID`.
6. Enable a local test server in Discord and copy its server/guild ID into `DISCORD_GUILD_ID`.
7. In your Discord server, create or confirm the channel `#pokemon-in-space`.
8. Invite the bot to your test server with the `bot` and `applications.commands` scopes.

Recommended bot permissions:

- Send Messages
- Use Slash Commands
- View Channels
- Read Message History

The Pokenauts inventory-backed flow requires **Message Content Intent**. In the Discord Developer Portal, open the bot settings and enable Message Content Intent before starting the service.

Set these env vars in `.env`:

```env
DISCORD_TOKEN=your-bot-token
DISCORD_CLIENT_ID=your-application-client-id
DISCORD_GUILD_ID=your-server-id
DISCORD_BANKER_USER_ID=trusted-human-banker-user-id
DISCORD_MATCH_CHANNEL_NAME=pokemon-in-space
DISCORD_RESULT_CHANNEL_IDS=pokemon-in-space-channel-id,commons-channel-id
DISCORD_POKEBALL_EMOJI=<:pokeball:1510466501482905690>
SHOWDOWN_POKENAUTS_FORMAT=gen9customgame
SHOWDOWN_HIDE_TEAM_PREVIEW=true
SHOWDOWN_ROOT=../selfhosted-ps
```

`DISCORD_POKEBALL_EMOJI` should be `<:pokeball:1510466501482905690>`. Avoid `:pokeball:` because Discord only expands that shorthand for humans typing in the client, not for bot API messages.

`DISCORD_MATCH_CHANNEL_ID` is optional but recommended. It must be one channel ID only; this is where match cards are posted.

`DISCORD_RESULT_CHANNEL_IDS` is optional and controls where final battle results are posted. To report victories in both `#pokemon-in-space` and `#commons`, copy both Discord channel IDs and set them comma-separated:

```env
DISCORD_RESULT_CHANNEL_IDS=825872130951872512,commons-channel-id
```

If `DISCORD_RESULT_CHANNEL_IDS` and `DISCORD_RESULT_CHANNEL_NAMES` are both empty, AshKetchup posts results only in the match channel.

### Pokenauts Message Probe

This is test-only code for checking whether AshKetchup can see Pokenauts inventory replies in `#pokemon-in-space`.

In the Discord Developer Portal, open the bot settings and enable **Message Content Intent**. Then set:

```env
POKENAUTS_MESSAGE_PROBE=true
```

Restart `npm run dev`, then run this in `#pokemon-in-space`:

```text
@Pokenauts pokemon
```

If Discord lets AshKetchup see the response, the integration terminal logs the raw message and parsed lines like:

```text
[pokenauts-probe] parsed pokemon list: 1: Charizard L62; 2: Swinub L2
```

Turn `POKENAUTS_MESSAGE_PROBE` back to `false` when you are done testing.

Register slash commands:

```sh
npm run register:commands
```

Supported commands:

```text
/ashketchup challenge opponent:@user
/ashketchup challenge opponent:@user wager:50
/ashketchup testbot
/ashketchup testbot wager:1
/ashketchup room match_id:<match-id> room_id:battle-gen9customgame-123
/help
```

`/help` also shows a small Pokenauts cheat sheet:

```text
@Pokenauts balance
@Pokenauts bal
@Pokenauts pokemon
@Pokenauts info <slot>
@Pokenauts trade @user
@Pokenauts trade add <slot>
@Pokenauts trade add pc <amount>
@Pokenauts trade confirm
@Pokenauts select <slot>
@Pokenauts favorite <slot>
@Pokenauts buy rare candy
```

Pokenauts rejects trades with AshKetchup, so wagered coins are paid player-to-player after AshKetchup posts the result.

Beginner notes:

- `select` chooses the one Pokemon that gains XP from normal chat messages.
- `favorite` protects a Pokemon from accidental release/trade; it does not select that Pokemon for XP.
- Pokecoins come from catching Pokemon, catch milestones, quests, releasing Pokemon, and player market/trade activity.
- Rare Candies can be bought with Pokecoins and used to level the selected Pokemon faster.
- AshKetchup Showdown matches cap every selected Pokemon at level 50.
- AshKetchup generates preset movesets from local Showdown data, so players only pick the 3 Pokemon, not their moves.
- AshKetchup removes Showdown Team Preview for Pokenauts matches, so the selected 3 stay hidden until Pokemon enter battle.
- The public match card only shows whether each player has selected a team; it does not reveal slots, species, or Showdown usernames.
- Players should use the exact private `/challenge ..., gen9customgame@@@!teampreview` instruction from **Submit Team** instead of plain Custom Game from the dropdown.
- Real `/ashketchup challenge` results update local Discord W-L-D records in `data/discord-battle-records.json`. Solo TestBot matches do not count, and `data/` is gitignored.

### Pokenauts Inventory 3v3 Flow

Use `/ashketchup challenge` for the new inventory-backed flow:

```text
/ashketchup challenge opponent:@user
```

`wager` is optional. Leave it blank for a no-wager match, or set `wager:50` so the loser pays the winner 50 Pokecoins after the result.

AshKetchup posts a public match card in `#pokemon-in-space`.

Each player should:

1. Run `@Pokenauts pokemon` in `#pokemon-in-space`.
2. Click the Pokenauts next-page button until the 3 wanted inventory slots have appeared.
3. Click **Submit Team** on AshKetchup's match card.
4. Enter their Showdown username and 3 Pokenauts inventory slot numbers.

AshKetchup parses Pokenauts' inventory embed and edited pages, verifies those slots were seen for that Discord user, caps each selected Pokemon at level 50, and generates a private Showdown importable team.

Each player receives their generated Showdown team as an ephemeral reply after submitting. If a wager is set, no coins move before the battle.

After the Showdown battle starts, submit the battle room id:

```text
/ashketchup room match_id:<match-id> room_id:battle-gen9customgame-123
```

AshKetchup joins as coordinator, watches for the winner, audits seen species/levels against the submitted teams, then posts payment instructions. If a wager is set, the result message includes **Trade Help**, **Confirm Paid**, and **Wager Canceled** buttons.

### Solo TestBot Flow

Use this when you want to test with only your Discord account:

```text
/ashketchup testbot
```

AshKetchup creates a solo test match against `PokenautsTestBotA`, auto-confirms fake/no coins held, and gives the bot a generated 3-Pokemon team. Add `wager:1` if you want the final result message to preview wager payment text.

Then:

1. Run `@Pokenauts pokemon` in `#pokemon-in-space`.
2. Page until the 3 wanted slots have appeared.
3. Click **Submit Team** and enter your Showdown username plus 3 slots.
4. AshKetchup sends a challenge from `PokenautsTestBotA` to your Showdown username.
5. Import your generated team, accept the challenge, then forfeit to make the bot win.

AshKetchup should auto-detect the battle room from `PokenautsTestBotA`, watch the result, and post solo-test wager payment text. No real Pokecoins move in this flow.

## Scripts

```sh
npm run dev
npm run register:commands
npm run test:pokenauts
npm run typecheck
npm run build
npm start
```

## Health Check

```text
http://localhost:3001/health
```

Expected response:

```json
{
  "ok": true,
  "service": "pokenauts-integration"
}
```

## Legacy Mock Battle API

These are HTTP-only development endpoints, not Discord slash commands.

Create a mock battle request:

```powershell
Invoke-RestMethod http://localhost:3001/battles `
  -Method Post `
  -ContentType 'application/json' `
  -Body '{"challengerDiscordId":"111","opponentDiscordId":"222","wager":50}'
```

List mock battle requests:

```powershell
Invoke-RestMethod http://localhost:3001/battles
```

Accept a mock battle request:

```powershell
Invoke-RestMethod http://localhost:3001/battles/<battle-id>/accept `
  -Method Post `
  -ContentType 'application/json' `
  -Body '{"opponentDiscordId":"222"}'
```

## Current Scope

This milestone intentionally does not include real Pokecoin balance changes, Pokemon/team selection from a collection, database persistence, or Pokemon Showdown core modifications. Battle and harness state is in memory and resets when the service restarts.
