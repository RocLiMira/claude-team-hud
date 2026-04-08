import { Container, Graphics } from "pixi.js";
import { ROLES, OFFICE, type RoleConfig } from "../constants/roles";

// ─── Tile type enum ────────────────────────────────────────────────
export enum TileType {
  FLOOR_EXEC = 0,
  FLOOR_TECH = 1,
  FLOOR_EXEC_ZONE = 2,
  FLOOR_WOOD = 3,
  WALL = 4,
  DESK = 5,
  CHAIR = 6,
  MONITOR_TILE = 7,
  DOOR = 8,
  SERVER_RACK = 9,
  DECORATION = 10,
  SOUTH_WALL = 11,
}

export interface TileData {
  type: TileType;
  walkable: boolean;
  color: number;
  borderColor: number;
  roleId?: string;
}

// ─── Color palette ─────────────────────────────────────────────────
const ZONE_COLORS: Record<string, { fill: number; border: number }> = {
  exec:    { fill: 0x2a1520, border: 0x3a2530 },
  tech:    { fill: 0x1a1a2a, border: 0x2a2a3a },
  execute: { fill: 0x141a2e, border: 0x242a3e },
  wood:    { fill: 0x5c3a1e, border: 0x6c4a2e },
  wall:    { fill: 0x3a3a48, border: 0x4a4a58 },
  south:   { fill: 0x2a2a38, border: 0x3a3a48 },
  door:    { fill: 0x0a0a14, border: 0x666666 },
  chair:   { fill: 0x444444, border: 0x555555 },
  monitor: { fill: 0x111111, border: 0x333333 },
  server:  { fill: 0x1a2a1a, border: 0x2a4a2a },
  decor:   { fill: 0x332244, border: 0x443355 },
};

// ─── Color helpers ──────────────────────────────────────────────────
/** Darken a hex color by a fraction (0-1). */
function darken(color: number, amount: number): number {
  const r = Math.max(0, ((color >> 16) & 0xff) * (1 - amount)) | 0;
  const g = Math.max(0, ((color >> 8) & 0xff) * (1 - amount)) | 0;
  const b = Math.max(0, (color & 0xff) * (1 - amount)) | 0;
  return (r << 16) | (g << 8) | b;
}

function lighten(color: number, amount: number): number {
  const r = Math.min(255, ((color >> 16) & 0xff) + 255 * amount) | 0;
  const g = Math.min(255, ((color >> 8) & 0xff) + 255 * amount) | 0;
  const b = Math.min(255, (color & 0xff) + 255 * amount) | 0;
  return (r << 16) | (g << 8) | b;
}

// Simple seeded pseudo-random for deterministic tile patterns
function tileHash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return (h & 0x7fffffff) / 0x7fffffff; // 0..1
}

// ─── Pre-computed furniture lookup sets ─────────────────────────────
interface FurnitureEntry {
  type: TileType;
  color: number;
  border: number;
  roleId?: string;
}

function buildFurnitureLookup(): Map<string, FurnitureEntry> {
  const map = new Map<string, FurnitureEntry>();
  const key = (x: number, y: number) => `${x},${y}`;

  for (const role of ROLES) {
    const dx = role.deskTileX;
    const dy = role.deskTileY;
    // Desk surface
    map.set(key(dx, dy), {
      type: TileType.DESK,
      color: darken(role.colorHex, 0.4),
      border: role.colorHex,
      roleId: role.id,
    });
    // Monitor (right half of desk)
    map.set(key(dx + 1, dy), {
      type: TileType.MONITOR_TILE,
      color: ZONE_COLORS.monitor.fill,
      border: ZONE_COLORS.monitor.border,
      roleId: role.id,
    });
    // Chair (below desk)
    map.set(key(dx, dy + 1), {
      type: TileType.CHAIR,
      color: ZONE_COLORS.chair.fill,
      border: ZONE_COLORS.chair.border,
      roleId: role.id,
    });
  }

  // Meeting room table: tiles (29,5)-(35,7)
  for (let x = 29; x <= 35; x++) {
    for (let y = 5; y <= 7; y++) {
      if (!map.has(key(x, y))) {
        map.set(key(x, y), {
          type: TileType.DESK,
          color: 0x4a3018,
          border: 0x6a4a28,
        });
      }
    }
  }

  // Server rack at (22,14)-(23,15)
  for (let x = 22; x <= 23; x++) {
    for (let y = 14; y <= 15; y++) {
      map.set(key(x, y), {
        type: TileType.SERVER_RACK,
        color: ZONE_COLORS.server.fill,
        border: ZONE_COLORS.server.border,
      });
    }
  }

  // Break area decoration (22,17)-(23,18)
  for (let x = 22; x <= 23; x++) {
    for (let y = 17; y <= 18; y++) {
      map.set(key(x, y), {
        type: TileType.DECORATION,
        color: ZONE_COLORS.decor.fill,
        border: ZONE_COLORS.decor.border,
      });
    }
  }

  return map;
}

