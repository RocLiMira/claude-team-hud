/**
 * Pixel-art tool icons displayed above characters when using tools.
 * Drawn with PixiJS Graphics — no external assets needed.
 */

import { Container, Graphics } from "pixi.js";

export type ToolType = "web" | "write" | "read" | "bash" | "think" | "chat" | "git" | "debug" | "database" | "design" | "generic" | null;

const ICON_SIZE = 10;
const BOB_SPEED = 0.08;
const BOB_AMOUNT = 1.5;

// Scale-in animation
const SCALE_IN_FRAMES = 6;

export class ToolIcon extends Container {
  private icon: Graphics;
  private frameAge = 0;
  private currentTool: ToolType = null;

  constructor() {
    super();
    this.icon = new Graphics();
    this.addChild(this.icon);
    this.visible = false;
    this.scale.set(0);
  }

  show(tool: ToolType): void {
    if (tool === this.currentTool) return;
    this.currentTool = tool;
    if (!tool) {
      this.visible = false;
      return;
    }
    this.drawIcon(tool);
    this.visible = true;
    this.frameAge = 0;
    this.scale.set(0);
  }

  hide(): void {
    this.currentTool = null;
    this.visible = false;
  }

  update(frameCount: number): void {
    if (!this.visible) return;
    this.frameAge++;

    // Scale-in
    if (this.frameAge <= SCALE_IN_FRAMES) {
      const t = this.frameAge / SCALE_IN_FRAMES;
      this.scale.set(t * t); // ease-in
    } else {
      this.scale.set(1);
    }

    // Bob animation
    this.y = Math.sin(frameCount * BOB_SPEED) * BOB_AMOUNT;
  }

  private drawIcon(tool: ToolType): void {
    this.icon.clear();

    switch (tool) {
      case "web":
        this.drawGlobe();
        break;
      case "write":
        this.drawPen();
        break;
      case "read":
        this.drawMagnifier();
        break;
      case "bash":
        this.drawTerminal();
        break;
      case "think":
        this.drawLightbulb();
        break;
      case "chat":
        this.drawBubble();
        break;
      case "git":
        this.drawGitBranch();
        break;
      case "debug":
        this.drawBug();
        break;
      case "database":
        this.drawDatabase();
        break;
      case "design":
        this.drawPalette();
        break;
      case "generic":
      default:
        this.drawHammer();
        break;
    }
  }

  /** 🌐 Globe — circle with latitude/longitude lines */
  private drawGlobe(): void {
    const r = ICON_SIZE / 2;
    // Outer circle
    this.icon.circle(0, 0, r).fill({ color: 0x2288cc }).stroke({ width: 1, color: 0x44aaee });
    // Horizontal line
    this.icon.moveTo(-r, 0).lineTo(r, 0).stroke({ width: 1, color: 0x44aaee });
    // Vertical ellipse
    this.icon.ellipse(0, 0, r * 0.4, r).stroke({ width: 1, color: 0x44aaee });
  }

  /** ✏️ Pen — diagonal pencil shape */
  private drawPen(): void {
    // Pencil body (diagonal)
    this.icon
      .moveTo(-4, 4).lineTo(2, -2).lineTo(4, 0).lineTo(-2, 6).closePath()
      .fill({ color: 0xddaa22 })
      .stroke({ width: 1, color: 0x886600 });
    // Tip
    this.icon
      .moveTo(-4, 4).lineTo(-5, 5).lineTo(-2, 6).closePath()
      .fill({ color: 0x333333 });
  }

  /** 🔍 Magnifying glass */
  private drawMagnifier(): void {
    // Glass circle
    this.icon.circle(-1, -1, 4).fill({ color: 0xaaddff, alpha: 0.5 }).stroke({ width: 1.5, color: 0x6688aa });
    // Handle
    this.icon.moveTo(2, 2).lineTo(5, 5).stroke({ width: 2, color: 0x886644 });
  }

  /** 💻 Terminal — rectangle with "> _" */
  private drawTerminal(): void {
    // Screen
    this.icon.roundRect(-5, -4, 10, 8, 1).fill({ color: 0x1a1a2e }).stroke({ width: 1, color: 0x44cc44 });
    // Prompt ">"
    this.icon.moveTo(-3, -1).lineTo(-1, 1).lineTo(-3, 3).stroke({ width: 1, color: 0x44cc44 });
    // Cursor "_"
    this.icon.moveTo(0, 2).lineTo(3, 2).stroke({ width: 1, color: 0x44cc44 });
  }

  /** 💡 Lightbulb — thinking/planning */
  private drawLightbulb(): void {
    // Bulb
    this.icon.circle(0, -2, 4).fill({ color: 0xffdd44 }).stroke({ width: 1, color: 0xccaa00 });
    // Base
    this.icon.rect(-2, 2, 4, 2).fill({ color: 0xcccccc });
    // Rays
    this.icon.moveTo(0, -7).lineTo(0, -8).stroke({ width: 1, color: 0xffee66 });
    this.icon.moveTo(-5, -2).lineTo(-6, -2).stroke({ width: 1, color: 0xffee66 });
    this.icon.moveTo(5, -2).lineTo(6, -2).stroke({ width: 1, color: 0xffee66 });
  }

