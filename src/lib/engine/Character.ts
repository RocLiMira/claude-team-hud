import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { OFFICE, type RoleConfig } from "../constants/roles";
import { StatusIndicator, type IndicatorStatus } from "./StatusIndicator";
import { SpeechBubble } from "./SpeechBubble";

// ─── Constants ──────────────────────────────────────────────────────
const TILE = OFFICE.TILE_SIZE;
const WALK_SPEED = 1; // pixels per frame
const IDLE_BOB_CYCLE = 60; // frames for one full idle bob cycle
const WALK_BOB_CYCLE = 8; // frames for one walk bob cycle

// Character sprite dimensions (SNES-style 32x32 logical, drawn at ~16x24 actual)
const SPRITE_W = 16;
const SPRITE_H = 24;
const SHADOW_W = 10;
const SHADOW_H = 3;

export type CharacterState =
  | "idle"
  | "walking"
  | "meeting"
  | "talking"
  | "entering"
  | "leaving"
  | "blocked";

// ─── Color helpers ──────────────────────────────────────────────────

/** Lighten a color by blending toward white. */
function lighten(color: number, amount: number): number {
  const r = Math.min(255, ((color >> 16) & 0xff) + 255 * amount) | 0;
  const g = Math.min(255, ((color >> 8) & 0xff) + 255 * amount) | 0;
  const b = Math.min(255, (color & 0xff) + 255 * amount) | 0;
  return (r << 16) | (g << 8) | b;
}

function darken(color: number, amount: number): number {
  const r = Math.max(0, ((color >> 16) & 0xff) * (1 - amount)) | 0;
  const g = Math.max(0, ((color >> 8) & 0xff) * (1 - amount)) | 0;
  const b = Math.max(0, (color & 0xff) * (1 - amount)) | 0;
  return (r << 16) | (g << 8) | b;
}

// ─── Skin/hair palette ──────────────────────────────────────────────
const SKIN_TONES = [0xffe0bd, 0xf5c7a1, 0xe8b88a, 0xd4a574, 0xc09060];
const SKIN_SHADOW = [0xe0c0a0, 0xd4a880, 0xc89868, 0xb88050, 0xa07848];

// ─── Per-role appearance config ─────────────────────────────────────
interface RoleAppearance {
  skinIndex: number;
  hairColor: number;
  hairStyle: "short" | "spiky" | "neat" | "long" | "ponytail" | "pixie" | "curly" | "bun";
  shirtColor: number;
  shirtHighlight: number;
  shirtShadow: number;
  collarColor: number;
  pantsColor: number;
  pantsHighlight: number;
  shoeColor: number;
  accessory?: "tie" | "glasses" | "thick-glasses" | "visor" | "hoodie-hood" | "gear-print";
  accessoryColor?: number;
  vestColor?: number;
}

