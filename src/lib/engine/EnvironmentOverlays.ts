import { Container, Graphics } from "pixi.js";
import { OFFICE, ROLES } from "../constants/roles";

const T = OFFICE.TILE_SIZE;

export interface OverlayLevels {
  fileStackLevel: number;
  coffeeCount: number;
  plantLevel: number;
  trashLevel: number;
}

interface DeskOverlaySet {
  fileStack: Graphics;
  coffee: Graphics;
  plant: Graphics;
  trash: Graphics;
}

/**
 * Environmental storytelling overlays placed around each desk.
 * Each overlay is a simple colored rectangle whose size/color/alpha
 * varies by level (V1 placeholders — replaced with pixel art later).
 */
export class EnvironmentOverlays extends Container {
  private overlays = new Map<string, DeskOverlaySet>();

  constructor() {
    super();
  }

  /** Create overlay Graphics for a specific desk. Call once per role. */
  setupForDesk(roleId: string, deskTileX: number, deskTileY: number): void {
    if (this.overlays.has(roleId)) return;

    const bx = deskTileX * T;
    const by = deskTileY * T;

    const fileStack = new Graphics();
    fileStack.x = bx + 10;
    fileStack.y = by + 2;
    fileStack.visible = false;

    const coffee = new Graphics();
    coffee.x = bx + 1;
    coffee.y = by + 2;
    coffee.visible = false;

    const plant = new Graphics();
    plant.x = bx - 6;
    plant.y = by;
    plant.visible = false;

    const trash = new Graphics();
    trash.x = bx + T + 2;
    trash.y = by + 8;
    trash.visible = false;

    const set: DeskOverlaySet = { fileStack, coffee, plant, trash };
    this.overlays.set(roleId, set);

    this.addChild(fileStack);
    this.addChild(coffee);
    this.addChild(plant);
    this.addChild(trash);
  }

  /** Update overlay visuals for a role's desk based on current levels. */
  updateLevels(roleId: string, levels: OverlayLevels): void {
    const set = this.overlays.get(roleId);
    if (!set) return;

    this.drawFileStack(set.fileStack, levels.fileStackLevel);
    this.drawCoffee(set.coffee, levels.coffeeCount);
    this.drawPlant(set.plant, levels.plantLevel);
    this.drawTrash(set.trash, levels.trashLevel);
  }

  /** Initialize overlays for all 13 roles. */
  setupAll(): void {
    for (const role of ROLES) {
      this.setupForDesk(role.id, role.deskTileX, role.deskTileY);
    }
  }

  // ── Drawing helpers ─────────────────────────────────────────────

  /**
   * File stack: 6px wide, height = level * 2 (0-10px).
   * Yellow-beige paper stack.
   */
  private drawFileStack(g: Graphics, level: number): void {
    g.clear();
    if (level <= 0) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const h = Math.min(level, 5) * 2;
    // Stack of "papers"
    for (let i = 0; i < h; i += 2) {
      const shade = 0xddcc88 - i * 0x050500;
      g.rect(0, -h + i, 6, 2).fill({ color: shade });
    }
    g.rect(0, -h, 6, h).stroke({ width: 1, color: 0xaa9944, alpha: 0.5 });
  }

  /**
   * Coffee cup: 4x5 brown rect with optional steam.
   * Level 0 = hidden, 1-5 = increasing alpha (more cups consumed).
   */
  private drawCoffee(g: Graphics, level: number): void {
    g.clear();
    if (level <= 0) {
      g.visible = false;
      return;
    }
    g.visible = true;
    // Cup body
    g.rect(0, 0, 4, 5)
      .fill({ color: 0x8b5a2b })
      .stroke({ width: 1, color: 0x6b3a1b });
    // Handle
    g.moveTo(4, 1).lineTo(5, 1).lineTo(5, 3).lineTo(4, 3).stroke({
      width: 1,
      color: 0x6b3a1b,
    });

    // Steam lines — more steam with higher level
    const steamAlpha = Math.min(level, 5) * 0.15;
    if (level >= 2) {
      g.moveTo(1, -1)
        .lineTo(1, -3)
        .stroke({ width: 1, color: 0xcccccc, alpha: steamAlpha });
    }
    if (level >= 4) {
      g.moveTo(3, -1)
        .lineTo(3, -3)
        .stroke({ width: 1, color: 0xcccccc, alpha: steamAlpha });
    }
  }

  /**
   * Plant: 5px wide, height = level * 2.
   * Green rectangle. Level 0 = dead grey, 5 = bright green.
   */
  private drawPlant(g: Graphics, level: number): void {
    g.clear();
    if (level <= 0) {
      g.visible = true; // show dead plant as grey
      g.rect(0, 0, 5, 4).fill({ color: 0x444444 });
      // Pot
      g.rect(0, 4, 5, 3)
        .fill({ color: 0x885533 })
        .stroke({ width: 1, color: 0x664422, alpha: 0.5 });
      return;
    }
    g.visible = true;
    const h = Math.min(level, 5) * 2;
    // Green factor ramps from dull to bright
    const greenBase = 0x22 + Math.min(level, 5) * 0x1a;
    const color = (0x00 << 16) | (greenBase << 8) | 0x11;
    // Foliage
    g.rect(0, -h + 4, 5, h).fill({ color });
    // Pot
    g.rect(0, 4, 5, 3)
      .fill({ color: 0x885533 })
      .stroke({ width: 1, color: 0x664422, alpha: 0.5 });
  }

  /**
   * Trash bin: 5x6 dark grey rect.
   * Level 0 = empty (outline only), 1-3 = increasing fill.
   */
  private drawTrash(g: Graphics, level: number): void {
    g.clear();
    g.visible = true;
    // Bin outline
    g.rect(0, 0, 5, 6).stroke({ width: 1, color: 0x666666 });

    if (level >= 1) {
      // Partial fill
      const fillH = Math.min(level, 3) * 2;
      g.rect(0, 6 - fillH, 5, fillH).fill({ color: 0x554433 });
    }
    if (level >= 3) {
      // Overflowing: small piece above
      g.rect(1, -2, 3, 2).fill({ color: 0x776655, alpha: 0.7 });
    }
  }
}
