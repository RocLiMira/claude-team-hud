import EasyStar from "easystarjs";
import { OFFICE } from "../constants/roles";
import { MEETING_CHAIRS } from "./TilemapLayer";
import type { RoleConfig } from "../constants/roles";

/**
 * A* pathfinding wrapper over easystarjs.
 * Operates in sync mode — findPath resolves immediately after calculate().
 */
export class Pathfinder {
  private easystar: InstanceType<typeof EasyStar.js>;

  constructor() {
    this.easystar = new EasyStar.js();
    this.easystar.enableSync();
    // Only tile value 0 is walkable
    this.easystar.setAcceptableTiles([0]);
  }

  /** Load the walkability grid (0 = walkable, 1 = blocked). */
  initFromGrid(walkabilityGrid: number[][]): void {
    this.easystar.setGrid(walkabilityGrid);
  }

  /**
   * Find a path between two tile coordinates.
   * Returns null if no path exists.
   */
  findPath(
    startX: number,
    startY: number,
    endX: number,
    endY: number
  ): Promise<{ x: number; y: number }[] | null> {
    return new Promise((resolve) => {
      this.easystar.findPath(startX, startY, endX, endY, (path) => {
        console.log(`[Pathfinder] findPath(${startX},${startY} → ${endX},${endY}): ${path ? path.length + ' steps' : 'NO PATH'}`);
        resolve(path ?? null);
      });
      this.easystar.calculate();
    });
  }

  /** Path from any position to the office door.
   *  Uses findPathAllowing so characters can leave from blocked tiles (chairs). */
  pathToDoor(
    fromX: number,
    fromY: number,
    grid: number[][]
  ): Promise<{ x: number; y: number }[] | null> {
    return this.findPathAllowing(fromX, fromY, OFFICE.DOOR_X, OFFICE.DOOR_Y, grid);
  }

  /**
   * Path from any position to a role's CHAIR tile (deskTileY + 2).
   * The character sits on the chair, not on the desk itself.
   * Uses findPathAllowing to temporarily unblock the chair destination.
   */
  pathToDesk(
    fromX: number,
    fromY: number,
    role: RoleConfig,
    grid: number[][]
  ): Promise<{ x: number; y: number }[] | null> {
    return this.findPathAllowing(
      fromX,
      fromY,
      role.deskTileX,
      role.deskTileY + 2,
      grid
    );
  }

  /**
   * Path from any position to a meeting room chair.
   * Uses findPathAllowing since meeting chairs are blocked tiles.
   * @param chairIndex The meetingChairIndex from RoleConfig (0-12).
   */
  pathToMeeting(
    fromX: number,
    fromY: number,
    chairIndex: number,
    grid: number[][]
  ): Promise<{ x: number; y: number }[] | null> {
    const chair = MEETING_CHAIRS[chairIndex];
    if (!chair) return Promise.resolve(null);
    return this.findPathAllowing(fromX, fromY, chair.x, chair.y, grid);
  }

  /**
   * Temporarily mark start and/or end tiles as walkable so a character can
   * path FROM a blocked tile (e.g. leaving a chair) or TO one, then restore.
   */
  async findPathAllowing(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    grid: number[][]
  ): Promise<{ x: number; y: number }[] | null> {
    const prevEnd = grid[endY]?.[endX];
    const prevStart = grid[startY]?.[startX];
    if (prevEnd === undefined || prevStart === undefined) {
      console.warn(`[Pathfinder] findPathAllowing: out-of-bounds start(${startX},${startY}) or end(${endX},${endY})`);
      return null;
    }

    console.log(`[Pathfinder] findPathAllowing(${startX},${startY} → ${endX},${endY}), start was: ${prevStart}, dest was: ${prevEnd}`);

    // Temporarily make start and destination walkable
    grid[startY][startX] = 0;
    grid[endY][endX] = 0;
    this.easystar.setGrid(grid);

    const result = await this.findPath(startX, startY, endX, endY);

    // Restore original values
    grid[startY][startX] = prevStart;
    grid[endY][endX] = prevEnd;
    this.easystar.setGrid(grid);

    return result;
  }
}
