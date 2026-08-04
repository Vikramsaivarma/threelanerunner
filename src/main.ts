import Phaser from "phaser";
import GameScene from "./GameScene";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  width: 480,
  height: 800,
  backgroundColor: "#111",
  scene: [GameScene],
  physics: { default: "arcade", arcade: { debug: false } },
};

new Phaser.Game(config);