function getRoleAppearance(roleConfig: RoleConfig): RoleAppearance {
  const id = roleConfig.id;
  switch (id) {
    case "team-lead": // F, magenta blazer, white blouse
      return {
        skinIndex: 1, hairColor: 0x8B4513, hairStyle: "long",
        shirtColor: 0xcc2288, shirtHighlight: 0xdd44aa, shirtShadow: 0xaa1166,
        collarColor: 0xffffff, pantsColor: 0x222244, pantsHighlight: 0x333355,
        shoeColor: 0x111122,
      };
    case "ceo": // M, dark suit, magenta tie
      return {
        skinIndex: 0, hairColor: 0x222222, hairStyle: "neat",
        shirtColor: 0x1a1a2e, shirtHighlight: 0x2a2a3e, shirtShadow: 0x101020,
        collarColor: 0xffffff, pantsColor: 0x1a1a2e, pantsHighlight: 0x2a2a3e,
        shoeColor: 0x111111,
        accessory: "tie", accessoryColor: 0xcc2288,
      };
    case "cmo": // F, cyan jacket, turtleneck
      return {
        skinIndex: 2, hairColor: 0x553300, hairStyle: "bun",
        shirtColor: 0x00bbcc, shirtHighlight: 0x22ddee, shirtShadow: 0x009999,
        collarColor: 0x008888, pantsColor: 0x333333, pantsHighlight: 0x444444,
        shoeColor: 0x222222,
      };
    case "coo": // M, cyan vest, grey shirt
      return {
        skinIndex: 0, hairColor: 0x443322, hairStyle: "short",
        shirtColor: 0x888899, shirtHighlight: 0x9999aa, shirtShadow: 0x666677,
        collarColor: 0x888899, pantsColor: 0x444455, pantsHighlight: 0x555566,
        shoeColor: 0x222222,
        vestColor: 0x00aaaa,
      };
    case "cto": // M, blue hoodie
      return {
        skinIndex: 1, hairColor: 0x332211, hairStyle: "spiky",
        shirtColor: 0x2266cc, shirtHighlight: 0x3388dd, shirtShadow: 0x1144aa,
        collarColor: 0x2266cc, pantsColor: 0x333355, pantsHighlight: 0x444466,
        shoeColor: 0x222233,
        accessory: "hoodie-hood", accessoryColor: 0x2266cc,
      };
    case "ts-architect": // F, navy button-down, round glasses
      return {
        skinIndex: 3, hairColor: 0x111133, hairStyle: "ponytail",
        shirtColor: 0x1a2244, shirtHighlight: 0x2a3355, shirtShadow: 0x101833,
        collarColor: 0x2a3355, pantsColor: 0x222233, pantsHighlight: 0x333344,
        shoeColor: 0x111122,
        accessory: "glasses", accessoryColor: 0x888899,
      };
    case "algorithm-expert": // M, green argyle vest, wild curly hair, thick glasses
      return {
        skinIndex: 0, hairColor: 0x553311, hairStyle: "curly",
        shirtColor: 0xddddcc, shirtHighlight: 0xeeeedd, shirtShadow: 0xbbbbaa,
        collarColor: 0xccccbb, pantsColor: 0x444433, pantsHighlight: 0x555544,
        shoeColor: 0x332211,
        vestColor: 0x22aa44, accessory: "thick-glasses", accessoryColor: 0x444444,
      };
    case "aws-architect": // F, green utility jacket, ponytail
      return {
        skinIndex: 2, hairColor: 0x882211, hairStyle: "ponytail",
        shirtColor: 0x338844, shirtHighlight: 0x44aa55, shirtShadow: 0x226633,
        collarColor: 0x44aa55, pantsColor: 0x444444, pantsHighlight: 0x555555,
        shoeColor: 0x332211,
      };
    case "mcp-expert": // M, green henley
      return {
        skinIndex: 1, hairColor: 0x222222, hairStyle: "short",
        shirtColor: 0x33bb66, shirtHighlight: 0x44cc77, shirtShadow: 0x229944,
        collarColor: 0x33bb66, pantsColor: 0x333344, pantsHighlight: 0x444455,
        shoeColor: 0x222222,
      };
    case "devops-engineer": // F, green tee with gear print, pixie cut
      return {
        skinIndex: 3, hairColor: 0xcc4422, hairStyle: "pixie",
        shirtColor: 0x44bb44, shirtHighlight: 0x55cc55, shirtShadow: 0x339933,
        collarColor: 0x44bb44, pantsColor: 0x333344, pantsHighlight: 0x444455,
        shoeColor: 0x222222,
        accessory: "gear-print", accessoryColor: 0xdddddd,
      };
    case "qa-engineer": // M, yellow polo
      return {
        skinIndex: 0, hairColor: 0x443322, hairStyle: "neat",
        shirtColor: 0xccaa22, shirtHighlight: 0xddbb44, shirtShadow: 0xaa8800,
        collarColor: 0xddbb44, pantsColor: 0x334455, pantsHighlight: 0x445566,
        shoeColor: 0x222222,
      };
    case "security-auditor": // F, red-accented black jacket, dark visor
      return {
        skinIndex: 1, hairColor: 0x111111, hairStyle: "long",
        shirtColor: 0x222222, shirtHighlight: 0x333333, shirtShadow: 0x111111,
        collarColor: 0xcc2222, pantsColor: 0x1a1a1a, pantsHighlight: 0x2a2a2a,
        shoeColor: 0x111111,
        accessory: "visor", accessoryColor: 0x222266,
      };
    case "product-manager": // M, yellow cardigan
      return {
        skinIndex: 2, hairColor: 0x332211, hairStyle: "neat",
        shirtColor: 0xddaa22, shirtHighlight: 0xeebb44, shirtShadow: 0xbb8800,
        collarColor: 0xeebb44, pantsColor: 0x333344, pantsHighlight: 0x444455,
        shoeColor: 0x222222,
      };
    default:
      return {
        skinIndex: 0, hairColor: 0x553311, hairStyle: "short",
        shirtColor: roleConfig.colorHex, shirtHighlight: lighten(roleConfig.colorHex, 0.15),
        shirtShadow: darken(roleConfig.colorHex, 0.2),
        collarColor: 0xcccccc, pantsColor: 0x333355, pantsHighlight: 0x444466,
        shoeColor: 0x222222,
      };
  }
}

