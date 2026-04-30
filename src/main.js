import { Game } from './core/Game.js';

Game.create()
  .then((game) => {
    // Em dev, expõe window.game pra debugging via console / DevTools.
    if (import.meta.env.DEV) window.game = game;
  })
  .catch((err) => {
    console.error('Fatal Game.create error:', err);
  });
