import {Router} from 'express';
import {config} from '../config';
import {ShowdownHarness, showdownHarness} from '../showdownHarness';

interface ChallengeHumanBody {
  opponentUsername?: string;
}

interface CreateHumanMatchBody {
  playerAUsername?: string;
  playerBUsername?: string;
  pmUsers?: boolean;
}

interface WatchHumanMatchBody {
  roomId?: string;
}

export function createShowdownTestRouter(
  harness: ShowdownHarness = showdownHarness
): Router {
  const router = Router();

  router.get('/status', (_request, response) => {
    response.json({
      ok: true,
      ...harness.getStatus(),
    });
  });

  router.get('/human-matches', (_request, response) => {
    response.json({
      ok: true,
      matches: harness.listHumanMatches(),
    });
  });

  router.post('/human-matches', (request, response) => {
    const body = request.body as CreateHumanMatchBody;

    try {
      const match = harness.createHumanMatch({
        playerAUsername: String(body.playerAUsername || ''),
        playerBUsername: String(body.playerBUsername || ''),
        pmUsers: body.pmUsers === true,
      });
      response.status(201).json({ok: true, match});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.status(400).json({ok: false, error: message});
    }
  });

  router.get('/human-matches/:id', (request, response) => {
    const match = harness.getHumanMatch(request.params.id);
    if (!match) {
      response.status(404).json({ok: false, error: 'human match not found'});
      return;
    }

    response.json({ok: true, match});
  });

  router.post('/human-matches/:id/watch', (request, response) => {
    const body = request.body as WatchHumanMatchBody;

    try {
      const match = harness.watchHumanMatch(
        request.params.id,
        String(body.roomId || '')
      );
      response.json({ok: true, match});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message === 'human match not found' ? 404 : 400;
      response.status(status).json({ok: false, error: message});
    }
  });

  router.post('/test/connect', async (_request, response) => {
    try {
      await harness.connectAll();
      response.json({ok: true, message: 'Showdown harness clients connected'});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.status(502).json({ok: false, error: message});
    }
  });

  router.post('/test/join-lobby', (_request, response) => {
    try {
      harness.joinLobbyAll();
      response.json({ok: true, message: 'Coordinator and TestBotA joined lobby'});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.status(400).json({ok: false, error: message});
    }
  });

  router.post('/test/challenge-human', async (request, response) => {
    const body = request.body as ChallengeHumanBody;
    const opponentUsername = String(body.opponentUsername || '').trim();

    try {
      await harness.challengeHuman(opponentUsername);
      const status = harness.getStatus();
      response.json({
        ok: true,
        message: 'Challenge sent',
        opponentUsername,
        format: config.showdownTestFormat,
        status,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.status(400).json({ok: false, error: message});
    }
  });

  router.post('/test/disconnect', (_request, response) => {
    harness.disconnectAll();
    response.json({ok: true, message: 'Showdown harness clients disconnected'});
  });

  return router;
}