// ─── Pixel drawing helpers ──────────────────────────────────────────
// These draw individual pixels at character-local coordinates.

function px(g: Graphics, x: number, y: number, color: number, alpha = 1): void {
  g.rect(x, y, 1, 1).fill({ color, alpha });
}

function pxRow(g: Graphics, x: number, y: number, w: number, color: number, alpha = 1): void {
  g.rect(x, y, w, 1).fill({ color, alpha });
}

function pxBlock(g: Graphics, x: number, y: number, w: number, h: number, color: number, alpha = 1): void {
  g.rect(x, y, w, h).fill({ color, alpha });
}

/**
 * Animated character with state machine.
 * Renders as a detailed SNES-style pixel art sprite.
 */
export class Character extends Container {
  readonly roleId: string;
  readonly roleConfig: RoleConfig;
  state: CharacterState = "idle";

  // Tile position (integer grid coords)
  tileX: number;
  tileY: number;

  // Pixel position (sub-tile, used for smooth interpolation)
  pixelX: number;
  pixelY: number;

  // Path data
  private path: { x: number; y: number }[] | null = null;
  private pathIndex = 0;

  // Visual parts
  private shadow: Graphics;
  private body: Graphics;
  private head: Graphics;
  private accessory: Graphics;
  private nameTag: Text;
  readonly statusIndicator: StatusIndicator;
  private speechBubble: SpeechBubble | null = null;

  // Appearance
  private appearance: RoleAppearance;

  private frameAge = 0;
  private lastDrawnFrame = -1;

  /** Called when the character finishes leaving (reaches door). */
  onLeaveComplete: (() => void) | null = null;

  constructor(roleConfig: RoleConfig) {
    super();
    this.roleConfig = roleConfig;
    this.roleId = roleConfig.id;
    this.appearance = getRoleAppearance(roleConfig);

    // Default position at door
    this.tileX = OFFICE.DOOR_X;
    this.tileY = OFFICE.DOOR_Y;
    this.pixelX = this.tileX * TILE + TILE / 2;
    this.pixelY = this.tileY * TILE + TILE / 2;

    // Build visual children (order matters for z)
    this.shadow = new Graphics();
    this.body = new Graphics();
    this.head = new Graphics();
    this.accessory = new Graphics();
    this.statusIndicator = new StatusIndicator();

    this.nameTag = new Text({
      text: roleConfig.tag,
      style: new TextStyle({
        fontFamily: "monospace",
        fontSize: 6,
        fill: 0xcccccc,
        letterSpacing: 0,
      }),
    });

    this.buildSprite(0);

    // Add children in draw order (bottom to top)
    this.addChild(this.shadow);
    this.addChild(this.body);
    this.addChild(this.accessory);
    this.addChild(this.head);
    this.addChild(this.statusIndicator);
    this.addChild(this.nameTag);

    // Initial placement
    this.x = this.pixelX;
    this.y = this.pixelY;
  }

  // ── State transitions ───────────────────────────────────────────

  setState(newState: CharacterState): void {
    if (newState === this.state) return;
    this.state = newState;
    this.frameAge = 0;

    // Side effects
    switch (newState) {
      case "blocked":
        this.statusIndicator.setStatus("blocked");
        break;
      case "idle":
      case "meeting":
        this.statusIndicator.setStatus("working");
        break;
      case "talking":
        this.statusIndicator.setStatus("working");
        break;
    }
  }

  setPath(path: { x: number; y: number }[] | null): void {
    if (!path || path.length === 0) {
      this.path = null;
      return;
    }
    this.path = path;
    this.pathIndex = 0;
    // Don't override state if leaving — keep leaving
    if (this.state !== "leaving") {
      this.setState("walking");
    }
  }

  setStatus(status: IndicatorStatus): void {
    this.statusIndicator.setStatus(status);
    if (status === "blocked" && this.state === "idle") {
      this.setState("blocked");
    } else if (status !== "blocked" && this.state === "blocked") {
      this.setState("idle");
    }
  }

  showSpeech(text: string): void {
    // Remove existing bubble
    if (this.speechBubble) {
      this.removeChild(this.speechBubble);
      this.speechBubble.destroy();
    }
    this.speechBubble = new SpeechBubble(text);
    // Position above head
    this.speechBubble.x = 0;
    this.speechBubble.y = -(SPRITE_H + 8);
    this.addChild(this.speechBubble);

    if (this.state === "idle") {
      this.setState("talking");
    }
  }

