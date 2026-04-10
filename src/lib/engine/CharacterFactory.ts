import { OFFICE, resolveRole, markDeskUsed } from "../constants/roles";
import type { RoleConfig } from "../constants/roles";
import type { AgentState } from "../state/agents";
import { Character } from "./Character";

/**
 * Factory for creating Character instances from role definitions.
 */
export class CharacterFactory {
  /** Create a Character from a RoleConfig. Starts at the door in "entering" state. */
  static create(roleConfig: RoleConfig): Character {
    const char = new Character(roleConfig);
    char.tileX = OFFICE.DOOR_X;
    char.tileY = OFFICE.DOOR_Y;
    char.pixelX = OFFICE.DOOR_X * OFFICE.TILE_SIZE + OFFICE.TILE_SIZE / 2;
    char.pixelY = OFFICE.DOOR_Y * OFFICE.TILE_SIZE + OFFICE.TILE_SIZE / 2;
    // Sync visual position immediately (don't wait for first update())
    char.x = char.pixelX;
    char.y = char.pixelY;
    char.setState("entering");
    return char;
  }

  /**
   * Create a Character from an AgentState (looks up role in ROLE_MAP).
   * Returns null if the role is not recognized.
   */
  static createFromAgent(agent: AgentState): Character | null {
    const roleConfig = resolveRole(agent.role);
    if (!roleConfig) {
      console.warn(
        `[CharacterFactory] No desk available for "${agent.role}" (all 13 desks occupied)`
      );
      return null;
    }
    markDeskUsed(agent.role);

    const char = CharacterFactory.create(roleConfig);

    // Apply initial status
    const statusMap: Record<string, "working" | "idle" | "blocked" | "offline"> = {
      working: "working",
      idle: "idle",
      blocked: "blocked",
      offline: "offline",
    };
    const indicatorStatus = statusMap[agent.status] ?? "idle";
    char.setStatus(indicatorStatus);

    return char;
  }

  /** Door spawn position in tile coordinates. */
  static getSpawnPosition(): { x: number; y: number } {
    return { x: OFFICE.DOOR_X, y: OFFICE.DOOR_Y };
  }
}
