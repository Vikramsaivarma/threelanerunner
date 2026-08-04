import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export interface GameCallbacks {
  onScore: (score: number) => void;
  onGameOver: (finalScore: number) => void;
  onRestart: () => void;
  onStart: () => void;
}

const LANE_COUNT = 3;
const LANE_X = [-2.2, 0, 2.2];
const ROAD_WIDTH = 7.4;
const PLAYER_Z = 0;
const SPAWN_Z = -90;
const DESPAWN_Z = 8;

const GRAVITY = 26;
const JUMP_VELOCITY = 8.4;
const JUMP_CLEAR_Y = 1.05;
const SLIDE_TIME = 0.7;
const FIRE_INTERVAL = 0.16;
const LASER_RANGE = 70;

type ObstacleKind = "crate" | "barrier" | "cone" | "train" | "enemy";
type PassMode = "jump" | "slide" | "avoid" | "enemy";

interface Obstacle {
  group: THREE.Group;
  lane: number;
  kind: ObstacleKind;
  halfDepth: number;
  halfWidth: number;
  passMode: PassMode;
  destroyed: boolean;
  hp: number;
  eye?: THREE.Mesh;
  eyeLight?: THREE.PointLight;
}

interface Scenery {
  group: THREE.Object3D;
  side: -1 | 1;
  z: number;
}

interface Laser {
  mesh: THREE.Mesh;
  life: number;
}

interface FX {
  mesh: THREE.Object3D;
  life: number;
  maxLife: number;
  spin: number;
  scaleRate: number;
  vy: number;
}

export default class RunnerGame {
  private canvas: HTMLCanvasElement;
  private cb: GameCallbacks;

  private renderer!: THREE.WebGLRenderer;
  private composer!: EffectComposer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private resizeObs?: ResizeObserver;

  private rafId: number | null = null;
  private running = false;
  private dead = false;
  private started = false;
  private lastTime = 0;

  private player!: THREE.Group;
  private playerLane = 1;
  private targetX = LANE_X[1];
  private playerX = LANE_X[1];
  private playerY = 0;
  private playerVY = 0;
  private jumping = false;
  private sliding = false;
  private slideTimer = 0;
  private leftLeg?: THREE.Group;
  private rightLeg?: THREE.Group;
  private leftArm?: THREE.Group;
  private rightArm?: THREE.Group;
  private playerShadow?: THREE.Mesh;
  private gunMuzzle!: THREE.Object3D;
  private muzzleFlash!: THREE.Mesh;
  private muzzleFlashLight!: THREE.PointLight;

  private obstacles: Obstacle[] = [];
  private scenery: Scenery[] = [];
  private laneLines: THREE.Mesh[] = [];
  private lasers: Laser[] = [];
  private fx: FX[] = [];

  private speed = 14;
  private distance = 0;
  private score = 0;
  private spawnTimer = 0;
  private runCycle = 0;
  private crashShake = 0;
  private fireTimer = 0;

  private keyHandler: (e: KeyboardEvent) => void;
  private touchStart: { x: number; y: number } | null = null;
  private touchStartHandler: (e: TouchEvent) => void;
  private touchEndHandler: (e: TouchEvent) => void;

  constructor(canvas: HTMLCanvasElement, cb: GameCallbacks) {
    this.canvas = canvas;
    this.cb = cb;
    this.keyHandler = (e) => this.onKey(e);
    this.touchStartHandler = (e) => this.onTouchStart(e);
    this.touchEndHandler = (e) => this.onTouchEnd(e);
  }