  // ── Per-frame update ────────────────────────────────────────────

  update(frameCount: number): void {
    this.frameAge++;

    // Update speech bubble
    if (this.speechBubble) {
      this.speechBubble.update(frameCount);
      if (this.speechBubble.isDone()) {
        this.removeChild(this.speechBubble);
        this.speechBubble.destroy();
        this.speechBubble = null;
        if (this.state === "talking") {
          this.setState("idle");
        }
      }
    }

    // Status indicator pulse
    this.statusIndicator.update(frameCount);

    // Movement
    if (
      this.state === "walking" ||
      this.state === "entering" ||
      this.state === "leaving"
    ) {
      this.interpolateMovement();
    }

    // Animations
    this.updateAnimation(frameCount);

    // Sync container position to pixel coords
    this.x = Math.round(this.pixelX);
    this.y = Math.round(this.pixelY);
  }

  // ── Visual construction (SNES-style pixel art) ──────────────────

  private buildSprite(frameCount: number, walkFrame = 0): void {
    const a = this.appearance;
    const skin = SKIN_TONES[a.skinIndex];
    const skinShade = SKIN_SHADOW[a.skinIndex];

    // ── Shadow ──
    this.shadow.clear();
    this.shadow
      .ellipse(0, 0, SHADOW_W / 2, SHADOW_H / 2)
      .fill({ color: 0x000000, alpha: 0.3 });
    this.shadow.y = 0;

    // ── Body graphic (torso + legs + arms) ──
    this.body.clear();
    const bx = -SPRITE_W / 2; // left edge
    const by = -SPRITE_H + 6;  // top of body, offset so feet at y=0

    // === TORSO (12w x 10h) centered ===
    const tx = bx + 2;  // torso starts 2px in from sprite left
    const tw = 12;
    const ty = by + 0;  // torso top
    const th = 10;

    // Main torso fill
    pxBlock(this.body, tx, ty, tw, th, a.shirtColor);
    // Highlight on left side
    pxBlock(this.body, tx, ty, 1, th, a.shirtHighlight);
    pxBlock(this.body, tx + 1, ty, 1, th - 2, a.shirtHighlight);
    // Shadow on right side
    pxBlock(this.body, tx + tw - 1, ty, 1, th, a.shirtShadow);
    pxBlock(this.body, tx + tw - 2, ty + 2, 1, th - 2, a.shirtShadow);

    // Collar (2px high at top of torso)
    pxBlock(this.body, tx + 2, ty, tw - 4, 2, a.collarColor);
    // Collar notch (V-shape hint)
    px(this.body, tx + 5, ty + 1, darken(a.collarColor, 0.2));
    px(this.body, tx + 6, ty + 1, darken(a.collarColor, 0.2));

    // Sleeves (arms) - 2px wide, hang from shoulder
    const sleeveLen = 6;
    // Left arm
    pxBlock(this.body, tx - 2, ty + 1, 2, sleeveLen, a.shirtColor);
    px(this.body, tx - 2, ty + 1, a.shirtHighlight);
    // Left hand
    px(this.body, tx - 2, ty + 1 + sleeveLen, skin);
    px(this.body, tx - 1, ty + 1 + sleeveLen, skinShade);
    // Right arm
    pxBlock(this.body, tx + tw, ty + 1, 2, sleeveLen, a.shirtColor);
    px(this.body, tx + tw + 1, ty + 1, a.shirtShadow);
    // Right hand
    px(this.body, tx + tw, ty + 1 + sleeveLen, skin);
    px(this.body, tx + tw + 1, ty + 1 + sleeveLen, skinShade);

    // Vest overlay (COO, Algorithm Expert)
    if (a.vestColor) {
      pxBlock(this.body, tx + 2, ty + 2, tw - 4, th - 3, a.vestColor);
      // Argyle pattern for algorithm expert
      if (this.roleId === "algorithm-expert") {
        for (let dy = 0; dy < th - 4; dy += 3) {
          for (let dx = 0; dx < tw - 6; dx += 3) {
            px(this.body, tx + 3 + dx, ty + 3 + dy, lighten(a.vestColor, 0.15));
          }
        }
      }
      // Highlight edge
      pxBlock(this.body, tx + 2, ty + 2, 1, th - 3, lighten(a.vestColor, 0.2));
    }

    // Tie (CEO)
    if (a.accessory === "tie" && a.accessoryColor) {
      px(this.body, tx + 5, ty + 2, a.accessoryColor);
      px(this.body, tx + 6, ty + 2, a.accessoryColor);
      pxBlock(this.body, tx + 5, ty + 3, 2, 5, a.accessoryColor);
      px(this.body, tx + 5, ty + 8, darken(a.accessoryColor, 0.2));
      px(this.body, tx + 6, ty + 8, darken(a.accessoryColor, 0.2));
    }

    // Gear print (DevOps)
    if (a.accessory === "gear-print" && a.accessoryColor) {
      // Small gear icon on chest
      px(this.body, tx + 5, ty + 4, a.accessoryColor);
      px(this.body, tx + 6, ty + 4, a.accessoryColor);
      px(this.body, tx + 4, ty + 5, a.accessoryColor);
      px(this.body, tx + 7, ty + 5, a.accessoryColor);
      px(this.body, tx + 5, ty + 6, a.accessoryColor);
      px(this.body, tx + 6, ty + 6, a.accessoryColor);
    }

    // Hoodie hood drawstrings (CTO)
    if (a.accessory === "hoodie-hood" && a.accessoryColor) {
      px(this.body, tx + 4, ty + 2, 0xdddddd);
      px(this.body, tx + 4, ty + 3, 0xdddddd);
      px(this.body, tx + 7, ty + 2, 0xdddddd);
      px(this.body, tx + 7, ty + 3, 0xdddddd);
    }

    // Security red accent stripes
    if (this.roleId === "security-auditor") {
      pxRow(this.body, tx, ty + 3, tw, 0xcc2222);
      pxRow(this.body, tx, ty + th - 1, tw, 0xcc2222);
    }

    // PM cardigan open-front look
    if (this.roleId === "product-manager") {
      // Inner shirt visible
      pxBlock(this.body, tx + 4, ty + 2, 4, th - 3, 0xeeeeee);
      // Button dots
      px(this.body, tx + 3, ty + 3, 0x888866);
      px(this.body, tx + 3, ty + 5, 0x888866);
      px(this.body, tx + 3, ty + 7, 0x888866);
    }

    // QA polo collar detail
    if (this.roleId === "qa-engineer") {
      px(this.body, tx + 3, ty, lighten(a.collarColor, 0.1));
      px(this.body, tx + 8, ty, lighten(a.collarColor, 0.1));
      // Polo buttons
      px(this.body, tx + 5, ty + 2, 0x888866);
      px(this.body, tx + 5, ty + 3, 0x888866);
    }

    // === LEGS (walking animation) ===
    const ly = ty + th; // leg top y
    const legH = 6;
    const legW = 4;
    const legGap = 1;

    // Two-frame walk cycle
    const isWalking = this.state === "walking" || this.state === "entering" || this.state === "leaving";

    if (isWalking) {
      if (walkFrame === 0) {
        // Left leg forward
        pxBlock(this.body, tx + 1, ly, legW, legH, a.pantsColor);
        px(this.body, tx + 1, ly, a.pantsHighlight);
        // Left shoe
        pxBlock(this.body, tx + 0, ly + legH, legW + 1, 2, a.shoeColor);
        // Right leg back
        pxBlock(this.body, tx + legW + legGap + 1, ly, legW, legH - 1, a.pantsColor);
        px(this.body, tx + legW + legGap + 1, ly, a.pantsHighlight);
        pxBlock(this.body, tx + legW + legGap + 1, ly + legH - 1, legW, 2, a.shoeColor);
      } else {
        // Right leg forward
        pxBlock(this.body, tx + legW + legGap + 1, ly, legW, legH, a.pantsColor);
        px(this.body, tx + legW + legGap + 1, ly, a.pantsHighlight);
        pxBlock(this.body, tx + legW + legGap + 1, ly + legH, legW + 1, 2, a.shoeColor);
        // Left leg back
        pxBlock(this.body, tx + 1, ly, legW, legH - 1, a.pantsColor);
        px(this.body, tx + 1, ly, a.pantsHighlight);
        pxBlock(this.body, tx + 1, ly + legH - 1, legW, 2, a.shoeColor);
      }
    } else {
      // Standing still - legs together
      // Left leg
      pxBlock(this.body, tx + 1, ly, legW, legH, a.pantsColor);
      px(this.body, tx + 1, ly, a.pantsHighlight);
      // Left shoe
      pxBlock(this.body, tx + 0, ly + legH, legW + 1, 2, a.shoeColor);
      // Right leg
      pxBlock(this.body, tx + legW + legGap + 1, ly, legW, legH, a.pantsColor);
      px(this.body, tx + legW + legGap + 1, ly, a.pantsHighlight);
      // Right shoe
      pxBlock(this.body, tx + legW + legGap + 1, ly + legH, legW + 1, 2, a.shoeColor);
    }

    // Belt line
    pxRow(this.body, tx + 1, ly, tw - 2, darken(a.pantsColor, 0.3));

    // ── Head graphic ──
    this.head.clear();
    const hx = bx + 3; // head left
    const hw = 10;
    const hh = 10;
    const hy = by - hh + 1; // head above body

    // Neck
    pxBlock(this.head, hx + 3, by - 1, 4, 2, skin);

    // Head oval shape (10x10, rounded corners)
    // Row 0 (top)
    pxRow(this.head, hx + 2, hy, 6, skin);
    // Row 1
    pxRow(this.head, hx + 1, hy + 1, 8, skin);
    // Rows 2-7 (full width)
    pxBlock(this.head, hx, hy + 2, hw, 6, skin);
    // Row 8
    pxRow(this.head, hx + 1, hy + 8, 8, skin);
    // Row 9 (bottom/chin)
    pxRow(this.head, hx + 2, hy + 9, 6, skinShade);

    // Face shadow (right side)
    pxBlock(this.head, hx + hw - 1, hy + 3, 1, 4, skinShade);

    // Eyes (2 dark pixels)
    px(this.head, hx + 3, hy + 4, 0x111122);
    px(this.head, hx + 6, hy + 4, 0x111122);
    // Eye highlights
    px(this.head, hx + 3, hy + 3, 0xffffff);
    px(this.head, hx + 6, hy + 3, 0xffffff);

    // Mouth
    px(this.head, hx + 4, hy + 7, 0xcc8877);
    px(this.head, hx + 5, hy + 7, 0xcc8877);

    // ── Hair (drawn on top of head shape) ──
    this.drawHair(this.head, hx, hy, hw, hh, a);

    // ── Accessory ──
    this.accessory.clear();

    if (a.accessory === "glasses" && a.accessoryColor) {
      // Round glasses
      this.accessory
        .circle(hx + 3, hy + 4, 1.5)
        .stroke({ width: 0.5, color: a.accessoryColor })
        .circle(hx + 6, hy + 4, 1.5)
        .stroke({ width: 0.5, color: a.accessoryColor });
      // Bridge
      pxRow(this.accessory, hx + 4, hy + 4, 2, a.accessoryColor);
    }

    if (a.accessory === "thick-glasses" && a.accessoryColor) {
      // Thick square glasses
      pxBlock(this.accessory, hx + 2, hy + 3, 3, 3, 0x000000);
      pxBlock(this.accessory, hx + 5, hy + 3, 3, 3, 0x000000);
      // Lens (lighter inner)
      px(this.accessory, hx + 3, hy + 4, 0x99bbcc);
      px(this.accessory, hx + 6, hy + 4, 0x99bbcc);
      // Bridge
      px(this.accessory, hx + 4, hy + 4, a.accessoryColor);
    }

    if (a.accessory === "visor" && a.accessoryColor) {
      // Dark visor across eyes
      pxBlock(this.accessory, hx + 1, hy + 3, 8, 2, a.accessoryColor);
      // Visor glint
      px(this.accessory, hx + 2, hy + 3, lighten(a.accessoryColor, 0.3));
    }

    // Hoodie hood behind head (CTO)
    if (a.accessory === "hoodie-hood" && a.accessoryColor) {
      // Hood outline behind head
      pxRow(this.accessory, hx - 1, hy - 1, hw + 2, darken(a.accessoryColor, 0.2));
      px(this.accessory, hx - 1, hy, darken(a.accessoryColor, 0.2));
      px(this.accessory, hx + hw, hy, darken(a.accessoryColor, 0.2));
    }

    // Status indicator position (above head)
    this.statusIndicator.x = 0;
    this.statusIndicator.y = hy - 4;

    // Name tag (below feet)
    this.nameTag.anchor.set(0.5, 0);
    this.nameTag.x = 0;
    this.nameTag.y = 3;
  }

