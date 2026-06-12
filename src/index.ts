import express from 'express';
import {config} from './config';
import {handlePokenautsShowdownResultCallback, startDiscordBot} from './discordBot';
import {createBattlesRouter} from './routes/battles';
import {createShowdownTestRouter} from './routes/showdownTest';
import {showdownHarness} from './showdownHarness';

const app = express();

app.use(express.json());
app.use('/battles', createBattlesRouter());
app.use('/showdown', createShowdownTestRouter(showdownHarness));

app.post('/showdown/pokenauts/results', async (request, response) => {
  try {
    const result = await handlePokenautsShowdownResultCallback(
      request.body,
      request.header('authorization')
    );
    response.status(result.statusCode).json(result.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[service] Pokenauts result callback failed: ${message}`);
    response.status(500).json({ok: false, error: message});
  }
});

app.get('/health', (_request, response) => {
  response.json({
    ok: true,
    service: 'pokenauts-integration',
  });
});

if (config.discordToken) {
  startDiscordBot(config).catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[discord] Bot failed to start: ${message}`);
  });
} else {
  console.log('Discord bot not started because DISCORD_TOKEN is missing.');
}

const server = app.listen(config.port, () => {
  console.log('[service] pokenauts-integration started');
  console.log(`[service] HTTP listening on http://localhost:${config.port}`);
  console.log(`[service] Showdown websocket URL: ${config.showdownWsUrl}`);
  console.log(`[service] Showdown private-link API: ${config.showdownInternalApiUrl}`);
  console.log(`[service] Coordinator username: ${config.showdownCoordinatorUsername}`);
  console.log(`[service] TestBotA username: ${config.showdownTestBotAUsername}`);
});

function shutdown(signal: string): void {
  console.log(`[service] Received ${signal}, shutting down`);
  showdownHarness.disconnectAll();
  server.close(() => {
    console.log('[service] HTTP server closed');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