// ─── Meeting room chair positions ───────────────────────────────────
export const MEETING_CHAIRS: { x: number; y: number }[] = [
  { x: 32, y: 4 },  // 0  Team Lead – north center (head of table)
  { x: 29, y: 4 },  // 1  CEO – north left
  { x: 35, y: 4 },  // 2  CTO – north right
  { x: 30, y: 4 },  // 3  CMO – north
  { x: 34, y: 4 },  // 4  COO – north
  { x: 29, y: 8 },  // 5  TS Arch – south left
  { x: 31, y: 8 },  // 6  Algo – south
  { x: 33, y: 8 },  // 7  AWS – south
  { x: 35, y: 8 },  // 8  MCP – south right
  { x: 28, y: 6 },  // 9  DevOps – west
  { x: 36, y: 6 },  // 10 QA – east
  { x: 28, y: 5 },  // 11 Security – west
  { x: 36, y: 5 },  // 12 PM – east
];

// ─── Pixel-art drawing helpers ──────────────────────────────────────
function px(g: Graphics, x: number, y: number, color: number, alpha = 1): void {
  g.rect(x, y, 1, 1).fill({ color, alpha });
}

function pxRow(g: Graphics, x: number, y: number, w: number, color: number, alpha = 1): void {
  g.rect(x, y, w, 1).fill({ color, alpha });
}

function pxBlock(g: Graphics, x: number, y: number, w: number, h: number, color: number, alpha = 1): void {
  g.rect(x, y, w, h).fill({ color, alpha });
}


// ═══════════════════════════════════════════════════════════════════
//  TilemapLayer
// ═══════════════════════════════════════════════════════════════════

export class TilemapLayer extends Container {
  readonly grid: TileData[][] = [];
  readonly walkabilityGrid: number[][] = [];

  /** Floor-level tiles drawn as one big batched Graphics. */
  readonly floorLayer = new Container();
  /** Furniture / walls drawn above the floor. */
  readonly furnitureLayer = new Container();

  private readonly W = OFFICE.MAP_WIDTH;
  private readonly H = OFFICE.MAP_HEIGHT;
  private readonly S = OFFICE.TILE_SIZE;
  private furnitureLookup: Map<string, FurnitureEntry>;

  constructor() {
    super();
    this.furnitureLookup = buildFurnitureLookup();
    this.addChild(this.floorLayer);
    this.addChild(this.furnitureLayer);
  }

  // ── public API ──────────────────────────────────────────────────

  build(): void {
    this.buildGrid();
    this.renderFloor();
    this.renderFurniture();
  }

  getTile(x: number, y: number): TileData | null {
    if (x < 0 || x >= this.W || y < 0 || y >= this.H) return null;
    return this.grid[y][x];
  }

  isWalkable(x: number, y: number): boolean {
    if (x < 0 || x >= this.W || y < 0 || y >= this.H) return false;
    return this.grid[y][x].walkable;
  }

  // ── grid generation ─────────────────────────────────────────────

  private buildGrid(): void {
    const mr = OFFICE.MEETING_ROOM;

    for (let y = 0; y < this.H; y++) {
      const row: TileData[] = [];
      const wRow: number[] = [];

      for (let x = 0; x < this.W; x++) {
        const td = this.classifyTile(x, y, mr);
        row.push(td);
        wRow.push(td.walkable ? 0 : 1);
      }

      this.grid.push(row);
      this.walkabilityGrid.push(wRow);
    }
  }