  private drawHair(g: Graphics, hx: number, hy: number, hw: number, _hh: number, a: RoleAppearance): void {
    const c = a.hairColor;
    const hi = lighten(c, 0.15);

    switch (a.hairStyle) {
      case "short":
        // Short male hair - covers top of head
        pxRow(g, hx + 1, hy - 1, hw - 2, c);
        pxRow(g, hx, hy, hw, c);
        pxRow(g, hx, hy + 1, hw, c);
        pxRow(g, hx + 1, hy + 2, hw - 2, c);
        // Highlight
        px(g, hx + 2, hy, hi);
        px(g, hx + 3, hy, hi);
        break;

      case "spiky":
        // Spiky hair (CTO style)
        pxRow(g, hx, hy, hw, c);
        pxRow(g, hx, hy + 1, hw, c);
        pxRow(g, hx + 1, hy + 2, hw - 3, c);
        // Spikes
        px(g, hx + 1, hy - 2, c);
        px(g, hx + 3, hy - 3, c);
        px(g, hx + 5, hy - 2, c);
        px(g, hx + 7, hy - 3, c);
        px(g, hx + 9, hy - 1, c);
        px(g, hx + 2, hy - 1, c);
        px(g, hx + 4, hy - 2, c);
        px(g, hx + 6, hy - 1, c);
        px(g, hx + 8, hy - 2, c);
        // Highlights on spikes
        px(g, hx + 3, hy - 3, hi);
        px(g, hx + 7, hy - 3, hi);
        break;

      case "neat":
        // Neat parted hair
        pxRow(g, hx + 1, hy - 1, hw - 2, c);
        pxRow(g, hx, hy, hw, c);
        pxRow(g, hx, hy + 1, hw, c);
        // Part line
        px(g, hx + 3, hy, darken(c, 0.3));
        px(g, hx + 3, hy + 1, darken(c, 0.3));
        // Side hair
        px(g, hx, hy + 2, c);
        px(g, hx + hw - 1, hy + 2, c);
        // Highlight
        px(g, hx + 5, hy, hi);
        px(g, hx + 6, hy, hi);
        break;

      case "long":
        // Long hair flowing down (female)
        pxRow(g, hx + 1, hy - 1, hw - 2, c);
        pxRow(g, hx, hy, hw, c);
        pxRow(g, hx, hy + 1, hw, c);
        pxRow(g, hx, hy + 2, 2, c);
        pxRow(g, hx + hw - 2, hy + 2, 2, c);
        // Hair flowing down sides
        pxBlock(g, hx - 1, hy + 2, 2, 8, c);
        pxBlock(g, hx + hw - 1, hy + 2, 2, 8, c);
        // Tips
        px(g, hx - 1, hy + 10, darken(c, 0.15));
        px(g, hx + hw, hy + 10, darken(c, 0.15));
        // Highlight
        px(g, hx + 3, hy, hi);
        px(g, hx + 4, hy, hi);
        px(g, hx + 5, hy - 1, hi);
        break;

      case "ponytail":
        // Ponytail (tied back)
        pxRow(g, hx + 1, hy - 1, hw - 2, c);
        pxRow(g, hx, hy, hw, c);
        pxRow(g, hx, hy + 1, hw, c);
        // Ponytail sticking out back/right
        pxBlock(g, hx + hw, hy + 2, 2, 2, c);
        pxBlock(g, hx + hw + 1, hy + 4, 2, 4, c);
        px(g, hx + hw + 2, hy + 8, darken(c, 0.15));
        // Tie
        px(g, hx + hw, hy + 3, 0xcc2222);
        // Highlight
        px(g, hx + 4, hy, hi);
        break;

      case "pixie":
        // Short pixie cut
        pxRow(g, hx + 1, hy - 1, hw - 2, c);
        pxRow(g, hx, hy, hw, c);
        pxRow(g, hx, hy + 1, hw, c);
        // Asymmetric bangs
        pxBlock(g, hx, hy + 2, 3, 2, c);
        px(g, hx + hw - 1, hy + 2, c);
        // Highlight
        px(g, hx + 2, hy, hi);
        px(g, hx + 5, hy - 1, hi);
        break;

      case "curly":
        // Wild curly hair (Algorithm Expert)
        pxRow(g, hx, hy - 2, hw, c);
        px(g, hx + 1, hy - 3, c);
        px(g, hx + 4, hy - 3, c);
        px(g, hx + 7, hy - 3, c);
        pxRow(g, hx - 1, hy - 1, hw + 2, c);
        pxRow(g, hx - 1, hy, hw + 2, c);
        pxRow(g, hx - 1, hy + 1, hw + 2, c);
        pxBlock(g, hx - 1, hy + 2, 2, 3, c);
        pxBlock(g, hx + hw - 1, hy + 2, 2, 3, c);
        // Curly highlights
        px(g, hx + 2, hy - 2, hi);
        px(g, hx + 5, hy - 3, hi);
        px(g, hx + 8, hy - 2, hi);
        px(g, hx, hy + 1, hi);
        break;

      case "bun":
        // Hair bun on top
        pxRow(g, hx + 1, hy - 1, hw - 2, c);
        pxRow(g, hx, hy, hw, c);
        pxRow(g, hx, hy + 1, hw, c);
        // Bun on top
        pxBlock(g, hx + 3, hy - 4, 4, 3, c);
        pxRow(g, hx + 4, hy - 5, 2, c);
        // Bun highlight
        px(g, hx + 4, hy - 4, hi);
        // Side bangs
        px(g, hx, hy + 2, c);
        px(g, hx + hw - 1, hy + 2, c);
        break;
    }
  }

