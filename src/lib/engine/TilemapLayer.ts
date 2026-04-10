/**
 * Rich office tilemap — 30×20 grid.
 *
 * Layout overview:
 *   y=0:     North wall
 *   y=1:     Wall decorations (paintings, bookshelves, clock, hanging plants)
 *   y=2-4:   Desk row 1 (4 desks) — exec zone          | Right: break area
 *   y=5:     Corridor                                    |   (sofa, coffee, cooler)
 *   y=6-8:   Desk row 2 (3 desks) — tech zone           |
 *   y=9:     Corridor                                    | Right: meeting area
 *   y=10-12: Desk row 3 (3 desks) — tech/exec zone      |   (large table, whiteboard)
 *   y=13:    Corridor                                    |
 *   y=14-16: Desk row 4 (3 desks) — execution zone      | Right: server + bookshelf
 *   y=17-18: South area                                  |
 *   y=19:    South wall + door
 *
 * Each workstation: desk at (x-1,y)-(x+1,y+1), chair at (x,y+2)
 * Character sits on chair tile (deskTileY+2), facing up.
 */
import { Container, Graphics, Sprite } from "pixi.js";
import { ROLES, OFFICE } from "../constants/roles";
import { getFloorTexture, getWallPiece, getFurniture } from "./AssetLoader";

export enum TileType { FLOOR, WALL, DOOR, FURNITURE }
export interface TileData { type: TileType; walkable: boolean; }

// ─── Meeting chairs (around table at x=23-25, y=9-11) ────────
export const MEETING_CHAIRS: { x: number; y: number }[] = [
  { x: 23, y: 8 },  // 0  TL — north of table
  { x: 25, y: 8 },  // 1  CEO
  { x: 22, y: 9 },  // 2  CTO — west
  { x: 24, y: 8 },  // 3  CMO
  { x: 26, y: 9 },  // 4  COO — east
  { x: 22, y: 10 }, // 5  TS
  { x: 26, y: 10 }, // 6  ALGO
  { x: 22, y: 11 }, // 7  AWS
  { x: 26, y: 11 }, // 8  MCP
  { x: 23, y: 12 }, // 9  DEV — south
  { x: 24, y: 12 }, // 10 QA
  { x: 25, y: 12 }, // 11 SEC
  { x: 26, y: 12 }, // 12 PM
];

// ─── Zone tints ───────────────────────────────────────────────
const TINT = {
  exec:    0x7755bb, // purple
  tech:    0x4477bb, // blue
  execute: 0x447755, // green
  meeting: 0xbb9944, // warm
  break_:  0x886655, // cozy brown
  south:   0x555577, // muted
  corridor:0x555566,
};

// ─── Furniture definitions ────────────────────────────────────
interface Furn { id: string; tx: number; ty: number; tw: number; th: number; }

