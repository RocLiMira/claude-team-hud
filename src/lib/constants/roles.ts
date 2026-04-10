/**
 * 13 predefined roles for claude-team-hud.
 * Compact 30×20 office layout with 4 desk rows + right-side break/meeting zones.
 *
 * Workstation layout (each desk):
 *   deskTileY:     desk top row (3 wide)
 *   deskTileY+1:   desk bottom row
 *   deskTileY+2:   chair (character sits here, facing UP)
 */
export interface RoleConfig {
  id: string;
  label: string;
  tag: string;
  gender: "male" | "female";
  color: string;
  colorHex: number;
  layer: "management" | "executive" | "technical" | "execution";
  model: "opus" | "sonnet";
  deskTileX: number;
  deskTileY: number;
  meetingChairIndex: number;
  spriteVariant: number;
}

export const ROLES: RoleConfig[] = [
  // ── Row 1 (deskY=2): Management + Executive ────────────────
  { id: "team-lead",        label: "Team Leader",      tag: "LEAD",    gender: "female", color: "magenta", colorHex: 0xcc2288, layer: "management", model: "opus",   deskTileX: 3,  deskTileY: 2, meetingChairIndex: 0,  spriteVariant: 4 },
  { id: "ceo",              label: "CEO",              tag: "CEO",     gender: "male",   color: "magenta", colorHex: 0xcc2288, layer: "executive",  model: "opus",   deskTileX: 8,  deskTileY: 2, meetingChairIndex: 1,  spriteVariant: 0 },
  { id: "cmo",              label: "CMO",              tag: "CMO",     gender: "female", color: "cyan",    colorHex: 0x00cccc, layer: "executive",  model: "sonnet", deskTileX: 13, deskTileY: 2, meetingChairIndex: 3,  spriteVariant: 3 },
  { id: "coo",              label: "COO",              tag: "COO",     gender: "male",   color: "cyan",    colorHex: 0x00bbbb, layer: "executive",  model: "sonnet", deskTileX: 18, deskTileY: 2, meetingChairIndex: 4,  spriteVariant: 1 },
  // ── Row 2 (deskY=6): Technical ─────────────────────────────
  { id: "cto",              label: "CTO",              tag: "CTO",     gender: "male",   color: "blue",    colorHex: 0x2266cc, layer: "technical",  model: "opus",   deskTileX: 3,  deskTileY: 6, meetingChairIndex: 2,  spriteVariant: 5 },
  { id: "ts-architect",     label: "TS Architect",     tag: "TS-ARCH", gender: "female", color: "blue",    colorHex: 0x1a4499, layer: "technical",  model: "sonnet", deskTileX: 8,  deskTileY: 6, meetingChairIndex: 5,  spriteVariant: 2 },
  { id: "algorithm-expert", label: "Algorithm Expert", tag: "ALGO",    gender: "male",   color: "green",   colorHex: 0x22aa44, layer: "technical",  model: "sonnet", deskTileX: 13, deskTileY: 6, meetingChairIndex: 6,  spriteVariant: 0 },
  // ── Row 3 (deskY=10): Technical + Execution ────────────────
  { id: "aws-architect",    label: "AWS Architect",    tag: "AWS",     gender: "female", color: "green",   colorHex: 0x28aa55, layer: "technical",  model: "sonnet", deskTileX: 3,  deskTileY: 10, meetingChairIndex: 7,  spriteVariant: 3 },
  { id: "mcp-expert",       label: "MCP Expert",       tag: "MCP",     gender: "male",   color: "green",   colorHex: 0x33bb66, layer: "technical",  model: "sonnet", deskTileX: 8,  deskTileY: 10, meetingChairIndex: 8,  spriteVariant: 1 },
  { id: "devops-engineer",  label: "DevOps Engineer",  tag: "DEVOPS",  gender: "female", color: "green",   colorHex: 0x44bb44, layer: "execution",  model: "sonnet", deskTileX: 13, deskTileY: 10, meetingChairIndex: 9,  spriteVariant: 2 },
  // ── Row 4 (deskY=14): Execution ────────────────────────────
  { id: "qa-engineer",      label: "QA Engineer",      tag: "QA",      gender: "male",   color: "yellow",  colorHex: 0xccaa22, layer: "execution",  model: "sonnet", deskTileX: 3,  deskTileY: 14, meetingChairIndex: 10, spriteVariant: 4 },
  { id: "security-auditor", label: "Security Auditor", tag: "SEC",     gender: "female", color: "red",     colorHex: 0xcc2222, layer: "execution",  model: "sonnet", deskTileX: 8,  deskTileY: 14, meetingChairIndex: 11, spriteVariant: 5 },
  { id: "product-manager",  label: "Product Manager",  tag: "PM",      gender: "male",   color: "yellow",  colorHex: 0xddaa22, layer: "execution",  model: "sonnet", deskTileX: 13, deskTileY: 14, meetingChairIndex: 12, spriteVariant: 0 },
];