  // ── Animation ───────────────────────────────────────────────────

  private updateAnimation(frameCount: number): void {
    const isWalking =
      this.state === "walking" ||
      this.state === "entering" ||
      this.state === "leaving";

    // Determine walk frame (2-frame cycle) for redrawing legs
    const walkFrame = isWalking ? (Math.floor(frameCount / 8) % 2) : 0;

    // Only rebuild sprite when walk frame changes (saves perf)
    const drawKey = isWalking ? walkFrame : -1;
    if (drawKey !== this.lastDrawnFrame) {
      this.buildSprite(frameCount, walkFrame);
      this.lastDrawnFrame = drawKey;
    }

    switch (this.state) {
      case "idle":
      case "meeting":
      case "talking": {
        // Idle breathing bob
        const phase = frameCount % IDLE_BOB_CYCLE;
        const bobOffset = phase < IDLE_BOB_CYCLE / 2 ? -1 : 0;
        this.body.y = bobOffset;
        this.head.y = bobOffset;
        this.accessory.y = bobOffset;
        this.statusIndicator.y =
          -(SPRITE_H + 2) + bobOffset;
        break;
      }
      case "walking":
      case "entering":
      case "leaving": {
        // Walk step bob
        const wPhase = frameCount % WALK_BOB_CYCLE;
        const wBob = wPhase < WALK_BOB_CYCLE / 2 ? -1 : 0;
        this.body.y = wBob;
        this.head.y = wBob;
        this.accessory.y = wBob;
        this.statusIndicator.y =
          -(SPRITE_H + 2) + wBob;
        break;
      }
      case "blocked": {
        // Slight shake
        const shake = this.frameAge % 6 < 3 ? -1 : 1;
        this.body.x = shake;
        this.head.x = shake;
        this.accessory.x = shake;
        break;
      }
    }

    // Reset shake when not blocked
    if (this.state !== "blocked") {
      this.body.x = 0;
      this.head.x = 0;
      this.accessory.x = 0;
    }
  }

