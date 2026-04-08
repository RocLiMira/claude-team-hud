/**
 * 13 predefined roles from claude-team-harness.
 * Each role has a fixed desk position, color, and sprite config.
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
}

export const ROLES: RoleConfig[] = [
  // Management
  { id: "team-lead", label: "Team Leader", tag: "LEAD", gender: "female", color: "magenta", colorHex: 0xcc2288, layer: "management", model: "opus", deskTileX: 14, deskTileY: 6, meetingChairIndex: 0 },
  // Executive
  { id: "ceo", label: "CEO", tag: "CEO", gender: "male", color: "magenta", colorHex: 0xcc2288, layer: "executive", model: "opus", deskTileX: 3, deskTileY: 3, meetingChairIndex: 1 },
  { id: "cmo", label: "CMO", tag: "CMO", gender: "female", color: "cyan", colorHex: 0x00cccc, layer: "executive", model: "sonnet", deskTileX: 10, deskTileY: 3, meetingChairIndex: 3 },
  { id: "coo", label: "COO", tag: "COO", gender: "male", color: "cyan", colorHex: 0x00bbbb, layer: "executive", model: "sonnet", deskTileX: 3, deskTileY: 7, meetingChairIndex: 4 },
  // Technical
  { id: "cto", label: "CTO", tag: "CTO", gender: "male", color: "blue", colorHex: 0x2266cc, layer: "technical", model: "opus", deskTileX: 3, deskTileY: 13, meetingChairIndex: 2 },
  { id: "ts-architect", label: "TS Architect", tag: "TS-ARCH", gender: "female", color: "blue", colorHex: 0x1a4499, layer: "technical", model: "sonnet", deskTileX: 10, deskTileY: 13, meetingChairIndex: 5 },
  { id: "algorithm-expert", label: "Algorithm Expert", tag: "ALGO", gender: "male", color: "green", colorHex: 0x22aa44, layer: "technical", model: "sonnet", deskTileX: 17, deskTileY: 13, meetingChairIndex: 6 },
  { id: "aws-architect", label: "AWS Architect", tag: "AWS", gender: "female", color: "green", colorHex: 0x28aa55, layer: "technical", model: "sonnet", deskTileX: 3, deskTileY: 17, meetingChairIndex: 7 },
  { id: "mcp-expert", label: "MCP Expert", tag: "MCP", gender: "male", color: "green", colorHex: 0x33bb66, layer: "technical", model: "sonnet", deskTileX: 10, deskTileY: 17, meetingChairIndex: 8 },
  // Execution
  { id: "devops-engineer", label: "DevOps Engineer", tag: "DEVOPS", gender: "female", color: "green", colorHex: 0x44bb44, layer: "execution", model: "sonnet", deskTileX: 3, deskTileY: 22, meetingChairIndex: 9 },
  { id: "qa-engineer", label: "QA Engineer", tag: "QA", gender: "male", color: "yellow", colorHex: 0xccaa22, layer: "execution", model: "sonnet", deskTileX: 10, deskTileY: 22, meetingChairIndex: 10 },
  { id: "security-auditor", label: "Security Auditor", tag: "SEC", gender: "female", color: "red", colorHex: 0xcc2222, layer: "execution", model: "sonnet", deskTileX: 17, deskTileY: 22, meetingChairIndex: 11 },
  { id: "product-manager", label: "Product Manager", tag: "PM", gender: "male", color: "yellow", colorHex: 0xddaa22, layer: "execution", model: "sonnet", deskTileX: 24, deskTileY: 22, meetingChairIndex: 12 },
];

export const ROLE_MAP = new Map(ROLES.map((r) => [r.id, r]));

/** Office layout constants */
export const OFFICE = {
  TILE_SIZE: 16,
  MAP_WIDTH: 40,
  MAP_HEIGHT: 30,
  DOOR_X: 20,
  DOOR_Y: 29,
  MEETING_ROOM: { x: 26, y: 3, width: 12, height: 7 },
} as const;
