/**
 * Centralized asset loader for pixel-art sprite sheets.
 * Loads character, floor, wall, and furniture PNGs via PixiJS Assets.
 */
import { Assets, Texture, Rectangle } from "pixi.js";

// ── Character sprite sheet constants ──────────────────────────────
export const CHAR_FRAME_W = 16;
export const CHAR_FRAME_H = 32;
const CHAR_FRAMES_PER_ROW = 7;
const CHAR_DIRECTIONS = ["down", "up", "right"] as const;
const CHAR_VARIANTS = 6;

// ── Storage ───────────────────────────────────────────────────────
// charFrames[variant][directionIndex][frameIndex]
const charFrames: Texture[][][] = [];
const floorTextures: Texture[] = [];
const wallPieces: Texture[] = [];
const furnitureTextures = new Map<string, Texture>();

let loaded = false;

// ── Loader ────────────────────────────────────────────────────────

export async function loadAllAssets(): Promise<void> {
  if (loaded) return;

  // Characters
  for (let i = 0; i < CHAR_VARIANTS; i++) {
    const tex = await Assets.load<Texture>(`assets/characters/char_${i}.png`);
    const variantFrames: Texture[][] = [];
    for (let dir = 0; dir < CHAR_DIRECTIONS.length; dir++) {
      const dirFrames: Texture[] = [];
      for (let f = 0; f < CHAR_FRAMES_PER_ROW; f++) {
        const frame = new Rectangle(
          f * CHAR_FRAME_W,
          dir * CHAR_FRAME_H,
          CHAR_FRAME_W,
          CHAR_FRAME_H
        );
        dirFrames.push(new Texture({ source: tex.source, frame }));
      }
      variantFrames.push(dirFrames);
    }
    charFrames.push(variantFrames);
  }

  // Floor tiles
  for (let i = 0; i <= 8; i++) {
    try {
      const tex = await Assets.load<Texture>(`assets/floors/floor_${i}.png`);
      floorTextures.push(tex);
    } catch { break; }
  }

  // Wall sprite sheet (4×4 grid of 16×32 pieces)
  try {
    const wallTex = await Assets.load<Texture>("assets/walls/wall_0.png");
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const frame = new Rectangle(col * 16, row * 32, 16, 32);
        wallPieces.push(new Texture({ source: wallTex.source, frame }));
      }
    }
  } catch (e) {
    console.warn("[AssetLoader] Wall sprites not loaded:", e);
  }

  // Furniture
  const items: [string, string][] = [
    ["desk_front", "assets/furniture/DESK/DESK_FRONT.png"],
    ["desk_side", "assets/furniture/DESK/DESK_SIDE.png"],
    ["pc_front_on_1", "assets/furniture/PC/PC_FRONT_ON_1.png"],
    ["pc_front_on_2", "assets/furniture/PC/PC_FRONT_ON_2.png"],
    ["pc_front_on_3", "assets/furniture/PC/PC_FRONT_ON_3.png"],
    ["pc_front_off", "assets/furniture/PC/PC_FRONT_OFF.png"],
    ["pc_side", "assets/furniture/PC/PC_SIDE.png"],
    ["pc_back", "assets/furniture/PC/PC_BACK.png"],
    ["wooden_chair_front", "assets/furniture/WOODEN_CHAIR/WOODEN_CHAIR_FRONT.png"],
    ["wooden_chair_side", "assets/furniture/WOODEN_CHAIR/WOODEN_CHAIR_SIDE.png"],
    ["wooden_chair_back", "assets/furniture/WOODEN_CHAIR/WOODEN_CHAIR_BACK.png"],
    ["plant", "assets/furniture/PLANT/PLANT.png"],
    ["plant_2", "assets/furniture/PLANT_2/PLANT_2.png"],
    ["large_plant", "assets/furniture/LARGE_PLANT/LARGE_PLANT.png"],
    ["bookshelf", "assets/furniture/BOOKSHELF/BOOKSHELF.png"],
    ["double_bookshelf", "assets/furniture/DOUBLE_BOOKSHELF/DOUBLE_BOOKSHELF.png"],
    ["coffee", "assets/furniture/COFFEE/COFFEE.png"],
    ["coffee_table", "assets/furniture/COFFEE_TABLE/COFFEE_TABLE.png"],
    ["whiteboard", "assets/furniture/WHITEBOARD/WHITEBOARD.png"],
    ["sofa_front", "assets/furniture/SOFA/SOFA_FRONT.png"],
    ["sofa_side", "assets/furniture/SOFA/SOFA_SIDE.png"],
    ["sofa_back", "assets/furniture/SOFA/SOFA_BACK.png"],
    ["cactus", "assets/furniture/CACTUS/CACTUS.png"],
    ["bin", "assets/furniture/BIN/BIN.png"],
    ["pot", "assets/furniture/POT/POT.png"],
    ["small_table_front", "assets/furniture/SMALL_TABLE/SMALL_TABLE_FRONT.png"],
    ["small_table_side", "assets/furniture/SMALL_TABLE/SMALL_TABLE_SIDE.png"],
    ["cushioned_chair_front", "assets/furniture/CUSHIONED_CHAIR/CUSHIONED_CHAIR_FRONT.png"],
    ["cushioned_chair_side", "assets/furniture/CUSHIONED_CHAIR/CUSHIONED_CHAIR_SIDE.png"],
    ["cushioned_chair_back", "assets/furniture/CUSHIONED_CHAIR/CUSHIONED_CHAIR_BACK.png"],
    ["large_painting", "assets/furniture/LARGE_PAINTING/LARGE_PAINTING.png"],
    ["small_painting", "assets/furniture/SMALL_PAINTING/SMALL_PAINTING.png"],
    ["small_painting_2", "assets/furniture/SMALL_PAINTING_2/SMALL_PAINTING_2.png"],
    ["hanging_plant", "assets/furniture/HANGING_PLANT/HANGING_PLANT.png"],
    ["clock", "assets/furniture/CLOCK/CLOCK.png"],
    ["table_front", "assets/furniture/TABLE_FRONT/TABLE_FRONT.png"],
    ["cushioned_bench", "assets/furniture/CUSHIONED_BENCH/CUSHIONED_BENCH.png"],
    ["wooden_bench", "assets/furniture/WOODEN_BENCH/WOODEN_BENCH.png"],
  ];

  for (const [id, path] of items) {
    try {
      const tex = await Assets.load<Texture>(path);
      furnitureTextures.set(id, tex);
    } catch { /* skip missing */ }
  }

  loaded = true;
  console.log(
    `[AssetLoader] Loaded: ${charFrames.length} chars, ${floorTextures.length} floors, ` +
    `${wallPieces.length} walls, ${furnitureTextures.size} furniture`
  );
}

// ── Accessors ─────────────────────────────────────────────────────

const DIR_IDX: Record<string, number> = { down: 0, up: 1, right: 2, left: 2 };

export function getCharFrame(variant: number, direction: string, frameIndex: number): Texture | null {
  return charFrames[variant % CHAR_VARIANTS]?.[DIR_IDX[direction] ?? 0]?.[frameIndex] ?? null;
}

export function isCharFacingLeft(direction: string): boolean {
  return direction === "left";
}

export function getFloorTexture(index: number): Texture | null {
  return floorTextures[index] ?? floorTextures[0] ?? null;
}

export function getWallPiece(bitmask: number): Texture | null {
  return wallPieces[bitmask & 0xf] ?? null;
}

export function getFurniture(id: string): Texture | null {
  return furnitureTextures.get(id) ?? null;
}

export function isLoaded(): boolean {
  return loaded;
}