  // ── Movement interpolation ──────────────────────────────────────

  private interpolateMovement(): void {
    if (!this.path || this.pathIndex >= this.path.length) {
      // Arrived
      this.path = null;
      if (this.state === "leaving") {
        this.onLeaveComplete?.();
      } else if (this.state === "entering" || this.state === "walking") {
        this.setState("idle");
      }
      return;
    }

    const target = this.path[this.pathIndex];
    const targetPx = target.x * TILE + TILE / 2;
    const targetPy = target.y * TILE + TILE / 2;

    const dx = targetPx - this.pixelX;
    const dy = targetPy - this.pixelY;
    const dist = Math.abs(dx) + Math.abs(dy); // Manhattan

    if (dist <= WALK_SPEED) {
      // Snap to tile center and advance
      this.pixelX = targetPx;
      this.pixelY = targetPy;
      this.tileX = target.x;
      this.tileY = target.y;
      this.pathIndex++;
    } else {
      // Move one pixel toward target (prefer X then Y for grid feel)
      if (Math.abs(dx) > 0) {
        this.pixelX += dx > 0 ? WALK_SPEED : -WALK_SPEED;
      } else if (Math.abs(dy) > 0) {
        this.pixelY += dy > 0 ? WALK_SPEED : -WALK_SPEED;
      }
    }
  }

  // ── Cleanup ─────────────────────────────────────────────────────

  cleanupSpeechBubble(): void {
    if (this.speechBubble) {
      this.removeChild(this.speechBubble);
      this.speechBubble.destroy();
      this.speechBubble = null;
    }
  }
}
