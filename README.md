# Three Lane Runner

A minimal 3-lane infinite runner built with Phaser 3 and TypeScript.

Controls
- Keyboard: A / ← to move left, D / → to move right
- Touch: tap left or right half of the screen to change lanes
- After game over: tap/click to restart

Run locally
1. npm install
2. npm run dev
3. Open the URL shown by Vite (usually http://localhost:5173)

Notes
- High score is stored in localStorage under key `three-lane-runner-highscore`.
- Simple colored rectangles are used as placeholder art; replace textures in src/GameScene.ts preload if you want to add images.
