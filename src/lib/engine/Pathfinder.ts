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
        resolve(path ?? null);
      });
      this.easystar.calculate();
    });
  }

  /** Path from any position to the office door. */
  pathToDoor(
    fromX: number,
    fromY: number
  ): Promise<{ x: number; y: number }[] | null> {
    return this.findPath(fromX, fromY, OFFICE.DOOR_X, OFFICE.DOOR_Y);
  }

  /**
   * Path from any position to a role's CHAIR tile (deskTileY + 1).
   * The character sits on the chair, not on the desk itself.
   */
  pathToDesk(
    fromX: number,
    fromY: number,
    role: RoleConfig
  ): Promise<{ x: number; y: number }[] | null> {
    return this.findPath(fromX, fromY, role.deskTileX, role.deskTileY + 1);
  }

  /**
   * Path from any position to a meeting room chair.
   * @param chairIndex The meetingChairIndex from RoleConfig (0-12).
   */
  pathToMeeting(
    fromX: number,
    fromY: number,
    chairIndex: number
  ): Promise<{ x: number; y: number }[] | null> {
    const chair = MEETING_CHAIRS[chairIndex];
    if (!chair) return Promise.resolve(null);
    return this.findPath(fromX, fromY, chair.x, chair.y);
  }

  /**
   * Temporarily mark a tile as walkable so a character can path TO it
   * (e.g. their own chair), then restore its blocked state afterward.
   */
  async findPathAllowing(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    grid: number[][]
  ): Promise<{ x: number; y: number }[] | null> {
    const prev = grid[endY]?.[endX];
    if (prev === undefined) return null;

    // Temporarily make the destination walkable
    grid[endY][endX] = 0;
    this.easystar.setGrid(grid);

    const result = await this.findPath(startX, startY, endX, endY);

    // Restore
    grid[endY][endX] = prev;
    this.easystar.setGrid(grid);

    return result;
  }
}