function buildAllFurniture(): Furn[] {
  const f: Furn[] = [];

  // ══ Per-role workstations ═══════════════════════════════════
  for (const r of ROLES) {
    const dx = r.deskTileX, dy = r.deskTileY;
    f.push({ id: "desk_front",          tx: dx - 1, ty: dy,     tw: 3, th: 2 });
    f.push({ id: "pc_front_on_1",       tx: dx,     ty: dy,     tw: 1, th: 2 });
    f.push({ id: "wooden_chair_front",  tx: dx,     ty: dy + 2, tw: 1, th: 1 });
  }

  // ══ North wall decorations (y=0-1) ═════════════════════════
  f.push({ id: "large_painting",   tx: 1,  ty: 0, tw: 2, th: 2 });
  f.push({ id: "double_bookshelf", tx: 4,  ty: 0, tw: 2, th: 2 });
  f.push({ id: "clock",            tx: 7,  ty: 0, tw: 1, th: 2 });
  f.push({ id: "small_painting",   tx: 9,  ty: 0, tw: 1, th: 2 });
  f.push({ id: "double_bookshelf", tx: 11, ty: 0, tw: 2, th: 2 });
  f.push({ id: "small_painting_2", tx: 14, ty: 0, tw: 1, th: 2 });
  f.push({ id: "bookshelf",        tx: 16, ty: 0, tw: 2, th: 2 });
  f.push({ id: "hanging_plant",    tx: 19, ty: 0, tw: 1, th: 2 });
  // Right side north wall
  f.push({ id: "large_painting",   tx: 22, ty: 0, tw: 2, th: 2 });
  f.push({ id: "double_bookshelf", tx: 25, ty: 0, tw: 2, th: 2 });
  f.push({ id: "hanging_plant",    tx: 28, ty: 0, tw: 1, th: 2 });

  // ══ Break area (right side, y=2-5) ═════════════════════════
  f.push({ id: "sofa_front",       tx: 22, ty: 2, tw: 2, th: 1 });
  f.push({ id: "coffee_table",     tx: 22, ty: 3, tw: 2, th: 2 });
  f.push({ id: "coffee",           tx: 23, ty: 3, tw: 1, th: 1 }); // on table
  f.push({ id: "sofa_back",        tx: 22, ty: 5, tw: 2, th: 1 });
  f.push({ id: "cushioned_chair_front", tx: 24, ty: 3, tw: 1, th: 1 });
  f.push({ id: "cushioned_chair_front", tx: 24, ty: 5, tw: 1, th: 1 });
  // Water cooler / snack area
  f.push({ id: "small_table_front", tx: 26, ty: 2, tw: 2, th: 2 });
  f.push({ id: "coffee",            tx: 26, ty: 2, tw: 1, th: 1 }); // drinks
  f.push({ id: "pot",               tx: 27, ty: 4, tw: 1, th: 1 }); // snack bowl
  f.push({ id: "bin",               tx: 28, ty: 5, tw: 1, th: 1 });

  // ══ Meeting area (right side, y=7-13) ══════════════════════
  // Whiteboard on divider wall
  f.push({ id: "whiteboard",       tx: 22, ty: 6, tw: 2, th: 2 });
  // Large meeting table
  f.push({ id: "table_front",      tx: 23, ty: 9, tw: 3, th: 2 });
  // Chairs around meeting table
  f.push({ id: "wooden_chair_back", tx: 23, ty: 8,  tw: 1, th: 1 });
  f.push({ id: "wooden_chair_back", tx: 25, ty: 8,  tw: 1, th: 1 });
  f.push({ id: "wooden_chair_front",tx: 23, ty: 11, tw: 1, th: 1 });
  f.push({ id: "wooden_chair_front",tx: 25, ty: 11, tw: 1, th: 1 });
  f.push({ id: "wooden_chair_side", tx: 22, ty: 9,  tw: 1, th: 1 });
  f.push({ id: "wooden_chair_side", tx: 26, ty: 9,  tw: 1, th: 1 });
  f.push({ id: "wooden_chair_side", tx: 22, ty: 10, tw: 1, th: 1 });
  f.push({ id: "wooden_chair_side", tx: 26, ty: 10, tw: 1, th: 1 });

  // ══ Server + bookshelf area (right bottom, y=14-17) ════════
  f.push({ id: "pc_back",          tx: 27, ty: 14, tw: 1, th: 2 });
  f.push({ id: "pc_back",          tx: 28, ty: 14, tw: 1, th: 2 });
  f.push({ id: "double_bookshelf", tx: 22, ty: 14, tw: 2, th: 2 });
  f.push({ id: "bookshelf",        tx: 25, ty: 14, tw: 2, th: 2 });
  f.push({ id: "small_table_front", tx: 22, ty: 16, tw: 2, th: 2 });
  f.push({ id: "coffee",           tx: 22, ty: 16, tw: 1, th: 1 });

  // ══ Corridor decorations ═══════════════════════════════════
  // Row 1→2 corridor (y=5)
  f.push({ id: "plant",   tx: 1,  ty: 4,  tw: 1, th: 2 });
  f.push({ id: "bin",     tx: 6,  ty: 5,  tw: 1, th: 1 });
  f.push({ id: "cactus",  tx: 11, ty: 4,  tw: 1, th: 2 });
  f.push({ id: "plant_2", tx: 16, ty: 4,  tw: 1, th: 2 });
  f.push({ id: "bin",     tx: 19, ty: 5,  tw: 1, th: 1 });
  // Row 2→3 corridor (y=9)
  f.push({ id: "plant_2", tx: 1,  ty: 8,  tw: 1, th: 2 });
  f.push({ id: "pot",     tx: 6,  ty: 9,  tw: 1, th: 1 });
  f.push({ id: "plant",   tx: 16, ty: 8,  tw: 1, th: 2 });
  f.push({ id: "bin",     tx: 19, ty: 9,  tw: 1, th: 1 });
  // Row 3→4 corridor (y=13)
  f.push({ id: "cactus",  tx: 1,  ty: 12, tw: 1, th: 2 });
  f.push({ id: "bin",     tx: 6,  ty: 13, tw: 1, th: 1 });
  f.push({ id: "plant_2", tx: 11, ty: 12, tw: 1, th: 2 });
  f.push({ id: "plant",   tx: 16, ty: 12, tw: 1, th: 2 });
  f.push({ id: "pot",     tx: 19, ty: 13, tw: 1, th: 1 });

  // ══ Corner large plants ════════════════════════════════════
  f.push({ id: "large_plant", tx: 20, ty: 1,  tw: 1, th: 2 });
  f.push({ id: "large_plant", tx: 28, ty: 12, tw: 1, th: 2 });
  f.push({ id: "plant",       tx: 20, ty: 17, tw: 1, th: 2 });
  f.push({ id: "plant_2",     tx: 28, ty: 17, tw: 1, th: 2 });

  // ══ South area decorations (y=17-18) ═══════════════════════
  f.push({ id: "cushioned_bench", tx: 5,  ty: 17, tw: 1, th: 1 });
  f.push({ id: "cushioned_bench", tx: 6,  ty: 17, tw: 1, th: 1 });
  f.push({ id: "plant",           tx: 1,  ty: 17, tw: 1, th: 2 });
  f.push({ id: "small_painting",  tx: 10, ty: 17, tw: 1, th: 2 });

  return f;
}