  /** 💬 Speech bubble — chatting/messaging */
  private drawBubble(): void {
    this.icon.roundRect(-5, -5, 10, 7, 2).fill({ color: 0xffffff }).stroke({ width: 1, color: 0x3a3a48 });
    // Tail
    this.icon.moveTo(-2, 2).lineTo(-4, 5).lineTo(1, 2).closePath().fill({ color: 0xffffff });
    // Dots
    this.icon.circle(-2, -2, 1).fill({ color: 0x666666 });
    this.icon.circle(1, -2, 1).fill({ color: 0x666666 });
    this.icon.circle(4, -2, 1).fill({ color: 0x666666 });
  }

  /** Git branch icon */
  private drawGitBranch(): void {
    // Main branch line
    this.icon.moveTo(0, -5).lineTo(0, 4).stroke({ width: 1.5, color: 0xee6633 });
    // Branch
    this.icon.moveTo(0, -1).lineTo(4, -4).stroke({ width: 1.5, color: 0x44cc44 });
    // Dots (commits)
    this.icon.circle(0, -5, 1.5).fill({ color: 0xee6633 });
    this.icon.circle(0, 4, 1.5).fill({ color: 0xee6633 });
    this.icon.circle(4, -4, 1.5).fill({ color: 0x44cc44 });
  }

  /** 🐛 Bug — debugging */
  private drawBug(): void {
    // Body
    this.icon.ellipse(0, 0, 3, 4).fill({ color: 0xcc3333 }).stroke({ width: 1, color: 0x881111 });
    // Eyes
    this.icon.circle(-1.5, -2, 1).fill({ color: 0xffffff });
    this.icon.circle(1.5, -2, 1).fill({ color: 0xffffff });
    // Legs
    this.icon.moveTo(-3, -1).lineTo(-5, -3).stroke({ width: 1, color: 0x333333 });
    this.icon.moveTo(3, -1).lineTo(5, -3).stroke({ width: 1, color: 0x333333 });
    this.icon.moveTo(-3, 1).lineTo(-5, 3).stroke({ width: 1, color: 0x333333 });
    this.icon.moveTo(3, 1).lineTo(5, 3).stroke({ width: 1, color: 0x333333 });
  }

  /** 🗄️ Database cylinder */
  private drawDatabase(): void {
    // Body
    this.icon.rect(-4, -2, 8, 6).fill({ color: 0x4466aa });
    // Top ellipse
    this.icon.ellipse(0, -2, 4, 2).fill({ color: 0x5588cc }).stroke({ width: 1, color: 0x3355aa });
    // Bottom ellipse
    this.icon.ellipse(0, 4, 4, 2).fill({ color: 0x4466aa }).stroke({ width: 1, color: 0x3355aa });
    // Side lines
    this.icon.moveTo(-4, -2).lineTo(-4, 4).stroke({ width: 1, color: 0x3355aa });
    this.icon.moveTo(4, -2).lineTo(4, 4).stroke({ width: 1, color: 0x3355aa });
  }

  /** 🎨 Palette — design work */
  private drawPalette(): void {
    // Palette shape
    this.icon.circle(0, 0, 5).fill({ color: 0xddccaa }).stroke({ width: 1, color: 0xaa9977 });
    // Color dots
    this.icon.circle(-2, -2, 1.5).fill({ color: 0xcc3333 });
    this.icon.circle(1, -2, 1.5).fill({ color: 0x33cc33 });
    this.icon.circle(-1, 1, 1.5).fill({ color: 0x3333cc });
    this.icon.circle(2, 1, 1.5).fill({ color: 0xcccc33 });
  }

  /** 🔨 Hammer — generic tool */
  private drawHammer(): void {
    // Handle
    this.icon.moveTo(0, 0).lineTo(0, 5).stroke({ width: 2, color: 0x886644 });
    // Head
    this.icon.roundRect(-4, -3, 8, 4, 1).fill({ color: 0x888888 }).stroke({ width: 1, color: 0x666666 });
  }
}

/** Detect tool type from a task description or tool name string. */
export function detectToolType(text: string | null | undefined): ToolType {
  if (!text) return null;
  const lower = text.toLowerCase();

  // Ordered by specificity — more specific matches first
  if (/\b(web.?search|browse|fetch|http|url|internet|crawl|scrape)\b/.test(lower)) return "web";
  if (/\b(debug|fix.?bug|breakpoint|stack.?trace|error|exception|troubleshoot)\b/.test(lower)) return "debug";
  if (/\b(git|commit|merge|branch|rebase|pr|pull.?request|push)\b/.test(lower)) return "git";
  if (/\b(database|sql|query|migration|schema|table|mongo|redis|postgres)\b/.test(lower)) return "database";
  if (/\b(design|ui|ux|layout|style|css|theme|palette|figma|mockup)\b/.test(lower)) return "design";
  if (/\b(bash|shell|terminal|run|exec|deploy|build|npm|cargo|docker|ci|cd|server)\b/.test(lower)) return "bash";
  if (/\b(test|spec|jest|vitest|pytest|coverage|assert)\b/.test(lower)) return "bash";
  if (/\b(write|edit|create|modify|update|refactor|implement|scaffold)\b/.test(lower)) return "write";
  if (/\b(read|grep|search|find|scan|review|inspect|analyze|audit)\b/.test(lower)) return "read";
  if (/\b(plan|architect|design.?doc|spec|rfc|proposal|think|evaluate)\b/.test(lower)) return "think";
  if (/\b(chat|discuss|message|ask|communicate|meeting|sync|standup)\b/.test(lower)) return "chat";

  // If there's a task but no specific match, show generic
  if (text.trim().length > 0) return "generic";
  return null;
}
