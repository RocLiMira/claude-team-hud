/**
 * Building View — Tiny Tower style.
 * Each floor shows a mini office with real sprite assets.
 * Click a floor to zoom into that team's full office.
 */

import { Application, Container, Graphics, Sprite, Text, TextStyle, TextureSource } from "pixi.js";
import type { TeamSnapshot } from "../ipc/types";
import { loadAllAssets, getCharFrame, getFloorTexture, getFurniture, CHAR_FRAME_W, CHAR_FRAME_H } from "./AssetLoader";

// Layout
const FLOOR_H = 72;
const FLOOR_INNER_W = 480;
const WALL_W = 10;
const BUILDING_W = FLOOR_INNER_W + WALL_W * 2;
const ROOF_H = 40;
const GROUND_H = 36;
const TILE = 16;
const MINI_SCALE = 0.85; // Scale for furniture/characters inside floors

// Palette
const P = {
  sky:       0x0c0c1a,
  starDim:   0xffdd44,
  starBright:0xffffff,
  brick1:    0x7a4e30,
  brick2:    0x8b5e3c,
  brick3:    0x6b4428,
  mortar:    0x4a3a2a,
  beam:      0x555566,
  beamHi:    0x777788,
  roofBase:  0x444455,
  roofEdge:  0x333344,
  neonCyan:  0x00ddee,
  neonGlow:  0x00aacc,
  ground:    0x3a5a3a,
  sidewalk:  0x777777,
  door:      0x886644,
  doorFrame: 0x554433,
  textTeam:  0x00cccc,
  textDim:   0x8a8a98,
  statusOn:  0x44cc44,
  statusOff: 0x444444,
  hoverTint: 0x222244,
};

// Zone floor tints (matches office zones)
const ZONE_TINTS = [0xddccee, 0xccddee, 0xcceecc, 0xddccee];

interface FloorInfo {
  container: Container;
  teamName: string;
  bgGraphics: Graphics;
}

export class BuildingScene {
  private app: Application | null = null;
  private el: HTMLDivElement;
  private scene!: Container;
  private floors: FloorInfo[] = [];
  private onFloorClick: ((name: string) => void) | null = null;
  private assetsLoaded = false;

  // Day/night cycle
  private celestialContainer: Container | null = null;
  private sunText: Text | null = null;
  private moonText: Text | null = null;
  private cyclePhase = 0; // 0..1 continuous

  constructor(el: HTMLDivElement) { this.el = el; }

  async init(onFloorClick: (name: string) => void): Promise<void> {
    TextureSource.defaultOptions.scaleMode = "nearest";
    this.onFloorClick = onFloorClick;

    this.app = new Application();
    await this.app.init({
      width: 600, height: 600,
      background: P.sky,
      resolution: window.devicePixelRatio || 2,
      autoDensity: true,
      antialias: false, roundPixels: true,
    });

    const canvas = this.app.canvas as HTMLCanvasElement;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.style.objectFit = "contain";
    this.el.appendChild(canvas);

    this.scene = new Container();
    this.app.stage.addChild(this.scene);

    // Load sprite assets
    await loadAllAssets();
    this.assetsLoaded = true;

    // Start day/night animation loop
    this.app.ticker.maxFPS = 30;
    this.app.ticker.add(() => this.animateCelestial());
  }

