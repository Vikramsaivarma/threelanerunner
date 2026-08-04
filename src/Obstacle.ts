import Phaser from "phaser";

export default class Obstacle {
  scene: Phaser.Scene;
  sprite: Phaser.Physics.Arcade.Sprite;

  constructor(scene: Phaser.Scene, x: number, y: number, texture: string) {
    this.scene = scene;
    this.sprite = this.scene.physics.add.sprite(x, y, texture);
    this.sprite.setImmovable(true);
    this.sprite.setSize(48, 48);
  }
}
