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

/** Darken a hex color by a fraction (0-1). */
function darken(color: number, amount: number): number {
  const r = Math.max(0, ((color >> 16) & 0xff) * (1 - amount)) | 0;
  const g = Math.max(0, ((color >> 8) & 0xff) * (1 - amount)) | 0;
  const b = Math.max(0, (color & 0xff) * (1 - amount)) | 0;
  return (r << 16) | (g << 8) | b;
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

  /** Draw all floor tiles into one batched Graphics object per zone. */
  private renderFloor(): void {
    const g = new Graphics();

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

        if (isFloor) {
          const px = x * this.S;
          const py = y * this.S;
          g.rect(px, py, this.S, this.S)
            .fill({ color: td.color })
            .stroke({ width: 1, color: td.borderColor, alpha: 0.3 });
        }
      }
    }

    this.floorLayer.addChild(g);
  }

  /** Draw walls and furniture into a separate batched Graphics. */
  private renderFurniture(): void {
    const walls = new Graphics();
    const furniture = new Graphics();

    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        const td = this.grid[y][x];
        const px = x * this.S;
        const py = y * this.S;

        switch (td.type) {
          case TileType.WALL:
            walls
              .rect(px, py, this.S, this.S)
              .fill({ color: td.color })
              .stroke({ width: 1, color: td.borderColor, alpha: 0.5 });
            // Brick-like detail: horizontal line at midpoint
            walls
              .moveTo(px, py + this.S / 2)
              .lineTo(px + this.S, py + this.S / 2)
              .stroke({ width: 1, color: td.borderColor, alpha: 0.25 });
            break;

          case TileType.DESK:
            furniture
              .rect(px + 1, py + 1, this.S - 2, this.S - 2)
              .fill({ color: td.color })
              .stroke({ width: 1, color: td.borderColor });
            break;

          case TileType.CHAIR:
            // Small rounded square
            furniture
              .roundRect(px + 3, py + 3, this.S - 6, this.S - 6, 2)
              .fill({ color: td.color })
              .stroke({ width: 1, color: td.borderColor });
            break;

          case TileType.MONITOR_TILE:
            // Dark screen with bright border
            furniture
              .rect(px + 2, py + 2, this.S - 4, this.S - 4)
              .fill({ color: td.color })
              .stroke({ width: 1, color: 0x44ff66, alpha: 0.6 });
            // Small green dot (power LED)
            furniture
              .circle(px + this.S - 4, py + this.S - 4, 1)
              .fill({ color: 0x22cc44 });
            break;

          case TileType.SERVER_RACK:
            furniture
              .rect(px, py, this.S, this.S)
              .fill({ color: td.color })
              .stroke({ width: 1, color: td.borderColor });
            // Blinking LED row
            for (let i = 0; i < 3; i++) {
              furniture
                .circle(px + 4 + i * 4, py + this.S / 2, 1)
                .fill({ color: 0x22cc44 });
            }
            break;

          case TileType.DECORATION:
            furniture
              .rect(px + 2, py + 2, this.S - 4, this.S - 4)
              .fill({ color: td.color })
              .stroke({ width: 1, color: td.borderColor, alpha: 0.5 });
            break;
        }
      }
    }

    this.furnitureLayer.addChild(walls);
    this.furnitureLayer.addChild(furniture);
  }
}