  update(teams: Map<string, TeamSnapshot>): void {
    if (!this.app || !this.assetsLoaded) return;
    this.scene.removeChildren();
    this.floors = [];

    const list = [...teams.entries()];
    const numFloors = list.length;
    // Fixed canvas size — don't resize (causes layout issues with autoDensity)
    const canvasW = 600;
    const canvasH = 600;

    const ox = (canvasW - BUILDING_W) / 2;
    const groundY = canvasH - GROUND_H;

    // Sky with stars
    this.drawStars(canvasW, groundY - numFloors * FLOOR_H - ROOF_H);

    // Sun/Moon celestial cycle
    this.drawCelestial(canvasW);

    // Ground + sidewalk + door
    this.drawGround(ox, groundY, canvasW);

    // Floors (bottom to top)
    for (let i = 0; i < numFloors; i++) {
      const [name, snap] = list[i];
      const fy = groundY - (i + 1) * FLOOR_H;
      this.drawFloor(ox, fy, name, snap, i);
    }

    // Roof
    if (numFloors > 0) {
      this.drawRoof(ox, groundY - numFloors * FLOOR_H - ROOF_H);
    }

    // Title — always visible
    {
      const cx = canvasW / 2;
      // Always place title in the upper area of the sky
      const roofTop = numFloors > 0
        ? groundY - numFloors * FLOOR_H - ROOF_H
        : canvasH / 2 + 20;
      const titleY = numFloors > 0
        ? Math.min(canvasH * 0.3, Math.max(30, roofTop - 28))
        : canvasH * 0.3;

      // Decorative icons
      const icons = new Text({
        text: "\uD83D\uDC02  \uD83C\uDF3E  \uD83D\uDC02",
        style: new TextStyle({ fontSize: numFloors > 0 ? 20 : 32 }),
      });
      icons.anchor.set(0.5);
      icons.x = cx; icons.y = titleY - (numFloors > 0 ? 28 : 52);
      this.scene.addChild(icons);

      // Main title
      const title = new Text({
        text: "\u6B22\u8FCE\u6765\u5230\u4F60\u7684 AI \u725B\u9A6C\u519C\u573A\uFF5E",
        style: new TextStyle({
          fontFamily: "monospace",
          fontSize: numFloors > 0 ? 16 : 24,
          fill: 0xccaa44,
          letterSpacing: 2,
          dropShadow: { color: 0x665522, distance: 2, angle: Math.PI / 4, blur: 0 },
        }),
      });
      title.anchor.set(0.5);
      title.x = cx; title.y = titleY;
      this.scene.addChild(title);

      // Subtitle
      const sub = new Text({
        text: "Welcome to Your AI Farm",
        style: new TextStyle({
          fontFamily: "monospace",
          fontSize: numFloors > 0 ? 9 : 12,
          fill: 0x555566,
          letterSpacing: 3,
        }),
      });
      sub.anchor.set(0.5);
      sub.x = cx; sub.y = titleY + (numFloors > 0 ? 22 : 30);
      this.scene.addChild(sub);

      // Hint + fence — only when no teams
      if (numFloors === 0) {
        const hint = new Text({
          text: "\u521B\u5EFA\u4E00\u4E2A\u56E2\u961F\u5F00\u59CB\u5DE5\u4F5C\u5427  \u2192  ~/.claude/teams/",
          style: new TextStyle({
            fontFamily: "monospace",
            fontSize: 9,
            fill: 0x3a3a48,
          }),
        });
        hint.anchor.set(0.5);
        hint.x = cx; hint.y = titleY + 54;
        this.scene.addChild(hint);

        const fence = new Text({
          text: "\u2500\u2524\u256C\u251C\u2500\u2500\u2524\u256C\u251C\u2500\u2500\u2524\u256C\u251C\u2500\u2500\u2524\u256C\u251C\u2500",
          style: new TextStyle({
            fontFamily: "monospace",
            fontSize: 10,
            fill: 0x3a3a48,
          }),
        });
        fence.anchor.set(0.5);
        fence.x = cx; fence.y = titleY + 78;
        this.scene.addChild(fence);
      }
    }
  }

  // ── Drawing helpers ──────────────────────────────────────────