export const ROLE_MAP = new Map(ROLES.map((r) => [r.id, r]));

/** Office layout constants — 30×20 compact office */
export const OFFICE = {
  TILE_SIZE: 16,
  MAP_WIDTH: 30,
  MAP_HEIGHT: 20,
  DOOR_X: 14,
  DOOR_Y: 19,
  /** Meeting area (open, right side) */
  MEETING_ROOM: { x: 21, y: 7, width: 7, height: 6 },
} as const;

// ── Dynamic role resolver ──────────────────────────────────────
// Assigns desk positions to unknown agent names on-the-fly.

const DYNAMIC_COLORS: { color: string; colorHex: number }[] = [
  { color: "cyan",    colorHex: 0x00cccc },
  { color: "green",   colorHex: 0x22aa44 },
  { color: "blue",    colorHex: 0x2266cc },
  { color: "yellow",  colorHex: 0xccaa22 },
  { color: "magenta", colorHex: 0xcc2288 },
  { color: "red",     colorHex: 0xcc4444 },
];

const dynamicRoles = new Map<string, RoleConfig>();
const usedDeskIndices = new Set<number>();

/** Resolve a role config for any agent name. Matches predefined roles first,
 *  then dynamically assigns an available desk for unknown names. */
export function resolveRole(agentName: string): RoleConfig | null {
  // 1. Exact match in predefined roles
  const predefined = ROLE_MAP.get(agentName);
  if (predefined) {
    // Mark this desk as used so dynamic roles won't take it
    const idx = ROLES.indexOf(predefined);
    if (idx >= 0) usedDeskIndices.add(idx);
    return predefined;
  }

  // 2. Already assigned a dynamic role
  const existing = dynamicRoles.get(agentName);
  if (existing) return existing;

  // 3. Find next available desk slot (not used by predefined match or another dynamic)
  let deskIndex = -1;
  for (let i = 0; i < ROLES.length; i++) {
    if (!usedDeskIndices.has(i)) {
      deskIndex = i;
      break;
    }
  }
  if (deskIndex < 0) return null; // All 13 desks occupied

  usedDeskIndices.add(deskIndex);
  const template = ROLES[deskIndex];
  const colorIdx = dynamicRoles.size % DYNAMIC_COLORS.length;
  const spriteVariant = dynamicRoles.size % 6;

  // Generate a short tag from the name (first 6 chars uppercase)
  const tag = agentName
    .replace(/[^a-zA-Z0-9-]/g, "")
    .slice(0, 6)
    .toUpperCase() || "AGENT";

  const config: RoleConfig = {
    id: agentName,
    label: agentName,
    tag,
    gender: spriteVariant % 2 === 0 ? "male" : "female",
    color: DYNAMIC_COLORS[colorIdx].color,
    colorHex: DYNAMIC_COLORS[colorIdx].colorHex,
    layer: "execution",
    model: "sonnet",
    deskTileX: template.deskTileX,
    deskTileY: template.deskTileY,
    meetingChairIndex: template.meetingChairIndex,
    spriteVariant,
  };

  dynamicRoles.set(agentName, config);
  return config;
}

/** Mark a desk index as used (call when predefined roles are matched). */
export function markDeskUsed(roleId: string): void {
  const idx = ROLES.findIndex((r) => r.id === roleId);
  if (idx >= 0) usedDeskIndices.add(idx);
}

/** Clear all dynamic role assignments (call when team changes). */
export function resetDynamicRoles(): void {
  dynamicRoles.clear();
  usedDeskIndices.clear();
}