  init() {
    this.setupScene();
    this.buildLights();
    this.buildRoad();
    this.buildPlayer();
    this.buildScenery();
    window.addEventListener("keydown", this.keyHandler);
    this.canvas.addEventListener("touchstart", this.touchStartHandler, {
      passive: true,
    });
    this.canvas.addEventListener("touchend", this.touchEndHandler, {
      passive: true,
    });
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.canvas.parentElement || this.canvas);
    this.resize();
    this.renderOnce();
  }

  destroy() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    window.removeEventListener("keydown", this.keyHandler);
    this.canvas.removeEventListener("touchstart", this.touchStartHandler);
    this.canvas.removeEventListener("touchend", this.touchEndHandler);
    this.resizeObs?.disconnect();
    this.renderer?.dispose();
  }

  start() {
    if (this.dead || !this.started) this.reset();
    this.started = true;
    this.running = true;
    this.lastTime = performance.now();
    this.cb.onStart();
    this.rafId = requestAnimationFrame(this.loop);
  }

  private reset() {
    for (const o of this.obstacles) this.scene.remove(o.group);
    for (const l of this.lasers) this.scene.remove(l.mesh);
    for (const f of this.fx) this.scene.remove(f.mesh);
    this.obstacles = [];
    this.lasers = [];
    this.fx = [];
    this.playerLane = 1;
    this.targetX = LANE_X[1];
    this.playerX = LANE_X[1];
    this.playerY = 0;
    this.playerVY = 0;
    this.jumping = false;
    this.sliding = false;
    this.slideTimer = 0;
    this.speed = 14;
    this.distance = 0;
    this.score = 0;
    this.spawnTimer = 0;
    this.runCycle = 0;
    this.crashShake = 0;
    this.fireTimer = 0;
    this.dead = false;
    this.player.visible = true;
    this.player.rotation.set(0, 0, 0);
    this.player.scale.set(1, 1, 1);
    if (this.playerShadow) this.playerShadow.visible = true;
    this.muzzleFlash.visible = false;
    this.cb.onRestart();
    this.cb.onScore(0);
  }

  // ---------- scene setup ----------

  private setupScene() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    this.scene.background = this.makeSkyTexture();
    this.scene.fog = new THREE.Fog(0xb8cfe4, 32, 82);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 250);
    this.camera.position.set(0, 4.8, 8.4);
    this.camera.lookAt(0, 1.4, -6);

    // environment map for realistic reflections
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(envScene as unknown as THREE.Scene, 0.04).texture;

    // post-processing
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      0.6, // strength
      0.5, // radius
      0.82 // threshold
    );
    this.composer.addPass(bloom);
    this.composer.addPass(new OutputPass());
  }

  private makeSkyTexture(): THREE.Texture {
    const c = document.createElement("canvas");
    c.width = 16;
    c.height = 512;
    const g = c.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, "#3d7ec0");
    grad.addColorStop(0.35, "#6fa8d8");
    grad.addColorStop(0.6, "#a8c8e4");
    grad.addColorStop(0.8, "#d8e4f0");
    grad.addColorStop(0.92, "#f0dcc0");
    grad.addColorStop(1, "#e8c8a0");
    g.fillStyle = grad;
    g.fillRect(0, 0, 16, 512);
    // soft clouds
    g.fillStyle = "rgba(255,255,255,0.5)";
    for (let i = 0; i < 6; i++) {
      const y = 120 + i * 50 + Math.random() * 30;
      g.beginPath();
      g.ellipse(8, y, 5, 2.5, 0, 0, Math.PI * 2);
      g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private buildLights() {
    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x6b7a55, 0.55);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff2d8, 2.0);
    sun.position.set(-9, 18, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 60;
    sun.shadow.camera.left = -12;
    sun.shadow.camera.right = 12;
    sun.shadow.camera.top = 12;
    sun.shadow.camera.bottom = -12;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    this.scene.add(sun.target);

    // warm fill light from opposite side
    const fill = new THREE.DirectionalLight(0xffd9b3, 0.35);
    fill.position.set(8, 6, -4);
    this.scene.add(fill);
  }

  private buildRoad() {
    // grass ground
    const groundGeo = new THREE.PlaneGeometry(240, 260);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x5f7a3d,
      roughness: 1.0,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.z = -45;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // grass motion stripes
    for (let i = 0; i < 26; i++) {
      const stripe = new THREE.Mesh(
        new THREE.PlaneGeometry(240, 1.4),
        new THREE.MeshStandardMaterial({
          color: i % 2 ? 0x576f37 : 0x668043,
          roughness: 1,
        })
      );
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(0, 0.01, -i * 10 + 85);
      stripe.receiveShadow = true;
      this.scene.add(stripe);
      this.scenery.push({ group: stripe, side: 1, z: stripe.position.z });
    }

    // asphalt road with procedural texture
    const roadTex = this.makeAsphaltTexture();
    roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping;
    roadTex.repeat.set(1, 14);
    const roadGeo = new THREE.PlaneGeometry(ROAD_WIDTH, 260);
    const roadMat = new THREE.MeshStandardMaterial({
      map: roadTex,
      color: 0x3a3e44,
      roughness: 0.92,
      metalness: 0.0,
    });
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.02, -45);
    road.receiveShadow = true;
    this.scene.add(road);

    // lane divider dashed lines
    const dashGeo = new THREE.PlaneGeometry(0.2, 2.6);
    const dashMat = new THREE.MeshStandardMaterial({
      color: 0xf5f5f5,
      roughness: 0.5,
      emissive: 0x333333,
    });
    for (const lx of [LANE_X[0] + 1.1, LANE_X[2] - 1.1]) {
      for (let i = 0; i < 44; i++) {
        const dash = new THREE.Mesh(dashGeo, dashMat);
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(lx, 0.03, -i * 6 + 85);
        this.scene.add(dash);
        this.laneLines.push(dash);
      }
    }

    // curbs
    for (const side of [-1, 1]) {
      const curb = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.3, 260),
        new THREE.MeshStandardMaterial({ color: 0xc8c8c8, roughness: 0.7 })
      );
      curb.position.set(side * (ROAD_WIDTH / 2 + 0.2), 0.15, -45);
      curb.receiveShadow = true;
      curb.castShadow = true;
      this.scene.add(curb);
    }

    // distant mountains for depth
    const mountainMat = new THREE.MeshStandardMaterial({
      color: 0x7a8a9a,
      roughness: 1,
      flatShading: true,
    });
    for (let i = 0; i < 10; i++) {
      const h = 8 + Math.random() * 10;
      const m = new THREE.Mesh(
        new THREE.ConeGeometry(4 + Math.random() * 4, h, 5),
        mountainMat
      );
      m.position.set(
        (Math.random() - 0.5) * 120,
        h / 2 - 1,
        -70 - Math.random() * 30
      );
      m.rotation.y = Math.random() * Math.PI;
      this.scene.add(m);
    }
  }

  private makeAsphaltTexture(): THREE.Texture {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 128;
    const g = c.getContext("2d")!;
    g.fillStyle = "#3a3e44";
    g.fillRect(0, 0, 128, 128);
    // noise speckles
    for (let i = 0; i < 1200; i++) {
      const x = Math.random() * 128;
      const y = Math.random() * 128;
      const v = Math.random();
      g.fillStyle = v > 0.5 ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.12)";
      g.fillRect(x, y, 1.5, 1.5);
    }
    // cracks
    g.strokeStyle = "rgba(0,0,0,0.25)";
    g.lineWidth = 0.5;
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.moveTo(Math.random() * 128, 0);
      g.bezierCurveTo(
        Math.random() * 128, 40,
        Math.random() * 128, 80,
        Math.random() * 128, 128
      );
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  private buildPlayer() {
    this.player = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({
      color: 0xe8b58c,
      roughness: 0.55,
      metalness: 0.0,
    });
    const jacket = new THREE.MeshStandardMaterial({
      color: 0xff5a3c,
      roughness: 0.45,
      metalness: 0.05,
    });
    const pants = new THREE.MeshStandardMaterial({
      color: 0x2a3550,
      roughness: 0.7,
      metalness: 0.0,
    });
    const shoe = new THREE.MeshStandardMaterial({
      color: 0xf5f5f5,
      roughness: 0.4,
      metalness: 0.1,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.4,
      metalness: 0.2,
    });

    // torso (slightly tapered)
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.78, 0.38), jacket);
    torso.position.y = 1.05;
    torso.castShadow = true;
    this.player.add(torso);

    // collar
    const collar = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.1, 0.4), dark);
    collar.position.y = 1.42;
    this.player.add(collar);

    const hips = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.22, 0.36), pants);
    hips.position.y = 0.62;
    hips.castShadow = true;
    this.player.add(hips);

    // head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.34), skin);
    head.position.y = 1.62;
    head.castShadow = true;
    this.player.add(head);
    // cap
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.14, 0.38),
      new THREE.MeshStandardMaterial({ color: 0x1f8a70, roughness: 0.55 })
    );
    cap.position.y = 1.78;
    cap.castShadow = true;
    this.player.add(cap);
    // cap brim
    const brim = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.04, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x1f8a70, roughness: 0.55 })
    );
    brim.position.set(0, 1.74, -0.24);
    this.player.add(brim);

    // backpack
    const pack = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.52, 0.24),
      new THREE.MeshStandardMaterial({ color: 0xf2b705, roughness: 0.55 })
    );
    pack.position.set(0, 1.05, 0.33);
    pack.castShadow = true;
    this.player.add(pack);
    // backpack straps
    for (const sx of [-0.2, 0.2]) {
      const strap = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.6, 0.04),
        new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 })
      );
      strap.position.set(sx, 1.1, 0.2);
      this.player.add(strap);
    }

    // laser blaster
    const gunGroup = new THREE.Group();
    const gunMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.3,
      metalness: 0.85,
    });
    const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.5), gunMat);
    gunBody.castShadow = true;
    gunGroup.add(gunBody);
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.05, 0.42, 12),
      gunMat
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -0.44);
    gunGroup.add(barrel);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 12, 12),
      new THREE.MeshStandardMaterial({
        color: 0x00ffff,
        emissive: 0x00ffff,
        emissiveIntensity: 3,
      })
    );
    core.position.set(0, 0.04, -0.64);
    gunGroup.add(core);
    this.gunMuzzle = new THREE.Object3D();
    this.gunMuzzle.position.set(0, 0.02, -0.68);
    gunGroup.add(this.gunMuzzle);
    gunGroup.position.set(0.38, 1.05, -0.22);
    this.player.add(gunGroup);

    this.muzzleFlash = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 10, 10),
      new THREE.MeshBasicMaterial({
        color: 0x88ffff,
        transparent: true,
        opacity: 0.9,
      })
    );
    this.muzzleFlash.visible = false;
    this.player.add(this.muzzleFlash);
    this.muzzleFlashLight = new THREE.PointLight(0x00ffff, 0, 5);
    this.player.add(this.muzzleFlashLight);

    // arms
    const armGeo = new THREE.BoxGeometry(0.16, 0.62, 0.16);
    const makeArm = (side: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.4, 1.4, 0);
      const arm = new THREE.Mesh(armGeo, jacket);
      arm.position.y = -0.3;
      arm.castShadow = true;
      pivot.add(arm);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.16, 0.17), skin);
      hand.position.y = -0.62;
      pivot.add(hand);
      this.player.add(pivot);
      return pivot;
    };
    this.leftArm = makeArm(-1);
    this.rightArm = makeArm(1);

    // legs
    const legGeo = new THREE.BoxGeometry(0.2, 0.6, 0.2);
    const makeLeg = (side: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.16, 0.6, 0);
      const leg = new THREE.Mesh(legGeo, pants);
      leg.position.y = -0.3;
      leg.castShadow = true;
      pivot.add(leg);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.34), shoe);
      foot.position.set(0, -0.62, 0.06);
      foot.castShadow = true;
      pivot.add(foot);
      this.player.add(pivot);
      return pivot;
    };
    this.leftLeg = makeLeg(-1);
    this.rightLeg = makeLeg(1);

    this.player.position.set(LANE_X[1], 0, PLAYER_Z);
    this.scene.add(this.player);

    const shadowTex = this.makeShadowTexture();
    this.playerShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 1.5),
      new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.5,
      })
    );
    this.playerShadow.rotation.x = -Math.PI / 2;
    this.playerShadow.position.set(LANE_X[1], 0.04, PLAYER_Z);
    this.scene.add(this.playerShadow);
  }

  private makeShadowTexture(): THREE.Texture {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, "rgba(0,0,0,0.6)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  private buildScenery() {
    const buildingColors = [
      0x9a8a72, 0x8a7a6a, 0x7a8a9a, 0x9a9a8a, 0x8a6a5a, 0x7a6a7a, 0x6a8a8a,
    ];
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < 9; i++) {
        const color =
          buildingColors[Math.floor(Math.random() * buildingColors.length)];
        const b = this.makeBuilding(color);
        const z = -i * 13 + 22;
        b.position.set(side * (ROAD_WIDTH / 2 + 5 + Math.random() * 3), 0, z);
        b.rotation.y = (Math.random() - 0.5) * 0.12;
        this.scene.add(b);
        this.scenery.push({ group: b, side, z });
      }
    }
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < 7; i++) {
        const lamp = this.makeLamp();
        const z = -i * 16 + 16;
        lamp.position.set(side * (ROAD_WIDTH / 2 + 1.2), 0, z);
        this.scene.add(lamp);
        this.scenery.push({ group: lamp, side, z });
      }
    }
    // trees
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < 5; i++) {
        const tree = this.makeTree();
        const z = -i * 20 - 5 + Math.random() * 6;
        tree.position.set(side * (ROAD_WIDTH / 2 + 3), 0, z);
        this.scene.add(tree);
        this.scenery.push({ group: tree, side, z });
      }
    }
  }

  private makeBuilding(color: number): THREE.Group {
    const g = new THREE.Group();
    const w = 4 + Math.random() * 3;
    const h = 6 + Math.random() * 14;
    const d = 4 + Math.random() * 3;
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.88 })
    );
    wall.position.y = h / 2;
    wall.castShadow = true;
    wall.receiveShadow = true;
    g.add(wall);

    const tex = this.makeWindowTexture();
    const winMat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.3,
      metalness: 0.5,
      emissive: 0x111122,
      emissiveMap: tex,
      emissiveIntensity: 0.5,
    });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.86, h * 0.86), winMat);
    front.position.set(0, h / 2, d / 2 + 0.01);
    g.add(front);
    const back = front.clone();
    back.position.z = -d / 2 - 0.01;
    back.rotation.y = Math.PI;
    g.add(back);
    const left = new THREE.Mesh(new THREE.PlaneGeometry(d * 0.86, h * 0.86), winMat);
    left.position.set(-w / 2 - 0.01, h / 2, 0);
    left.rotation.y = -Math.PI / 2;
    g.add(left);
    const right = left.clone();
    right.position.x = w / 2 + 0.01;
    right.rotation.y = Math.PI / 2;
    g.add(right);

    // rooftop AC unit
    if (Math.random() > 0.4) {
      const ac = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.3, 0.5, d * 0.3),
        new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8 })
      );
      ac.position.set((Math.random() - 0.5) * w * 0.4, h + 0.25, (Math.random() - 0.5) * d * 0.4);
      ac.castShadow = true;
      g.add(ac);
    }
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.5, 0.3, d * 0.5),
      new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.9 })
    );
    roof.position.y = h + 0.15;
    roof.castShadow = true;
    g.add(roof);
    return g;
  }

  private makeWindowTexture(): THREE.Texture {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 256;
    const g = c.getContext("2d")!;
    g.fillStyle = "#3a4252";
    g.fillRect(0, 0, 128, 256);
    const cols = 4;
    const rows = 8;
    const pad = 6;
    const cw = (128 - pad * (cols + 1)) / cols;
    const ch = (256 - pad * (rows + 1)) / rows;
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        const lit = Math.random() > 0.5;
        g.fillStyle = lit
          ? `rgba(${230 + Math.random() * 25},${210 + Math.random() * 30},120,1)`
          : "rgba(40,50,70,1)";
        g.fillRect(pad + col * (cw + pad), pad + r * (ch + pad), cw, ch);
        // window frame
        g.strokeStyle = "rgba(20,25,35,0.8)";
        g.lineWidth = 1;
        g.strokeRect(pad + col * (cw + pad), pad + r * (ch + pad), cw, ch);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private makeLamp(): THREE.Group {
    const g = new THREE.Group();
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a2a,
      roughness: 0.5,
      metalness: 0.6,
    });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4, 8), poleMat);
    pole.position.y = 2;
    pole.castShadow = true;
    g.add(pole);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 8), poleMat);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(-0.5, 3.9, 0);
    g.add(arm);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 12, 12),
      new THREE.MeshStandardMaterial({
        color: 0xfff3c4,
        emissive: 0xffe9a0,
        emissiveIntensity: 2.5,
      })
    );
    bulb.position.set(-1, 3.85, 0);
    g.add(bulb);
    const light = new THREE.PointLight(0xffe5a0, 0.6, 6);
    light.position.set(-1, 3.8, 0);
    g.add(light);
    return g;
  }

  private makeTree(): THREE.Group {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.22, 1.6, 8),
      new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.9 })
    );
    trunk.position.y = 0.8;
    trunk.castShadow = true;
    g.add(trunk);
    const leaves = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0x3d6b2a, roughness: 0.95 })
    );
    leaves.position.y = 2.2;
    leaves.scale.y = 1.2;
    leaves.castShadow = true;
    g.add(leaves);
    return g;
  }

  // ---------- obstacles ----------

  private spawnObstacle() {
    const lane = Math.floor(Math.random() * LANE_COUNT);
    const kinds: ObstacleKind[] = ["crate", "barrier", "cone", "train", "enemy"];
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const group = this.makeObstacle(kind);
    group.position.set(LANE_X[lane], 0, SPAWN_Z);
    this.scene.add(group);

    let halfDepth = 0.6;
    let halfWidth = 0.7;
    let passMode: PassMode = "avoid";
    let hp = 1;
    let eye: THREE.Mesh | undefined;
    let eyeLight: THREE.PointLight | undefined;

    if (kind === "crate") {
      halfDepth = 0.6;
      halfWidth = 0.6;
      passMode = "jump";
    } else if (kind === "cone") {
      halfDepth = 0.4;
      halfWidth = 0.4;
      passMode = "jump";
    } else if (kind === "barrier") {
      halfDepth = 0.4;
      halfWidth = 0.95;
      passMode = "slide";
    } else if (kind === "train") {
      halfDepth = 2.2;
      halfWidth = 0.9;
      passMode = "avoid";
    } else if (kind === "enemy") {
      halfDepth = 0.5;
      halfWidth = 0.5;
      passMode = "enemy";
      hp = 2;
      eye = group.children.find((c) => c.name === "eye") as THREE.Mesh;
      eyeLight = group.children.find(
        (c) => c instanceof THREE.PointLight && c.name === "eyeLight"
      ) as THREE.PointLight;
    }

    this.obstacles.push({
      group,
      lane,
      kind,
      halfDepth,
      halfWidth,
      passMode,
      destroyed: false,
      hp,
      eye,
      eyeLight,
    });
  }

  private makeObstacle(kind: ObstacleKind): THREE.Group {
    const g = new THREE.Group();
    if (kind === "crate") {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 1.0, 1.2),
        new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.88 })
      );
      box.position.y = 0.5;
      box.castShadow = true;
      box.receiveShadow = true;
      g.add(box);
      const frameMat = new THREE.MeshStandardMaterial({
        color: 0x5a3a1a,
        roughness: 0.6,
      });
      for (const s of [0.51, -0.51]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.1, 1.24), frameMat);
        band.position.y = 0.5 + s;
        g.add(band);
      }
      // crate planks
      for (const s of [0.3, -0.3]) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.06, 0.08), frameMat);
        plank.position.set(0, 0.5 + s, 0.61);
        g.add(plank);
      }
    } else if (kind === "barrier") {
      const postMat = new THREE.MeshStandardMaterial({
        color: 0xd23b3b,
        roughness: 0.55,
        metalness: 0.1,
      });
      for (const sx of [-0.9, 0.9]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.4, 0.16), postMat);
        post.position.set(sx, 1.2, 0);
        post.castShadow = true;
        g.add(post);
      }
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(2.0, 0.7, 0.3),
        new THREE.MeshStandardMaterial({ color: 0xe74c3c, roughness: 0.5 })
      );
      beam.position.set(0, 2.2, 0);
      beam.castShadow = true;
      g.add(beam);
      const stripeMat = new THREE.MeshStandardMaterial({
        color: 0xf5f5f5,
        roughness: 0.5,
      });
      for (let i = -1; i <= 1; i += 2) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.72, 0.32), stripeMat);
        s.position.set(i * 0.6, 2.2, 0);
        g.add(s);
      }
      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.5, 0.06),
        new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.5 })
      );
      sign.position.set(0, 1.75, 0.18);
      g.add(sign);
    } else if (kind === "cone") {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.42, 0.9, 16),
        new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.45 })
      );
      cone.position.y = 0.5;
      cone.castShadow = true;
      g.add(cone);
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.3, 0.14, 16),
        new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.5 })
      );
      band.position.y = 0.56;
      g.add(band);
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.06, 0.7),
        new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 })
      );
      base.position.y = 0.03;
      base.receiveShadow = true;
      g.add(base);
    } else if (kind === "train") {
      const carMat = new THREE.MeshStandardMaterial({
        color: 0xc4b04a,
        roughness: 0.35,
        metalness: 0.4,
      });
      const car = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.2, 4.4), carMat);
      car.position.y = 1.2;
      car.castShadow = true;
      car.receiveShadow = true;
      g.add(car);
      // rivets / panel lines
      const lineMat = new THREE.MeshStandardMaterial({
        color: 0x8a7a30,
        roughness: 0.5,
      });
      for (const z of [-1.4, 0, 1.4]) {
        const line = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.04, 0.04), lineMat);
        line.position.set(0, 0.5, z);
        g.add(line);
      }
      const winMat = new THREE.MeshStandardMaterial({
        color: 0x1a2a3a,
        roughness: 0.1,
        metalness: 0.8,
        emissive: 0x0a1a2a,
        emissiveIntensity: 0.4,
      });
      for (let i = -1; i <= 1; i++) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.6, 0.6), winMat);
        w.position.set(0, 1.6, i * 1.3);
        g.add(w);
      }
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(1.84, 0.18, 4.44),
        new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5 })
      );
      stripe.position.y = 0.7;
      g.add(stripe);
      // headlights
      const headlightMat = new THREE.MeshStandardMaterial({
        color: 0xffffcc,
        emissive: 0xffffaa,
        emissiveIntensity: 2,
      });
      for (const sx of [-0.6, 0.6]) {
        const hl = new THREE.Mesh(new THREE.CircleGeometry(0.12, 12), headlightMat);
        hl.position.set(sx, 1.0, 2.21);
        g.add(hl);
      }
    } else {
      // enemy drone
      const bodyMat = new THREE.MeshStandardMaterial({
        color: 0x2a2a35,
        roughness: 0.3,
        metalness: 0.8,
      });
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 20), bodyMat);
      body.position.y = 1.4;
      body.castShadow = true;
      g.add(body);
      const plateMat = new THREE.MeshStandardMaterial({
        color: 0x444450,
        roughness: 0.25,
        metalness: 0.9,
      });
      const top = new THREE.Mesh(
        new THREE.SphereGeometry(0.52, 20, 20, 0, Math.PI * 2, 0, Math.PI / 2.2),
        plateMat
      );
      top.position.y = 1.4;
      g.add(top);
      // glowing red eye
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 14, 14),
        new THREE.MeshStandardMaterial({
          color: 0xff1a1a,
          emissive: 0xff1a1a,
          emissiveIntensity: 4,
        })
      );
      eye.name = "eye";
      eye.position.set(0, 1.4, -0.42);
      g.add(eye);
      const eyeLight = new THREE.PointLight(0xff2020, 1.5, 4);
      eyeLight.name = "eyeLight";
      eyeLight.position.set(0, 1.4, -0.5);
      g.add(eyeLight);
      // thrusters
      const thrMat = new THREE.MeshStandardMaterial({
        color: 0xff8800,
        emissive: 0xff6600,
        emissiveIntensity: 2.5,
      });
      for (const sx of [-0.3, 0.3]) {
        const t = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 8), thrMat);
        t.position.set(sx, 1.0, 0);
        t.rotation.x = Math.PI;
        g.add(t);
      }
      // antenna
      const ant = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6),
        plateMat
      );
      ant.position.set(0, 1.95, 0);
      g.add(ant);
      const antTip = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 8, 8),
        new THREE.MeshStandardMaterial({
          color: 0xff0000,
          emissive: 0xff0000,
          emissiveIntensity: 3,
        })
      );
      antTip.position.set(0, 2.18, 0);
      g.add(antTip);
    }
    return g;
  }

  // ---------- input ----------

  private onKey(e: KeyboardEvent) {
    if (e.key === " " || e.code === "Space") {
      e.preventDefault();
      if (!this.running) this.start();
      return;
    }
    if (!this.running) return;
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") this.moveLane(-1);
    else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") this.moveLane(1);
    else if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") this.jump();
    else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") this.slide();
  }

  private onTouchStart(e: TouchEvent) {
    const t = e.touches[0];
    this.touchStart = { x: t.clientX, y: t.clientY };
  }

  private onTouchEnd(e: TouchEvent) {
    if (!this.touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - this.touchStart.x;
    const dy = t.clientY - this.touchStart.y;
    this.touchStart = null;
    if (!this.running) {
      this.start();
      return;
    }
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
    if (Math.abs(dx) > Math.abs(dy)) {
      this.moveLane(dx > 0 ? 1 : -1);
    } else {
      if (dy < 0) this.jump();
      else this.slide();
    }
  }

  private moveLane(dir: number) {
    const next = Math.max(0, Math.min(LANE_COUNT - 1, this.playerLane + dir));
    if (next !== this.playerLane) {
      this.playerLane = next;
      this.targetX = LANE_X[next];
    }
  }

  private jump() {
    if (this.jumping || this.sliding) return;
    this.jumping = true;
    this.playerVY = JUMP_VELOCITY;
  }

  private slide() {
    if (this.jumping) return;
    this.sliding = true;
    this.slideTimer = SLIDE_TIME;
  }

  // ---------- loop ----------

  private loop = (time: number) => {
    if (!this.running) return;
    const dt = Math.min(0.05, (time - this.lastTime) / 1000);
    this.lastTime = time;
    this.update(dt);
    this.composer.render();
    this.rafId = requestAnimationFrame(this.loop);
  };

  private renderOnce() {
    this.composer.render();
  }

  private update(dt: number) {
    this.speed += 0.45 * dt;
    const move = this.speed * dt;
    this.distance += move;

    const newScore = Math.floor(this.distance / 2);
    if (newScore !== this.score) {
      this.score = newScore;
      this.cb.onScore(this.score);
    }

    this.playerX += (this.targetX - this.playerX) * Math.min(1, dt * 14);
    this.player.position.x = this.playerX;
    if (this.playerShadow) this.playerShadow.position.x = this.playerX;
    const lean = (this.targetX - this.playerX) * 0.18;
    this.player.rotation.z = THREE.MathUtils.clamp(lean, -0.25, 0.25);

    if (this.jumping) {
      this.playerVY -= GRAVITY * dt;
      this.playerY += this.playerVY * dt;
      if (this.playerY <= 0) {
        this.playerY = 0;
        this.playerVY = 0;
        this.jumping = false;
      }
    }
    this.player.position.y = this.playerY;

    if (this.sliding) {
      this.slideTimer -= dt;
      if (this.slideTimer <= 0) this.sliding = false;
    }

    this.runCycle += dt * (6 + this.speed * 0.18);
    const swing = Math.sin(this.runCycle) * 0.7;
    if (this.leftLeg && this.rightLeg && this.leftArm && this.rightArm) {
      if (this.jumping) {
        this.leftLeg.rotation.x = 0.5;
        this.rightLeg.rotation.x = 0.3;
        this.leftArm.rotation.x = -1.2;
        this.rightArm.rotation.x = -1.2;
      } else if (this.sliding) {
        this.leftLeg.rotation.x = 1.0;
        this.rightLeg.rotation.x = 0.7;
        this.leftArm.rotation.x = -1.6;
        this.rightArm.rotation.x = -1.6;
      } else {
        this.leftLeg.rotation.x = swing;
        this.rightLeg.rotation.x = -swing;
        this.leftArm.rotation.x = -swing * 0.8;
        this.rightArm.rotation.x = swing * 0.8;
      }
    }

    const targetScaleY = this.sliding ? 0.5 : 1;
    this.player.scale.y += (targetScaleY - this.player.scale.y) * Math.min(1, dt * 18);
    const targetTiltX = this.sliding ? 0.5 : 0;
    this.player.rotation.x += (targetTiltX - this.player.rotation.x) * Math.min(1, dt * 18);

    if (this.playerShadow) {
      const s = 1 - Math.min(0.5, this.playerY * 0.25);
      this.playerShadow.scale.set(s, s, s);
      (this.playerShadow.material as THREE.MeshBasicMaterial).opacity = 0.5 * s;
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnObstacle();
      const gap = Math.max(0.7, 1.6 - this.speed * 0.02);
      this.spawnTimer = gap + Math.random() * 0.5;
    }

    for (const o of this.obstacles) {
      o.group.position.z += move;
      if (o.kind === "enemy" && !o.destroyed) {
        o.group.position.y = Math.sin(performance.now() * 0.004 + o.lane) * 0.12;
        o.group.rotation.y += dt * 1.5;
        // pulsing eye
        if (o.eye) {
          const pulse = 3 + Math.sin(performance.now() * 0.008) * 1.5;
          (o.eye.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse;
        }
      }
    }
    this.obstacles = this.obstacles.filter((o) => {
      if (o.group.position.z > DESPAWN_Z || o.destroyed) {
        this.scene.remove(o.group);
        return false;
      }
      return true;
    });

    for (const o of this.obstacles) {
      if (o.lane !== this.playerLane) continue;
      const dz = o.group.position.z - PLAYER_Z;
      if (Math.abs(dz) >= o.halfDepth + 0.4) continue;

      if (o.passMode === "jump") {
        if (this.playerY < JUMP_CLEAR_Y) {
          this.triggerCrash();
          return;
        }
      } else if (o.passMode === "slide") {
        if (!this.sliding) {
          this.triggerCrash();
          return;
        }
      } else {
        if (o.passMode === "enemy" && o.destroyed) continue;
        this.triggerCrash();
        return;
      }
    }

    this.fireTimer -= dt;
    if (this.fireTimer <= 0) {
      const target = this.findTarget();
      if (target) {
        this.fireLaser(target);
        this.fireTimer = FIRE_INTERVAL;
      } else {
        this.fireTimer = 0;
      }
    }

    for (const l of this.lasers) {
      l.life -= dt;
      (l.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, l.life * 8);
    }
    this.lasers = this.lasers.filter((l) => {
      if (l.life <= 0) {
        this.scene.remove(l.mesh);
        return false;
      }
      return true;
    });

    if (this.muzzleFlash.visible) {
      this.muzzleFlash.scale.multiplyScalar(0.8);
      this.muzzleFlashLight.intensity *= 0.8;
      if (this.muzzleFlash.scale.x < 0.05) {
        this.muzzleFlash.visible = false;
        this.muzzleFlashLight.intensity = 0;
      }
    }

    for (const f of this.fx) {
      f.life -= dt;
      f.mesh.rotation.z += f.spin * dt;
      f.mesh.scale.multiplyScalar(1 + f.scaleRate * dt);
      f.mesh.position.y += f.vy * dt;
      f.vy -= 4 * dt;
      const mat = (f.mesh as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.transparent = true;
      mat.opacity = Math.max(0, f.life / f.maxLife);
    }
    this.fx = this.fx.filter((f) => {
      if (f.life <= 0) {
        this.scene.remove(f.mesh);
        return false;
      }
      return true;
    });

    for (const s of this.scenery) {
      s.group.position.z += move;
      if (s.group.position.z > 14) s.group.position.z -= 117;
    }
    for (const dash of this.laneLines) {
      dash.position.z += move;
      if (dash.position.z > 14) dash.position.z -= 264;
    }

    this.camera.position.x +=
      (this.playerX * 0.35 - this.camera.position.x) * Math.min(1, dt * 4);
    this.camera.lookAt(this.playerX * 0.2, 1.4, -6);

    if (this.crashShake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.crashShake;
      this.camera.position.y += (Math.random() - 0.5) * this.crashShake;
      this.crashShake *= 0.9;
    }
  }

  private findTarget(): Obstacle | null {
    let best: Obstacle | null = null;
    let bestZ = Infinity;
    for (const o of this.obstacles) {
      if (o.passMode !== "enemy" || o.destroyed) continue;
      const z = o.group.position.z;
      if (z < PLAYER_Z - 0.5 && z > PLAYER_Z - LASER_RANGE) {
        if (z < bestZ) {
          bestZ = z;
          best = o;
        }
      }
    }
    return best;
  }

  private fireLaser(target: Obstacle) {
    const muzzlePos = new THREE.Vector3();
    this.gunMuzzle.getWorldPosition(muzzlePos);
    const targetPos = new THREE.Vector3();
    target.group.getWorldPosition(targetPos);
    targetPos.y += 1.4;

    const dir = targetPos.clone().sub(muzzlePos);
    const len = dir.length();
    if (len < 0.01) return;
    dir.normalize();

    const geo = new THREE.CylinderGeometry(0.05, 0.05, len, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 1,
    });
    const beam = new THREE.Mesh(geo, mat);
    beam.position.copy(muzzlePos).addScaledVector(dir, len / 2);
    const quat = new THREE.Quaternion();
    quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    beam.quaternion.copy(quat);
    this.scene.add(beam);
    this.lasers.push({ mesh: beam, life: 0.12 });

    this.muzzleFlash.position.copy(muzzlePos);
    this.muzzleFlash.scale.set(1, 1, 1);
    this.muzzleFlash.visible = true;
    this.muzzleFlashLight.position.copy(muzzlePos);
    this.muzzleFlashLight.intensity = 4;

    target.hp -= 1;
    if (target.hp <= 0) {
      this.destroyEnemy(target);
    } else {
      // hit flash on enemy
      if (target.eye) {
        (target.eye.material as THREE.MeshStandardMaterial).emissiveIntensity = 8;
      }
    }
  }

  private destroyEnemy(o: Obstacle) {
    o.destroyed = true;
    const pos = o.group.position.clone();
    pos.y += 1.4;
    this.spawnExplosion(pos, 0xff3322);
    this.score += 25;
    this.distance += 50;
    this.cb.onScore(this.score);
  }

  private spawnExplosion(pos: THREE.Vector3, color: number) {
    for (let i = 0; i < 12; i++) {
      const piece = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.18, 0.18),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 })
      );
      piece.position.copy(pos);
      piece.position.x += (Math.random() - 0.5) * 0.6;
      piece.position.y += (Math.random() - 0.5) * 0.6;
      piece.position.z += (Math.random() - 0.5) * 0.6;
      piece.rotation.set(Math.random(), Math.random(), Math.random());
      this.scene.add(piece);
      this.fx.push({
        mesh: piece,
        life: 0.5 + Math.random() * 0.3,
        maxLife: 0.8,
        spin: 6,
        scaleRate: 1.5,
        vy: 1 + Math.random() * 2,
      });
    }
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffaa44, transparent: true, opacity: 1 })
    );
    flash.position.copy(pos);
    this.scene.add(flash);
    this.fx.push({
      mesh: flash,
      life: 0.3,
      maxLife: 0.3,
      spin: 0,
      scaleRate: 6,
      vy: 0,
    });
  }

  private triggerCrash() {
    this.running = false;
    this.dead = true;
    this.crashShake = 0.25;
    this.player.rotation.x = -0.9;
    this.player.position.y = 0.4;
    this.spawnExplosion(new THREE.Vector3(this.playerX, 1.0, PLAYER_Z), 0xff5a3c);
    this.cb.onGameOver(this.score);
    this.renderOnce();
  }

  private resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