  private drawStars(w: number, maxY: number): void {
    const g = new Graphics();
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * w;
      const y = Math.random() * Math.max(50, maxY);
      const bright = Math.random() > 0.7;
      g.circle(x, y, bright ? 1.2 : 0.7)
        .fill({ color: bright ? P.starBright : P.starDim, alpha: 0.2 + Math.random() * 0.6 });
    }
    this.scene.addChild(g);
  }

  private drawGround(ox: number, y: number, w: number): void {
    const g = new Graphics();
    // Grass
    g.rect(0, y + 8, w, GROUND_H).fill({ color: P.ground });
    // Sidewalk
    g.rect(0, y, w, 10).fill({ color: P.sidewalk });
    g.rect(0, y, w, 2).fill({ color: 0xaaaaaa });
    // Door
    const dx = ox + BUILDING_W / 2 - 10;
    g.rect(dx - 2, y - 18, 24, 28).fill({ color: P.doorFrame });
    g.rect(dx, y - 16, 9, 26).fill({ color: P.door });
    g.rect(dx + 11, y - 16, 9, 26).fill({ color: P.door });
    g.circle(dx + 8, y + 2, 1.5).fill({ color: 0xddaa00 }); // knob
    this.scene.addChild(g);
  }

  private drawRoof(ox: number, y: number): void {
    const g = new Graphics();
    // Roof slab
    g.rect(ox - 4, y, BUILDING_W + 8, ROOF_H).fill({ color: P.roofBase });
    g.rect(ox - 4, y, BUILDING_W + 8, 3).fill({ color: P.roofEdge });
    // Ledge
    g.rect(ox - 8, y + ROOF_H - 4, BUILDING_W + 16, 4).fill({ color: P.beam });

    // Antenna
    const ax = ox + BUILDING_W / 2;
    g.rect(ax - 1, y - 20, 2, 20).fill({ color: 0x888888 });
    g.rect(ax - 6, y - 16, 12, 2).fill({ color: 0x888888 });
    g.circle(ax, y - 20, 2.5).fill({ color: 0xff3333 });
    this.scene.addChild(g);

    // Neon sign
    const title = new Text({
      text: "\u514B\u52B3\u5FB7\u5927\u53A6",
      style: new TextStyle({
        fontFamily: "monospace", fontSize: 12, fill: P.neonCyan,
        fontWeight: "bold", letterSpacing: 4,
        dropShadow: { alpha: 0.5, blur: 4, color: P.neonGlow, distance: 0 },
      }),
    });
    title.anchor.set(0.5, 0);
    title.x = ox + BUILDING_W / 2;
    title.y = y + 10;
    this.scene.addChild(title);

    // Slogan — right side of roof bar
    const slogan = new Text({
      text: "\u6C38\u4E0D\u65AD\u7535\uFF0Copus\u6BD2\u836F\u4E0D\u9650\u91CF\u4F9B\u5E94",
      style: new TextStyle({
        fontFamily: "monospace", fontSize: 5, fill: 0xff4444,
        letterSpacing: 0.5,
      }),
    });
    slogan.anchor.set(1, 0.5);
    slogan.x = ox + BUILDING_W - 6;
    slogan.y = y + ROOF_H - 10;
    this.scene.addChild(slogan);
  }

  private drawFloor(ox: number, y: number, name: string, snap: TeamSnapshot, floorIdx: number): void {
    const fc = new Container();
    fc.x = ox; fc.y = y;

    // Background with zone tint
    const zoneTint = ZONE_TINTS[floorIdx % ZONE_TINTS.length];
    const bg = new Graphics();
    bg.rect(WALL_W, 0, FLOOR_INNER_W, FLOOR_H).fill({ color: zoneTint });
    // Darken slightly for depth
    bg.rect(WALL_W, 0, FLOOR_INNER_W, FLOOR_H).fill({ color: 0x000000, alpha: 0.3 });
    fc.addChild(bg);

    // Floor tiles using real textures
    const floorTex = getFloorTexture(floorIdx % 9);
    if (floorTex) {
      for (let tx = 0; tx < Math.ceil(FLOOR_INNER_W / TILE); tx++) {
        const tile = new Sprite(floorTex);
        tile.x = WALL_W + tx * TILE;
        tile.y = FLOOR_H - TILE - 2;
        tile.tint = zoneTint;
        tile.alpha = 0.4;
        fc.addChild(tile);
      }
    }

    // Brick walls (left + right)
    this.drawBrickColumn(fc, 0, 0, WALL_W, FLOOR_H);
    this.drawBrickColumn(fc, FLOOR_INNER_W + WALL_W, 0, WALL_W, FLOOR_H);

    // Steel beam (floor separator)
    const beamG = new Graphics();
    beamG.rect(0, FLOOR_H - 2, BUILDING_W, 3).fill({ color: P.beam });
    beamG.rect(0, FLOOR_H - 2, BUILDING_W, 1).fill({ color: P.beamHi });
    fc.addChild(beamG);

    // Furniture + characters
    const agents = snap.agents;
    const itemCount = Math.max(3, Math.min(6, agents.length + 1));
    const spacing = FLOOR_INNER_W / (itemCount + 1);

    for (let i = 0; i < itemCount; i++) {
      const ix = WALL_W + spacing * (i + 1);

      // Desk
      const deskTex = getFurniture("desk_front");
      if (deskTex) {
        const desk = new Sprite(deskTex);
        desk.anchor.set(0.5, 1);
        desk.x = ix; desk.y = FLOOR_H - 6;
        desk.scale.set(MINI_SCALE);
        fc.addChild(desk);
      }

      // PC on desk
      const pcTex = getFurniture(i < agents.length ? "pc_front_on_1" : "pc_front_off");
      if (pcTex) {
        const pc = new Sprite(pcTex);
        pc.anchor.set(0.5, 1);
        pc.x = ix; pc.y = FLOOR_H - 22;
        pc.scale.set(MINI_SCALE * 0.9);
        fc.addChild(pc);
      }

      // Character sitting at desk
      if (i < agents.length) {
        const agent = agents[i];
        const variant = i % 6;
        const charTex = getCharFrame(variant, "down", 0);
        if (charTex) {
          const ch = new Sprite(charTex);
          ch.anchor.set(0.5, 1);
          ch.x = ix; ch.y = FLOOR_H - 4;
          ch.scale.set(MINI_SCALE * 0.85);
          fc.addChild(ch);
        }

        // Status dot
        const dot = new Graphics();
        dot.circle(ix + 12, FLOOR_H - 38, 3)
          .fill({ color: agent.status === "working" ? 0x44cc44 : agent.status === "idle" ? 0xccaa22 : 0xcc4444 });
        fc.addChild(dot);
      }
    }

    // Decorative plants (edges)
    const plantTex = getFurniture("plant");
    if (plantTex) {
      const p1 = new Sprite(plantTex);
      p1.anchor.set(0.5, 1);
      p1.x = WALL_W + 14; p1.y = FLOOR_H - 4;
      p1.scale.set(MINI_SCALE * 0.7);
      fc.addChild(p1);

      if (FLOOR_INNER_W > 200) {
        const p2 = new Sprite(plantTex);
        p2.anchor.set(0.5, 1);
        p2.x = WALL_W + FLOOR_INNER_W - 14; p2.y = FLOOR_H - 4;
        p2.scale.set(MINI_SCALE * 0.7);
        fc.addChild(p2);
      }
    }

    // Floor label: "3F team-name"
    const floorNum = floorIdx + 1;
    const label = new Text({
      text: `${floorNum}F`,
      style: new TextStyle({ fontFamily: "monospace", fontSize: 10, fill: 0xffffff, fontWeight: "bold" }),
    });
    label.x = WALL_W + 4; label.y = 3;
    fc.addChild(label);

    const nameLabel = new Text({
      text: name,
      style: new TextStyle({ fontFamily: "monospace", fontSize: 9, fill: P.textTeam }),
    });
    nameLabel.x = WALL_W + 24; nameLabel.y = 4;
    fc.addChild(nameLabel);

    // Agent count + status dots
    const statusG = new Graphics();
    for (let i = 0; i < agents.length; i++) {
      const color = agents[i].status === "working" ? P.statusOn : P.textDim;
      statusG.circle(WALL_W + FLOOR_INNER_W - 10 - i * 10, 8, 3).fill({ color });
    }
    fc.addChild(statusG);

    // Click handler
    fc.eventMode = "static";
    fc.cursor = "pointer";
    fc.on("pointerdown", () => this.onFloorClick?.(name));
    fc.on("pointerover", () => {
      bg.clear();
      bg.rect(WALL_W, 0, FLOOR_INNER_W, FLOOR_H).fill({ color: zoneTint });
      bg.rect(WALL_W, 0, FLOOR_INNER_W, FLOOR_H).fill({ color: 0x2244aa, alpha: 0.2 });
    });
    fc.on("pointerout", () => {
      bg.clear();
      bg.rect(WALL_W, 0, FLOOR_INNER_W, FLOOR_H).fill({ color: zoneTint });
      bg.rect(WALL_W, 0, FLOOR_INNER_W, FLOOR_H).fill({ color: 0x000000, alpha: 0.3 });
    });

    this.scene.addChild(fc);
    this.floors.push({ container: fc, teamName: name, bgGraphics: bg });
  }

  private drawBrickColumn(parent: Container, x: number, y: number, w: number, h: number): void {
    const g = new Graphics();
    const bw = 8, bh = 5;
    let row = 0;
    for (let by = y; by < y + h - 2; by += bh) {
      const offset = row % 2 === 0 ? 0 : bw / 2;
      for (let bx = x - offset; bx < x + w + bw; bx += bw) {
        const cx = Math.max(x, bx);
        const cw = Math.min(x + w, bx + bw - 1) - cx;
        if (cw <= 0) continue;
        const colors = [P.brick1, P.brick2, P.brick3];
        const color = colors[(row + Math.floor(bx / bw)) % 3];
        g.rect(cx, by, cw, bh - 1).fill({ color });
      }
      row++;
    }
    parent.addChild(g);
  }

  // ── Celestial day/night cycle ─────────────────────────────────

  private drawCelestial(canvasW: number): void {
    this.celestialContainer = new Container();
    this.scene.addChild(this.celestialContainer);

    // Sun
    this.sunText = new Text({
      text: "\u2600\uFE0F",
      style: new TextStyle({ fontSize: 24 }),
    });
    this.sunText.anchor.set(0.5);
    this.celestialContainer.addChild(this.sunText);

    // Moon
    this.moonText = new Text({
      text: "\uD83C\uDF19",
      style: new TextStyle({ fontSize: 20 }),
    });
    this.moonText.anchor.set(0.5);
    this.celestialContainer.addChild(this.moonText);

    // Position immediately
    this.updateCelestialPositions(canvasW);
  }

  private updateCelestialPositions(canvasW: number): void {
    if (!this.sunText || !this.moonText) return;

    const cx = canvasW / 2;
    const arcW = canvasW * 0.4;  // horizontal range
    const arcH = 80;             // vertical arc height
    const baseY = 120;           // top of arc (pushed down from top edge)

    // Sun: phase 0→1 = left→right across sky, then below horizon
    // Moon: offset by 0.5 (opposite side)
    const sunAngle = this.cyclePhase * Math.PI;
    const moonAngle = ((this.cyclePhase + 0.5) % 1) * Math.PI;

    // Sun position on arc
    this.sunText.x = cx + Math.cos(sunAngle) * arcW;
    this.sunText.y = baseY - Math.sin(sunAngle) * arcH;
    this.sunText.alpha = Math.sin(sunAngle) > 0.05 ? Math.min(1, Math.sin(sunAngle) * 2) : 0;

    // Moon position on arc
    this.moonText.x = cx + Math.cos(moonAngle) * arcW;
    this.moonText.y = baseY - Math.sin(moonAngle) * arcH;
    this.moonText.alpha = Math.sin(moonAngle) > 0.05 ? Math.min(1, Math.sin(moonAngle) * 2) : 0;
  }

  private animateCelestial(): void {
    if (!this.app || !this.celestialContainer) return;

    // Full cycle every ~30 seconds
    this.cyclePhase = (this.cyclePhase + 0.0005) % 1;
    this.updateCelestialPositions(600);
  }

  destroy(): void {
    if (this.app) { this.app.destroy(true); this.app = null; }
  }
}