// ─── Blocked tiles ────────────────────────────────────────────
function buildBlockedSet(): Set<string> {
  const s = new Set<string>();
  const k = (x: number, y: number) => `${x},${y}`;

  // Per-role desk + chair blocks
  for (const r of ROLES) {
    const dx = r.deskTileX, dy = r.deskTileY;
    s.add(k(dx-1, dy)); s.add(k(dx, dy)); s.add(k(dx+1, dy));     // desk top
    s.add(k(dx-1, dy+1)); s.add(k(dx, dy+1)); s.add(k(dx+1, dy+1)); // desk bottom
    s.add(k(dx, dy+2));                                               // chair
  }

  // Break area
  for (const [x,y] of [
    [22,2],[23,2],           // sofa front
    [22,3],[23,3],[24,3],    // coffee table + chair
    [22,4],[23,4],           // coffee table bottom
    [24,5],[22,5],[23,5],    // sofa back + chair
    [26,2],[27,2],[26,3],[27,3], // snack table
    [27,4],[28,5],           // pot + bin
  ]) s.add(k(x, y));

  // Meeting area
  for (const [x,y] of [
    [22,6],[23,6],           // whiteboard
    [23,8],[25,8],           // chairs north
    [22,9],[23,9],[24,9],[25,9],[26,9],   // table + chairs
    [22,10],[23,10],[24,10],[25,10],[26,10], // table + chairs
    [23,11],[25,11],         // chairs south
    [22,11],[26,11],
  ]) s.add(k(x, y));

  // Server + bookshelf area
  for (const [x,y] of [
    [27,14],[28,14],[27,15],[28,15],  // servers
    [22,14],[23,14],[22,15],[23,15],  // bookshelves
    [25,14],[26,14],[25,15],[26,15],  // bookshelf
    [22,16],[23,16],[22,17],[23,17],  // table
  ]) s.add(k(x, y));

  // Corridor decorations (plants, bins, pots)
  for (const [x,y] of [
    [1,4],[1,5],[11,4],[11,5],[16,4],[16,5],[6,5],[19,5],     // corridor 1
    [1,8],[1,9],[16,8],[16,9],[6,9],[19,9],                     // corridor 2
    [1,12],[1,13],[11,12],[11,13],[16,12],[16,13],[6,13],[19,13], // corridor 3
  ]) s.add(k(x, y));

  // Large plants
  for (const [x,y] of [
    [20,1],[20,2],[28,12],[28,13],[20,17],[20,18],[28,17],[28,18],
  ]) s.add(k(x, y));

  // South decorations
  for (const [x,y] of [[5,17],[6,17],[1,17],[1,18],[10,17],[10,18]]) s.add(k(x, y));

  return s;
}

// ═══════════════════════════════════════════════════════════════

export class TilemapLayer extends Container {
  readonly grid: TileData[][] = [];
  readonly walkabilityGrid: number[][] = [];
  readonly floorLayer = new Container();
  readonly furnitureLayer = new Container();

  private readonly W = OFFICE.MAP_WIDTH;
  private readonly H = OFFICE.MAP_HEIGHT;
  private readonly S = OFFICE.TILE_SIZE;
  private blockedSet: Set<string>;

  constructor() {
    super();
    this.blockedSet = buildBlockedSet();
    this.addChild(this.floorLayer);
    this.addChild(this.furnitureLayer);
  }

  build(): void {
    this.buildGrid();
    this.renderFloor();
    this.renderWalls();
    this.renderFurniture();
  }

