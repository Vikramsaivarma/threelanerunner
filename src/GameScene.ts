import Phaser from "phaser";
import Player from "./Player";
import Obstacle from "./Obstacle";

export default class GameScene extends Phaser.Scene {
  player!: Player;
  lanes = [120, 240, 360];
  speed = 200;
  score = 0;
  scoreText!: Phaser.GameObjects.Text;
  highScore = 0;
  obstacleTimer = 0;
  obstacles!: Phaser.Physics.Arcade.Group;
  running = true;

  constructor() { super({ key: "GameScene" }); }

  preload() {
    // generate simple textures for player and obstacle
    const g = this.add.graphics();
    g.fillStyle(0x00b894, 1);
    g.fillRoundedRect(0, 0, 64, 96, 8);
    g.generateTexture('player', 64, 96);
    g.clear();

    g.fillStyle(0xd63031, 1);
    g.fillRect(0, 0, 64, 64);
    g.generateTexture('obstacle', 64, 64);
    g.destroy();
  }

  create() {
    this.highScore = Number(localStorage.getItem('three-lane-runner-highscore') || '0');

    this.player = new Player(this, this.lanes[1], 650, 'player', this.lanes);

    this.scoreText = this.add.text(12, 12, 'Score: 0', { color: '#ffffff', fontSize: '20px' });
    this.add.text(12, 40, `High: ${this.highScore}`, { color: '#ffff66', fontSize: '16px' });

    this.obstacles = this.physics.add.group();

    this.physics.add.overlap(this.player.sprite, this.obstacles, () => this.endRun(), undefined, this);

    // keyboard
    this.input.keyboard.on('keydown-LEFT', () => { if (this.running) this.player.moveLeft(); });
    this.input.keyboard.on('keydown-A', () => { if (this.running) this.player.moveLeft(); });
    this.input.keyboard.on('keydown-RIGHT', () => { if (this.running) this.player.moveRight(); });
    this.input.keyboard.on('keydown-D', () => { if (this.running) this.player.moveRight(); });

    // touch/click
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!this.running) {
        this.scene.restart();
        return;
      }
      if (p.x < this.cameras.main.centerX) this.player.moveLeft();
      else this.player.moveRight();
    });

    // initial instructions
    this.add.text(12, 760, 'Tap/click left or right • A/D or ← → to change lanes', { color: '#888', fontSize: '12px' });

    // spawn a few initial obstacles
    this.obstacleTimer = 0;
  }

  update(time: number, dt: number) {
    if (!this.running) return;

    this.score += dt * 0.01;
    this.scoreText.setText(`Score: ${Math.floor(this.score)}`);

    // spawn obstacles periodically
    this.obstacleTimer += dt;
    const spawnInterval = Phaser.Math.Clamp(900 - this.score * 2, 350, 900);
    if (this.obstacleTimer > spawnInterval) {
      this.obstacleTimer = 0;
      const laneIndex = Phaser.Math.Between(0, 2);
      const x = this.lanes[laneIndex];
      const ob = new Obstacle(this, x, -80, 'obstacle');
      this.obstacles.add(ob.sprite);
      // give obstacle downward velocity; increase with score
      const vel = this.speed + this.score * 2;
      ob.sprite.setVelocityY(vel);
    }

    // increase speed slowly
    this.speed += dt * 0.001;

    // cleanup off-screen obstacles
    this.obstacles.children.each((child) => {
      const s = child as Phaser.Physics.Arcade.Sprite;
      if (s.y > this.cameras.main.height + 100) s.destroy();
    });
  }

  endRun() {
    this.running = false;
    // stop obstacles
    this.obstacles.children.each((child) => {
      const s = child as Phaser.Physics.Arcade.Sprite;
      s.setVelocityY(0);
    });
    // show game over
    const final = Math.floor(this.score);
    if (final > this.highScore) {
      this.highScore = final;
      localStorage.setItem('three-lane-runner-highscore', String(this.highScore));
    }

    const w = this.cameras.main.centerX;
    const h = this.cameras.main.centerY;

    this.add.rectangle(w, h - 40, 360, 160, 0x000000, 0.6).setStrokeStyle(2, 0xffffff);
    this.add.text(w, h - 80, 'Game Over', { color: '#ffffff', fontSize: '32px' }).setOrigin(0.5);
    this.add.text(w, h - 30, `Score: ${final}`, { color: '#ffff66', fontSize: '20px' }).setOrigin(0.5);
    this.add.text(w, h + 6, `High: ${this.highScore}`, { color: '#88ff88', fontSize: '18px' }).setOrigin(0.5);
    this.add.text(w, h + 40, 'Tap / Click to restart', { color: '#cccccc', fontSize: '14px' }).setOrigin(0.5);

    // stop player
    this.player.disable();
  }
}
