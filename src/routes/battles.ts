import {Router} from 'express';
import {BattleStore, battleStore} from '../battleStore';

interface CreateBattleBody {
  challengerDiscordId?: string;
  opponentDiscordId?: string;
  wager?: number;
}

interface AcceptBattleBody {
  opponentDiscordId?: string;
}

export function createBattlesRouter(store: BattleStore = battleStore): Router {
  const router = Router();

  router.post('/', (request, response) => {
    const body = request.body as CreateBattleBody;

    try {
      const battle = store.createBattleRequest(
        String(body.challengerDiscordId || ''),
        String(body.opponentDiscordId || ''),
        body.wager ?? 0
      );

      response.status(201).json({ok: true, battle});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.status(400).json({ok: false, error: message});
    }
  });

  router.get('/', (_request, response) => {
    response.json({
      ok: true,
      battles: store.listBattleRequests(),
    });
  });

  router.post('/:id/accept', (request, response) => {
    const body = request.body as AcceptBattleBody;

    try {
      const battle = store.acceptBattleRequest(
        request.params.id,
        String(body.opponentDiscordId || '')
      );

      response.json({ok: true, battle});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message === 'battle request not found' ? 404 : 400;
      response.status(status).json({ok: false, error: message});
    }
  });

  return router;
}