  private classifyTile(
    x: number,
    y: number,
    mr: typeof OFFICE.MEETING_ROOM
  ): TileData {
    const key = `${x},${y}`;

    // ── walls ────────────────────────────────────────────────────
    const isNorthWall = y === 0;
    const isSouthWall = y === this.H - 1;
    const isWestWall = x === 0;
    const isEastWall = x === this.W - 1;

    if (isNorthWall || isWestWall || isEastWall) {
      return { type: TileType.WALL, walkable: false, color: ZONE_COLORS.wall.fill, borderColor: ZONE_COLORS.wall.border };
    }

    // South wall with door
    if (isSouthWall) {
      if (x === OFFICE.DOOR_X || x === OFFICE.DOOR_X + 1) {
        return { type: TileType.DOOR, walkable: true, color: ZONE_COLORS.door.fill, borderColor: ZONE_COLORS.door.border };
      }
      return { type: TileType.WALL, walkable: false, color: ZONE_COLORS.wall.fill, borderColor: ZONE_COLORS.wall.border };
    }

    // ── meeting room walls (border of the room area) ─────────────
    const inMeetingX = x >= mr.x && x <= mr.x + mr.width;
    const inMeetingY = y >= mr.y && y <= mr.y + mr.height;

    // Meeting room boundary walls
    if (inMeetingX && inMeetingY) {
      const onMRBorderTop = y === mr.y;
      const onMRBorderBottom = y === mr.y + mr.height;
      const onMRBorderLeft = x === mr.x;
      const onMRBorderRight = x === mr.x + mr.width;

      if (onMRBorderTop || onMRBorderBottom || onMRBorderLeft || onMRBorderRight) {
        // Door into meeting room at left wall, middle height
        const doorY = mr.y + Math.floor(mr.height / 2);
        if (onMRBorderLeft && y === doorY) {
          return { type: TileType.DOOR, walkable: true, color: ZONE_COLORS.door.fill, borderColor: ZONE_COLORS.door.border };
        }
        return { type: TileType.WALL, walkable: false, color: ZONE_COLORS.wall.fill, borderColor: ZONE_COLORS.wall.border };
      }
    }

    // ── furniture (desks, chairs, monitors, server rack, etc.) ───
    const furn = this.furnitureLookup.get(key);
    if (furn) {
      return {
        type: furn.type,
        walkable: false,
        color: furn.color,
        borderColor: furn.border,
        roleId: furn.roleId,
      };
    }

    // ── meeting room interior floor ──────────────────────────────
    if (inMeetingX && inMeetingY) {
      return { type: TileType.FLOOR_WOOD, walkable: true, color: ZONE_COLORS.wood.fill, borderColor: ZONE_COLORS.wood.border };
    }

    // ── south wall monitor area (rows 26-28) ─────────────────────
    if (y >= 26 && y <= 28) {
      return { type: TileType.SOUTH_WALL, walkable: true, color: ZONE_COLORS.south.fill, borderColor: ZONE_COLORS.south.border };
    }

    // ── zone floors ──────────────────────────────────────────────
    if (y >= 1 && y <= 10) {
      return { type: TileType.FLOOR_EXEC, walkable: true, color: ZONE_COLORS.exec.fill, borderColor: ZONE_COLORS.exec.border };
    }
    if (y >= 11 && y <= 19) {
      return { type: TileType.FLOOR_TECH, walkable: true, color: ZONE_COLORS.tech.fill, borderColor: ZONE_COLORS.tech.border };
    }
    if (y >= 20 && y <= 25) {
      return { type: TileType.FLOOR_EXEC_ZONE, walkable: true, color: ZONE_COLORS.execute.fill, borderColor: ZONE_COLORS.execute.border };
    }

    // Fallback
    return { type: TileType.WALL, walkable: false, color: ZONE_COLORS.wall.fill, borderColor: ZONE_COLORS.wall.border };
  }

  // ── rendering ───────────────────────────────────────────────────

