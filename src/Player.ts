import Phaser from "phaser";

export default class Player {
  scene: Phaser.Scene;
  sprite: Phaser.Physics.Arcade.Sprite;
  lanes: number[];
  laneIndex = 1;
  moving = false;

  constructor(scene: Phaser.Scene, x: number, y: number, texture: string, lanes: number[]) {
    this.scene = scene;
    this.lanes = lanes;
    this.sprite = this.scene.physics.add.sprite(x, y, texture);
    this.sprite.setCollideWorldBounds(true);
    this.sprite.setImmovable(true);
  }

  moveLeft() {
    if (this.moving) return;
    if (this.laneIndex > 0) {
      this.laneIndex -= 1;
      this.moveToLane(this.laneIndex);
    }
  }

  moveRight() {
    if (this.moving) return;
    if (this.laneIndex < this.lanes.length - 1) {
      this.laneIndex += 1;
      this.moveToLane(this.laneIndex);
    }
  }

  moveToLane(index: number) {
    this.moving = true;
    this.scene.tweens.add({
      targets: this.sprite,
      x: this.lanes[index],
      duration: 120,
      ease: 'Power2',
      onComplete: () => { this.moving = false; }
    });
  }

  disable() {
    this.sprite.setTint(0x666666);
    this.sprite.body.enable = false as any;
  }
}