  private buildGrid(): void {
    for (let y = 0; y < this.H; y++) {
      const row: TileData[] = [];
      const wRow: number[] = [];
      for (let x = 0; x < this.W; x++) {
        const td = this.classify(x, y);
        row.push(td);
        wRow.push(td.walkable ? 0 : 1);
      }
      this.grid.push(row);
      this.walkabilityGrid.push(wRow);
    }
  }

  private classify(x: number, y: number): TileData {
    if (y === 0 || x === 0 || x === this.W - 1)
      return { type: TileType.WALL, walkable: false };
    if (y === this.H - 1) {
      if (x === OFFICE.DOOR_X || x === OFFICE.DOOR_X + 1)
        return { type: TileType.DOOR, walkable: true };
      return { type: TileType.WALL, walkable: false };
    }
    if (this.blockedSet.has(`${x},${y}`))
      return { type: TileType.FURNITURE, walkable: false };
    return { type: TileType.FLOOR, walkable: true };
  }

  // ── Floor rendering ────────────────────────────────────────

  private renderFloor(): void {
    const S = this.S;
    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        if (this.grid[y][x].type === TileType.WALL) continue;
        const tex = getFloorTexture(this.floorPat(x, y));
        if (!tex) continue;
        const sp = new Sprite(tex);
        sp.x = x * S; sp.y = y * S;
        sp.width = S; sp.height = S;
        sp.tint = this.zoneTint(x, y);
        this.floorLayer.addChild(sp);
      }
    }
  }

  private floorPat(x: number, y: number): number {
    const mr = OFFICE.MEETING_ROOM;
    if (x >= mr.x && x <= mr.x + mr.width && y >= mr.y && y <= mr.y + mr.height) return 3;
    if (x >= 21 && y >= 2 && y <= 5) return 5;  // break area
    if (y >= 1 && y <= 4) return 1;
    if (y >= 5 && y <= 8) return 2;
    if (y >= 9 && y <= 12) return 4;
    if (y >= 13 && y <= 16) return 1;
    return 0;
  }

  private zoneTint(x: number, y: number): number {
    const mr = OFFICE.MEETING_ROOM;
    if (x >= mr.x && x <= mr.x + mr.width && y >= mr.y && y <= mr.y + mr.height) return TINT.meeting;
    if (x >= 21 && y >= 2 && y <= 5) return TINT.break_;
    if (y >= 1 && y <= 4) return TINT.exec;
    if (y >= 5 && y <= 8) return TINT.tech;
    if (y >= 9 && y <= 12) return TINT.execute;
    if (y >= 13 && y <= 16) return TINT.exec;
    if (y === 5 || y === 9 || y === 13) return TINT.corridor;
    return TINT.south;
  }

  // ── Wall rendering ─────────────────────────────────────────

  private renderWalls(): void {
    const S = this.S;
    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        if (this.grid[y][x].type !== TileType.WALL) continue;
        const mask = this.wallMask(x, y);
        const tex = getWallPiece(mask);
        if (tex) {
          const sp = new Sprite(tex);
          sp.x = x * S; sp.y = y * S - S;
          sp.width = S; sp.height = S * 2;
          sp.tint = 0xaaaacc;
          this.floorLayer.addChild(sp);
        } else {
          const g = new Graphics();
          g.rect(x * S, y * S, S, S).fill({ color: 0x3a3a48 });
          this.floorLayer.addChild(g);
        }
      }
    }
  }

  private wallMask(x: number, y: number): number {
    let m = 0;
    if (this.isWallTile(x, y-1)) m |= 1;
    if (this.isWallTile(x+1, y)) m |= 2;
    if (this.isWallTile(x, y+1)) m |= 4;
    if (this.isWallTile(x-1, y)) m |= 8;
    return m;
  }

  private isWallTile(x: number, y: number): boolean {
    if (x < 0 || x >= this.W || y < 0 || y >= this.H) return true;
    return this.grid[y][x].type === TileType.WALL;
  }

  // ── Furniture rendering ────────────────────────────────────

  private renderFurniture(): void {
    const S = this.S;
    for (const f of buildAllFurniture()) {
      const tex = getFurniture(f.id);
      if (!tex) continue;
      const sp = new Sprite(tex);
      sp.x = f.tx * S;
      sp.y = f.ty * S;
      sp.width = f.tw * S;
      sp.height = f.th * S;
      this.furnitureLayer.addChild(sp);
    }
  }

  // ── Public API ─────────────────────────────────────────────
  getTile(x: number, y: number): TileData | null {
    if (x < 0 || x >= this.W || y < 0 || y >= this.H) return null;
    return this.grid[y][x];
  }
  isWalkable(x: number, y: number): boolean {
    if (x < 0 || x >= this.W || y < 0 || y >= this.H) return false;
    return this.grid[y][x].walkable;
  }
}
