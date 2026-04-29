import { Game } from './core/Game.js';

Game.create().catch((err) => {
  console.error('Fatal Game.create error:', err);
});
