import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { OFFICE, type RoleConfig } from "../constants/roles";
import { StatusIndicator, type IndicatorStatus } from "./StatusIndicator";
import { SpeechBubble } from "./SpeechBubble";

// ─── Constants ──────────────────────────────────────────────────────
const TILE = OFFICE.TILE_SIZE;
const WALK_SPEED = 1; // pixels per frame
const IDLE_BOB_CYCLE = 60; // frames for one full idle bob cycle
const WALK_BOB_CYCLE = 8; // frames for one walk bob cycle

// Character body dimensions (pixels)
const BODY_W = 10;
const BODY_H_NORMAL = 14;
const BODY_H_TALL = 16; // opus models
const HEAD_RADIUS = 4;
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

/** Lighten a color by blending toward white. */
function lighten(color: number, amount: number): number {
  const r = Math.min(255, ((color >> 16) & 0xff) + 255 * amount) | 0;
  const g = Math.min(255, ((color >> 8) & 0xff) + 255 * amount) | 0;
  const b = Math.min(255, (color & 0xff) + 255 * amount) | 0;
  return (r << 16) | (g << 8) | b;
}

/**
 * Animated character with state machine.
 * Renders as a simple colored rectangle body + circle head (V1 placeholder).
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

  private bodyH: number;
  private frameAge = 0;

  /** Called when the character finishes leaving (reaches door). */
  onLeaveComplete: (() => void) | null = null;

  constructor(roleConfig: RoleConfig) {
    super();
    this.roleConfig = roleConfig;
    this.roleId = roleConfig.id;

    // Default position at door
    this.tileX = OFFICE.DOOR_X;
    this.tileY = OFFICE.DOOR_Y;
    this.pixelX = this.tileX * TILE + TILE / 2;
    this.pixelY = this.tileY * TILE + TILE / 2;

    // Opus models are taller
    this.bodyH =
      roleConfig.model === "opus" ? BODY_H_TALL : BODY_H_NORMAL;

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

    this.buildSprite();

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
    this.speechBubble.y = -(this.bodyH + HEAD_RADIUS * 2 + 8);
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

  // ── Visual construction ─────────────────────────────────────────

  private buildSprite(): void {
    const color = this.roleConfig.colorHex;
    const headColor = lighten(color, 0.15);

    // Shadow (ellipse below feet)
    this.shadow.clear();
    this.shadow
      .ellipse(0, 0, SHADOW_W / 2, SHADOW_H / 2)
      .fill({ color: 0x000000, alpha: 0.3 });
    this.shadow.y = 0; // at feet level

    // Body (centered rectangle)
    this.body.clear();
    this.body
      .rect(-BODY_W / 2, -this.bodyH, BODY_W, this.bodyH)
      .fill({ color })
      .stroke({ width: 1, color: lighten(color, 0.25), alpha: 0.5 });

    // Head (circle on top of body)
    this.head.clear();
    this.head
      .circle(0, -this.bodyH - HEAD_RADIUS, HEAD_RADIUS)
      .fill({ color: headColor })
      .stroke({ width: 1, color: lighten(headColor, 0.2), alpha: 0.5 });

    // Layer-specific accessory detail
    this.accessory.clear();
    switch (this.roleConfig.layer) {
      case "management":
      case "executive":
        // White collar line
        this.accessory
          .moveTo(-BODY_W / 2 + 1, -this.bodyH + 2)
          .lineTo(BODY_W / 2 - 1, -this.bodyH + 2)
          .stroke({ width: 1, color: 0xffffff, alpha: 0.6 });
        break;
      case "technical":
        // Small blue screen rectangle on chest
        this.accessory
          .rect(-2, -this.bodyH + 4, 4, 3)
          .fill({ color: 0x4488cc, alpha: 0.7 });
        break;
      case "execution":
        // Small tool line (wrench shape)
        this.accessory
          .moveTo(-2, -this.bodyH + 5)
          .lineTo(2, -this.bodyH + 5)
          .stroke({ width: 1, color: 0xaaaaaa, alpha: 0.6 });
        break;
    }

    // Status indicator position (above head)
    this.statusIndicator.x = 0;
    this.statusIndicator.y = -(this.bodyH + HEAD_RADIUS * 2 + 4);

    // Name tag (below feet)
    this.nameTag.anchor.set(0.5, 0);
    this.nameTag.x = 0;
    this.nameTag.y = 3;
  }

  // ── Animation ───────────────────────────────────────────────────

  private updateAnimation(frameCount: number): void {
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
          -(this.bodyH + HEAD_RADIUS * 2 + 4) + bobOffset;
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
          -(this.bodyH + HEAD_RADIUS * 2 + 4) + wBob;
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
