/**
 * Sprite-based character using pixel-art sprite sheets.
 * Each character uses a sprite variant (0-5) with 3 directions × 7 frames.
 *
 * Sprite sheet layout (112×96):
 *   Row 0 (y=0):  facing down  — 7 frames × 16px
 *   Row 1 (y=32): facing up    — 7 frames × 16px
 *   Row 2 (y=64): facing right — 7 frames × 16px
 *   (left = flipped right)
 *
 * Frames: 0-3 walk cycle (0→1→2→1), 4-5 typing, 6 idle variant
 */

import { Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import { OFFICE, type RoleConfig } from "../constants/roles";
import { StatusIndicator, type IndicatorStatus } from "./StatusIndicator";
import { SpeechBubble } from "./SpeechBubble";
import { ToolIcon, type ToolType } from "./ToolIcon";
import { getCharFrame, isCharFacingLeft, CHAR_FRAME_W, CHAR_FRAME_H } from "./AssetLoader";

// ─── Constants ────────────────────────────────────────────────────
const TILE = OFFICE.TILE_SIZE; // 16
const WALK_SPEED = 3; // pixels per frame (faster for better visibility)
const WALK_ANIM_RATE = 8; // frames per walk animation step
const TYPE_ANIM_RATE = 15; // frames per typing animation step
const SHADOW_W = 10;
const SHADOW_H = 3;

// Walk cycle frame indices within the sprite sheet row
const WALK_CYCLE = [0, 1, 2, 1];
const TYPE_CYCLE = [4, 5];

export type CharacterState =
  | "idle"
  | "walking"
  | "meeting"
  | "talking"
  | "entering"
  | "leaving"
  | "blocked";

// ═══════════════════════════════════════════════════════════════════
//  Character
// ═══════════════════════════════════════════════════════════════════

export class Character extends Container {
  // Role info
  readonly roleConfig: RoleConfig;

  // State machine
  state: CharacterState = "idle";
  private frameAge = 0;

  // Tile position (grid coords)
  tileX = 0;
  tileY = 0;

  // Pixel position (sub-tile smooth interpolation)
  pixelX = 0;
  pixelY = 0;

  // Path data
  /** Current movement path (null = no path). Exposed for leaving-state cleanup checks. */
  path: { x: number; y: number }[] | null = null;
  private pathIndex = 0;

  // Direction for sprite facing
  private direction: "down" | "up" | "right" | "left" = "down";

  // Visual parts
  private shadow: Graphics;
  private charSprite: Sprite;
  private nameTag: Text;
  readonly statusIndicator: StatusIndicator;
  private speechBubble: SpeechBubble | null = null;
  private toolIcon: ToolIcon;

  // Leave callback
  onLeaveComplete: (() => void) | null = null;
  /** Frame count when entering "leaving" state, for timeout detection. -1 = not set. */
  leaveStartFrame = -1;

  // Click callback
  onClicked: (() => void) | null = null;

  constructor(roleConfig: RoleConfig) {
    super();
    this.roleConfig = roleConfig;

    // Enable click events
    this.eventMode = "static";
    this.cursor = "pointer";
    this.on("pointerdown", () => this.onClicked?.());

    // Shadow
    this.shadow = new Graphics();
    this.shadow.ellipse(0, 0, SHADOW_W / 2, SHADOW_H / 2).fill({ color: 0x000000, alpha: 0.3 });
    this.shadow.y = 0;
    this.addChild(this.shadow);

    // Character sprite (anchor at bottom-center)
    this.charSprite = new Sprite();
    this.charSprite.anchor.set(0.5, 1); // bottom-center
    this.charSprite.y = 2; // feet just above shadow
    this.addChild(this.charSprite);

    // Set initial frame
    this.updateSpriteFrame(0);

    // Name tag
    const style = new TextStyle({
      fontFamily: "monospace",
      fontSize: 7,
      fill: roleConfig.colorHex,
      stroke: { color: 0x000000, width: 2 },
      align: "center",
    });
    this.nameTag = new Text({ text: roleConfig.tag, style });
    this.nameTag.anchor.set(0.5, 1);
    this.nameTag.y = -(CHAR_FRAME_H + 2);
    this.addChild(this.nameTag);

    // Status indicator
    this.statusIndicator = new StatusIndicator();
    this.statusIndicator.x = CHAR_FRAME_W / 2 + 1;
    this.statusIndicator.y = -(CHAR_FRAME_H - 4);
    this.addChild(this.statusIndicator);

    // Tool icon (above name tag)
    this.toolIcon = new ToolIcon();
    this.toolIcon.x = 0;
    this.toolIcon.y = -(CHAR_FRAME_H + 12);
    this.addChild(this.toolIcon);
  }

  // ── State management ───────────────────────────────────────────

  setState(newState: CharacterState): void {
    if (newState === this.state) return;
    this.state = newState;
    this.frameAge = 0;

    switch (newState) {
      case "blocked":
        this.statusIndicator.setStatus("blocked");
        break;
      case "idle":
      case "meeting":
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

  showTool(tool: ToolType): void {
    this.toolIcon.show(tool);
  }

  hideTool(): void {
    this.toolIcon.hide();
  }

  showSpeech(text: string): void {
    if (this.speechBubble) {
      this.removeChild(this.speechBubble);
      this.speechBubble.destroy();
    }
    this.speechBubble = new SpeechBubble(text);
    this.speechBubble.x = 0;
    this.speechBubble.y = -(CHAR_FRAME_H + 8);
    this.addChild(this.speechBubble);
    if (this.state === "idle") this.setState("talking");
  }

  // ── Per-frame update ───────────────────────────────────────────

  update(frameCount: number): void {
    this.frameAge++;

    // Speech bubble
    if (this.speechBubble) {
      this.speechBubble.update(frameCount);
      if (this.speechBubble.isDone()) {
        this.removeChild(this.speechBubble);
        this.speechBubble.destroy();
        this.speechBubble = null;
        if (this.state === "talking") this.setState("idle");
      }
    }

    // Status indicator pulse
    this.statusIndicator.update(frameCount);

    // Tool icon animation
    this.toolIcon.update(frameCount);

    // Movement
    if (this.state === "walking" || this.state === "entering" || this.state === "leaving") {
      this.interpolateMovement();
    }

    // Animation
    this.updateAnimation(frameCount);

    // Sync PixiJS position to pixel coords
    this.x = Math.round(this.pixelX);
    this.y = Math.round(this.pixelY);
  }

  // ── Animation ──────────────────────────────────────────────────

  private updateAnimation(frameCount: number): void {
    let frameIdx = 0;

    switch (this.state) {
      case "walking":
      case "entering":
      case "leaving": {
        // Walk cycle: 0→1→2→1, advancing every WALK_ANIM_RATE frames
        const cyclePos = Math.floor(this.frameAge / WALK_ANIM_RATE) % WALK_CYCLE.length;
        frameIdx = WALK_CYCLE[cyclePos];
        break;
      }

      case "meeting":
      case "talking": {
        // Typing animation
        const cyclePos = Math.floor(this.frameAge / TYPE_ANIM_RATE) % TYPE_CYCLE.length;
        frameIdx = TYPE_CYCLE[cyclePos];
        break;
      }

      case "blocked": {
        // Shake effect — use idle frame but shake the sprite
        frameIdx = 0;
        const shake = Math.sin(this.frameAge * 0.5) * 1.5;
        this.charSprite.x = shake;
        break;
      }

      case "idle":
      default: {
        // Idle: standing frame with subtle bob
        frameIdx = 0;
        const bob = Math.sin(this.frameAge * 0.05) * 0.5;
        this.charSprite.y = 2 + bob;
        break;
      }
    }

    // Reset shake/bob for non-applicable states
    if (this.state !== "blocked") {
      this.charSprite.x = 0;
    }
    if (this.state !== "idle") {
      this.charSprite.y = 2;
    }

    this.updateSpriteFrame(frameIdx);
  }

  private updateSpriteFrame(frameIdx: number): void {
    const tex = getCharFrame(this.roleConfig.spriteVariant, this.direction, frameIdx);
    if (tex) {
      this.charSprite.texture = tex;
      // Flip horizontally for "left" direction
      this.charSprite.scale.x = isCharFacingLeft(this.direction) ? -1 : 1;
    }
  }

  // ── Movement interpolation ─────────────────────────────────────

  private interpolateMovement(): void {
    if (!this.path || this.pathIndex >= this.path.length) {
      // If entering and no path yet, wait for async path resolution
      if (this.state === "entering" && !this.path) {
        return;
      }
      // Arrived at destination
      this.path = null;
      if (this.state === "leaving") {
        this.onLeaveComplete?.();
      } else if (this.state === "entering" || this.state === "walking") {
        this.setState("idle");
        this.direction = "down"; // face down when idle at desk
      }
      return;
    }

    const target = this.path[this.pathIndex];
    const targetPx = target.x * TILE + TILE / 2;
    const targetPy = target.y * TILE + TILE / 2;

    const dx = targetPx - this.pixelX;
    const dy = targetPy - this.pixelY;
    const dist = Math.abs(dx) + Math.abs(dy);

    // Update facing direction based on movement
    if (Math.abs(dx) > Math.abs(dy)) {
      this.direction = dx > 0 ? "right" : "left";
    } else if (dy !== 0) {
      this.direction = dy > 0 ? "down" : "up";
    }

    if (dist <= WALK_SPEED) {
      // Snap to tile center
      this.pixelX = targetPx;
      this.pixelY = targetPy;
      this.tileX = target.x;
      this.tileY = target.y;
      this.pathIndex++;
    } else {
      // Move toward target
      if (Math.abs(dx) > 0) {
        this.pixelX += dx > 0 ? WALK_SPEED : -WALK_SPEED;
      } else if (Math.abs(dy) > 0) {
        this.pixelY += dy > 0 ? WALK_SPEED : -WALK_SPEED;
      }
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────

  cleanupSpeechBubble(): void {
    if (this.speechBubble) {
      this.removeChild(this.speechBubble);
      this.speechBubble.destroy();
      this.speechBubble = null;
    }
  }
}