  /** Draw all floor tiles with pixel-art textures. */
  private renderFloor(): void {
    const g = new Graphics();
    const S = this.S;

    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        const td = this.grid[y][x];
        const isFloor =
          td.type === TileType.FLOOR_EXEC ||
          td.type === TileType.FLOOR_TECH ||
          td.type === TileType.FLOOR_EXEC_ZONE ||
          td.type === TileType.FLOOR_WOOD ||
          td.type === TileType.SOUTH_WALL ||
          td.type === TileType.DOOR;

        if (!isFloor) continue;

        const px0 = x * S;
        const py0 = y * S;

        // Base fill
        g.rect(px0, py0, S, S).fill({ color: td.color });

        switch (td.type) {
          case TileType.FLOOR_EXEC:
            this.drawExecCarpet(g, px0, py0, S, x, y);
            break;
          case TileType.FLOOR_TECH:
            this.drawTechFloor(g, px0, py0, S, x, y);
            break;
          case TileType.FLOOR_EXEC_ZONE:
            this.drawExecZoneCarpet(g, px0, py0, S, x, y);
            break;
          case TileType.FLOOR_WOOD:
            this.drawWoodFloor(g, px0, py0, S, x, y);
            break;
          case TileType.SOUTH_WALL:
            this.drawSouthFloor(g, px0, py0, S, x, y);
            break;
          case TileType.DOOR:
            this.drawDoorFloor(g, px0, py0, S);
            break;
        }
      }
    }

    this.floorLayer.addChild(g);
  }

  /** Executive carpet: dark burgundy with diamond pattern. */
  private drawExecCarpet(g: Graphics, px0: number, py0: number, S: number, tx: number, ty: number): void {
    const hi = 0x3a1828;
    const lo = 0x220e18;
    // Diamond pattern: alternating pixels in a 4x4 repeat
    for (let dy = 0; dy < S; dy += 4) {
      for (let dx = 0; dx < S; dx += 4) {
        // Diamond center
        px(g, px0 + dx + 2, py0 + dy, hi, 0.4);
        px(g, px0 + dx + 1, py0 + dy + 1, hi, 0.3);
        px(g, px0 + dx + 3, py0 + dy + 1, hi, 0.3);
        px(g, px0 + dx, py0 + dy + 2, hi, 0.4);
        px(g, px0 + dx + 2, py0 + dy + 2, lo, 0.3);
        px(g, px0 + dx + 1, py0 + dy + 3, hi, 0.3);
        px(g, px0 + dx + 3, py0 + dy + 3, hi, 0.3);
      }
    }
    // Subtle border
    g.rect(px0, py0, S, S).stroke({ width: 0.5, color: 0x3a2530, alpha: 0.2 });
    // Occasional lighter speckle for carpet texture
    if (tileHash(tx, ty) > 0.7) {
      px(g, px0 + 7, py0 + 7, 0x442030, 0.5);
    }
  }

  /** Technical floor: grey with grid lines. */
  private drawTechFloor(g: Graphics, px0: number, py0: number, S: number, tx: number, ty: number): void {
    // Grid lines every 4 pixels
    for (let dy = 0; dy < S; dy += 4) {
      pxRow(g, px0, py0 + dy, S, 0x222238, 0.4);
    }
    for (let dx = 0; dx < S; dx += 4) {
      pxBlock(g, px0 + dx, py0, 1, S, 0x222238, 0.4);
    }
    // Tile edge highlight (top and left)
    pxRow(g, px0, py0, S, 0x2a2a42, 0.3);
    pxBlock(g, px0, py0, 1, S, 0x2a2a42, 0.3);
    // Random small detail for variation
    if (tileHash(tx, ty) > 0.85) {
      px(g, px0 + 8, py0 + 8, 0x333355, 0.4);
      px(g, px0 + 9, py0 + 8, 0x333355, 0.4);
    }
  }

  /** Execution area: blue-grey carpet with subtle cross pattern. */
  private drawExecZoneCarpet(g: Graphics, px0: number, py0: number, S: number, tx: number, ty: number): void {
    // Subtle cross-hatch pattern
    for (let dy = 0; dy < S; dy += 3) {
      for (let dx = 0; dx < S; dx += 3) {
        px(g, px0 + dx + 1, py0 + dy + 1, 0x1a2238, 0.3);
      }
    }
    // Diagonal accent every other tile
    if ((tx + ty) % 2 === 0) {
      for (let d = 0; d < S; d += 4) {
        px(g, px0 + d, py0 + d, 0x1e2640, 0.3);
      }
    }
    // Carpet edge highlight
    pxRow(g, px0, py0, S, 0x1c2236, 0.25);
  }

  /** Wood floor: horizontal planks with grain. */
  private drawWoodFloor(g: Graphics, px0: number, py0: number, S: number, tx: number, ty: number): void {
    const plankBase = 0x5c3a1e;
    const plankLight = 0x6c4a2e;
    const plankDark = 0x4c2a10;
    const grain = 0x503216;

    // Two horizontal planks per tile
    pxBlock(g, px0, py0, S, 7, plankBase);
    pxRow(g, px0, py0 + 7, S, plankDark, 0.6); // plank gap
    pxBlock(g, px0, py0 + 8, S, 7, plankLight);
    pxRow(g, px0, py0 + 15, S, plankDark, 0.4); // bottom edge

    // Wood grain lines (horizontal, slightly irregular)
    const hash = tileHash(tx, ty);
    const grainY1 = 2 + Math.floor(hash * 3);
    const grainY2 = 10 + Math.floor(hash * 3);
    pxRow(g, px0 + 1, py0 + grainY1, S - 2, grain, 0.35);
    pxRow(g, px0 + 2, py0 + grainY2, S - 4, grain, 0.3);

    // Knot (rare)
    if (hash > 0.88) {
      px(g, px0 + 6 + Math.floor(hash * 4), py0 + 4, plankDark, 0.5);
      px(g, px0 + 7 + Math.floor(hash * 4), py0 + 4, plankDark, 0.4);
    }

    // Stagger plank joints based on row
    if (ty % 2 === 0) {
      pxBlock(g, px0, py0, 1, 7, plankDark, 0.3);
    } else {
      pxBlock(g, px0 + 8, py0 + 8, 1, 7, plankDark, 0.3);
    }
  }

  /** South area floor - slightly different carpet. */
  private drawSouthFloor(g: Graphics, px0: number, py0: number, S: number, tx: number, ty: number): void {
    // Simple dot pattern
    for (let dy = 0; dy < S; dy += 4) {
      for (let dx = 0; dx < S; dx += 4) {
        px(g, px0 + dx + 1, py0 + dy + 1, 0x333348, 0.25);
      }
    }
    if (tileHash(tx, ty) > 0.8) {
      px(g, px0 + 10, py0 + 6, 0x3a3a50, 0.3);
    }
  }

  /** Door floor - dark with threshold markers. */
  private drawDoorFloor(g: Graphics, px0: number, py0: number, S: number): void {
    // Threshold lines
    pxRow(g, px0, py0, S, 0x555555, 0.5);
    pxRow(g, px0, py0 + S - 1, S, 0x555555, 0.5);
    // Center welcome mat hint
    pxBlock(g, px0 + 2, py0 + 4, S - 4, S - 8, 0x443322, 0.3);
  }

  /** Draw walls and furniture into a separate batched Graphics. */
  private renderFurniture(): void {
    const walls = new Graphics();
    const furniture = new Graphics();
    const S = this.S;

    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        const td = this.grid[y][x];
        const px0 = x * S;
        const py0 = y * S;

        switch (td.type) {
          case TileType.WALL:
            this.drawWall(walls, px0, py0, S, x, y, td);
            break;
          case TileType.DESK:
            this.drawDesk(furniture, px0, py0, S, td);
            break;
          case TileType.CHAIR:
            this.drawChair(furniture, px0, py0, S);
            break;
          case TileType.MONITOR_TILE:
            this.drawMonitor(furniture, px0, py0, S, td);
            break;
          case TileType.SERVER_RACK:
            this.drawServerRack(furniture, px0, py0, S);
            break;
          case TileType.DECORATION:
            this.drawDecoration(furniture, px0, py0, S, x, y);
            break;
        }
      }
    }

    this.furnitureLayer.addChild(walls);
    this.furnitureLayer.addChild(furniture);
  }

  // ── Detailed tile renderers ─────────────────────────────────────

  private drawWall(g: Graphics, px0: number, py0: number, S: number, tx: number, ty: number, td: TileData): void {
    const baseColor = td.color;
    const borderColor = td.borderColor;

    // Main wall fill
    g.rect(px0, py0, S, S).fill({ color: baseColor });

    // Brick pattern
    const isOffset = ty % 2 === 0;
    // Horizontal mortar line at midpoint
    pxRow(g, px0, py0 + Math.floor(S / 2), S, darken(baseColor, 0.15), 0.5);
    // Vertical mortar lines (offset per row for brick stagger)
    if (isOffset) {
      pxBlock(g, px0 + Math.floor(S / 2), py0, 1, Math.floor(S / 2), darken(baseColor, 0.15), 0.4);
    } else {
      pxBlock(g, px0, py0 + Math.floor(S / 2), 1, Math.floor(S / 2), darken(baseColor, 0.15), 0.4);
      pxBlock(g, px0 + S - 1, py0 + Math.floor(S / 2), 1, Math.floor(S / 2), darken(baseColor, 0.15), 0.4);
    }

    // Top highlight (light source from top)
    pxRow(g, px0, py0, S, lighten(baseColor, 0.08), 0.5);

    // Baseboard: 2px dark strip at bottom of wall tiles adjacent to floor
    if (ty > 0) {
      const tileBelow = this.grid[ty]?.[tx]; // current tile is the wall
      // Check if south neighbor is walkable (i.e., floor)
      if (ty < this.H - 1) {
        const south = this.grid[ty + 1]?.[tx];
        if (south && south.walkable) {
          pxBlock(g, px0, py0 + S - 3, S, 3, darken(baseColor, 0.3));
          pxRow(g, px0, py0 + S - 3, S, darken(baseColor, 0.15), 0.5);
        }
      }
    }

    // Subtle border
    g.rect(px0, py0, S, S).stroke({ width: 0.5, color: borderColor, alpha: 0.25 });

    // Random brick variation
    if (tileHash(tx, ty) > 0.75) {
      px(g, px0 + 3, py0 + 3, lighten(baseColor, 0.05), 0.4);
    }
  }

  private drawDesk(g: Graphics, px0: number, py0: number, S: number, td: TileData): void {
    const woodBase = 0x6B4226;
    const woodLight = 0x7B5236;
    const woodDark = 0x5B3216;
    const accent = td.borderColor;

    // Desk shadow (3D effect, south and east edges)
    pxBlock(g, px0 + 1, py0 + S - 2, S - 1, 2, darken(woodBase, 0.4));
    pxBlock(g, px0 + S - 2, py0 + 1, 2, S - 2, darken(woodBase, 0.4));

    // Main desk surface
    g.rect(px0 + 1, py0 + 1, S - 3, S - 3).fill({ color: woodBase });

    // Wood grain (horizontal lines)
    for (let dy = 2; dy < S - 3; dy += 3) {
      pxRow(g, px0 + 2, py0 + dy, S - 5, woodLight, 0.4);
    }
    for (let dy = 3; dy < S - 3; dy += 5) {
      pxRow(g, px0 + 3, py0 + dy, S - 7, woodDark, 0.25);
    }

    // Top edge highlight
    pxRow(g, px0 + 1, py0 + 1, S - 3, lighten(woodBase, 0.15), 0.6);

    // Colored accent strip (role color) along front edge
    pxRow(g, px0 + 2, py0 + S - 4, S - 5, accent, 0.5);

    // Small keyboard on desk (dark rectangle with dots)
    pxBlock(g, px0 + 3, py0 + 5, 6, 3, 0x222222, 0.7);
    // Key dots
    for (let kx = 0; kx < 5; kx += 2) {
      for (let ky = 0; ky < 2; ky++) {
        px(g, px0 + 4 + kx, py0 + 6 + ky, 0x444444, 0.6);
      }
    }

    // Mouse (2x1 gray oval)
    pxBlock(g, px0 + 11, py0 + 7, 2, 3, 0x666666, 0.5);
    px(g, px0 + 11, py0 + 7, 0x888888, 0.5);
  }

  private drawChair(g: Graphics, px0: number, py0: number, S: number): void {
    const seatColor = 0x3a3a4a;
    const seatLight = 0x4a4a5a;
    const seatDark = 0x2a2a3a;
    const wheelColor = 0x222222;
    const armColor = 0x333344;

    // Chair base / wheels (5 dots at bottom)
    px(g, px0 + 4, py0 + S - 2, wheelColor);
    px(g, px0 + 8, py0 + S - 2, wheelColor);
    px(g, px0 + 11, py0 + S - 2, wheelColor);
    px(g, px0 + 6, py0 + S - 1, wheelColor);
    px(g, px0 + 10, py0 + S - 1, wheelColor);

    // Chair stem (center pole)
    pxBlock(g, px0 + 7, py0 + S - 4, 2, 3, 0x555555);

    // Seat (rounded rectangle)
    g.roundRect(px0 + 3, py0 + 4, 10, 6, 1).fill({ color: seatColor });
    // Seat highlight
    pxRow(g, px0 + 4, py0 + 4, 8, seatLight, 0.5);
    // Seat cushion detail
    pxRow(g, px0 + 5, py0 + 7, 6, seatDark, 0.4);

    // Back rest (taller behind seat)
    g.roundRect(px0 + 4, py0 + 1, 8, 4, 1).fill({ color: seatColor });
    pxRow(g, px0 + 5, py0 + 1, 6, seatLight, 0.5);
    // Back rest line detail
    pxRow(g, px0 + 5, py0 + 3, 6, seatDark, 0.3);

    // Arm rests
    pxBlock(g, px0 + 2, py0 + 4, 2, 4, armColor, 0.6);
    pxBlock(g, px0 + 12, py0 + 4, 2, 4, armColor, 0.6);
  }

  private drawMonitor(g: Graphics, px0: number, py0: number, S: number, td: TileData): void {
    const bezelColor = 0x222222;
    const screenBg = 0x0a0a1a;

    // Monitor stand (base)
    pxBlock(g, px0 + 5, py0 + S - 3, 6, 2, 0x444444);
    pxBlock(g, px0 + 7, py0 + S - 5, 2, 3, 0x555555);

    // Monitor bezel (outer)
    g.rect(px0 + 2, py0 + 1, S - 4, S - 5).fill({ color: bezelColor });

    // Screen (inner, with glow)
    const screenX = px0 + 3;
    const screenY = py0 + 2;
    const screenW = S - 6;
    const screenH = S - 8;
    g.rect(screenX, screenY, screenW, screenH).fill({ color: screenBg });

    // Screen content: code-like colored lines
    const lineColors = [0x44ff66, 0x6688ff, 0xffaa44, 0x44ff66, 0xcc66ff];
    for (let i = 0; i < Math.min(screenH - 2, 5); i++) {
      const lineW = 3 + Math.floor(tileHash(px0, i) * (screenW - 5));
      pxRow(g, screenX + 1, screenY + 1 + i, lineW, lineColors[i % lineColors.length], 0.6);
    }

    // Screen glow effect (subtle bright border inside)
    g.rect(screenX, screenY, screenW, screenH).stroke({ width: 0.5, color: 0x44ff66, alpha: 0.15 });

    // Power LED
    px(g, px0 + S - 4, py0 + S - 4, 0x22cc44);

    // Bezel brand dot
    px(g, px0 + S / 2, py0 + S - 4, 0x666666, 0.5);
  }

  private drawServerRack(g: Graphics, px0: number, py0: number, S: number): void {
    const rackColor = 0x1a2a1a;
    const rackFrame = 0x2a3a2a;

    // Rack frame
    g.rect(px0, py0, S, S).fill({ color: rackColor });
    g.rect(px0, py0, S, S).stroke({ width: 1, color: rackFrame });

    // Internal rack lines (horizontal server slots)
    for (let dy = 2; dy < S - 2; dy += 3) {
      pxRow(g, px0 + 2, py0 + dy, S - 4, 0x0a1a0a, 0.6);
      pxRow(g, px0 + 2, py0 + dy + 1, S - 4, 0x1e2e1e, 0.4);
    }

    // LED indicators (green and red dots in rows)
    for (let i = 0; i < 4; i++) {
      const ledY = py0 + 3 + i * 3;
      // Green active LED
      px(g, px0 + 3, ledY, 0x22ff44);
      // Amber warning LED
      px(g, px0 + 5, ledY, i % 3 === 0 ? 0xff4422 : 0x22cc44);
      // Blue network LED
      px(g, px0 + 7, ledY, 0x2266ff);
    }

    // Ventilation holes on right side
    for (let dy = 3; dy < S - 3; dy += 2) {
      px(g, px0 + S - 3, py0 + dy, 0x0a1a0a, 0.5);
      px(g, px0 + S - 4, py0 + dy, 0x0a1a0a, 0.3);
    }

    // Top screw details
    px(g, px0 + 1, py0 + 1, 0x555555, 0.5);
    px(g, px0 + S - 2, py0 + 1, 0x555555, 0.5);
  }

  private drawDecoration(g: Graphics, px0: number, py0: number, S: number, tx: number, ty: number): void {
    // Decide between plant, coffee machine based on position
    if (ty === 17) {
      this.drawPlant(g, px0, py0, S);
    } else {
      this.drawCoffeeMachine(g, px0, py0, S);
    }
  }

  private drawPlant(g: Graphics, px0: number, py0: number, S: number): void {
    // Brown pot
    const potColor = 0x8B4513;
    const potDark = 0x6B3010;
    // Pot body (trapezoid-ish)
    pxBlock(g, px0 + 4, py0 + S - 5, 8, 4, potColor);
    pxBlock(g, px0 + 5, py0 + S - 6, 6, 1, potColor);
    // Pot rim
    pxRow(g, px0 + 3, py0 + S - 6, 10, lighten(potColor, 0.15));
    // Pot shadow
    pxRow(g, px0 + 4, py0 + S - 1, 8, potDark, 0.5);
    // Soil
    pxRow(g, px0 + 5, py0 + S - 5, 6, 0x3a2a1a);

    // Green foliage (irregular pattern)
    const leaf1 = 0x228833;
    const leaf2 = 0x33aa44;
    const leaf3 = 0x44cc55;
    // Central bush
    pxBlock(g, px0 + 5, py0 + 3, 6, 5, leaf1);
    pxBlock(g, px0 + 6, py0 + 2, 4, 2, leaf2);
    // Stray leaves
    px(g, px0 + 3, py0 + 4, leaf2);
    px(g, px0 + 4, py0 + 3, leaf3);
    px(g, px0 + 11, py0 + 4, leaf2);
    px(g, px0 + 12, py0 + 5, leaf1);
    px(g, px0 + 4, py0 + 6, leaf1);
    px(g, px0 + 11, py0 + 3, leaf3);
    // Highlights
    px(g, px0 + 7, py0 + 2, leaf3);
    px(g, px0 + 9, py0 + 3, leaf3);
    // Stem visible
    px(g, px0 + 7, py0 + 7, 0x557733);
    px(g, px0 + 8, py0 + 8, 0x557733);
  }

  private drawCoffeeMachine(g: Graphics, px0: number, py0: number, S: number): void {
    const bodyColor = 0x555566;
    const bodyDark = 0x444455;
    const bodyLight = 0x666677;

    // Machine body
    pxBlock(g, px0 + 3, py0 + 3, 10, 10, bodyColor);
    // Top
    pxRow(g, px0 + 3, py0 + 3, 10, bodyLight, 0.6);
    // Right shadow
    pxBlock(g, px0 + 12, py0 + 4, 1, 9, bodyDark, 0.5);
    // Bottom shadow
    pxRow(g, px0 + 3, py0 + 13, 10, bodyDark, 0.5);

    // Drip area (dark recess)
    pxBlock(g, px0 + 5, py0 + 8, 6, 4, 0x222233);

    // Cup (tiny)
    pxBlock(g, px0 + 6, py0 + 10, 4, 2, 0xeeeeee);
    px(g, px0 + 6, py0 + 10, 0xcccccc);

    // Coffee in cup
    pxRow(g, px0 + 7, py0 + 10, 2, 0x553311);

    // Buttons
    px(g, px0 + 4, py0 + 5, 0x44cc44); // green power
    px(g, px0 + 4, py0 + 7, 0xcc4444); // red

    // Display (tiny LED)
    pxBlock(g, px0 + 6, py0 + 4, 4, 2, 0x112211);
    pxRow(g, px0 + 6, py0 + 4, 3, 0x44ff66, 0.5);

    // Steam (3 small pixels above)
    px(g, px0 + 7, py0 + 1, 0xaaaaaa, 0.3);
    px(g, px0 + 9, py0 + 2, 0xaaaaaa, 0.2);
    px(g, px0 + 6, py0 + 2, 0xaaaaaa, 0.25);
  }
}
