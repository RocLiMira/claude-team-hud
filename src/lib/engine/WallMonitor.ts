import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { OFFICE } from "../constants/roles";
import type { TokenMetrics } from "../state/metrics";

// ─── Layout constants ───────────────────────────────────────────────
const MONITOR_TILE_X = 17;
const MONITOR_TILE_Y = 26;
const T = OFFICE.TILE_SIZE;

// Monitor dimensions in pixels
const HOUSING_W = 5 * T; // 80px (spans ~5 tiles wide)
const HOUSING_H = 2.5 * T; // 40px
const SCREEN_PAD = 3;
const SCREEN_W = HOUSING_W - SCREEN_PAD * 2;
const SCREEN_H = HOUSING_H - SCREEN_PAD * 2;

const BAR_W = SCREEN_W - 12;
const BAR_H = 4;

const FONT_STYLE = new TextStyle({
  fontFamily: "monospace",
  fontSize: 6,
  fill: 0x22cc44,
  letterSpacing: 0,
});

/**
 * Token usage display rendered as a PixiJS container on the south wall.
 * Shows token count, progress bar (green->yellow->red), agent count.
 * Has a CRT scan line effect.
 */
export class WallMonitor extends Container {
  private screenBg: Graphics;
  private tokensText: Text;
  private agentsText: Text;
  private progressBar: Graphics;
  private scanLine: Graphics;
  private scanY = 0;

  constructor() {
    super();

    // Position the monitor container
    this.x = MONITOR_TILE_X * T;
    this.y = MONITOR_TILE_Y * T;

    // Housing (dark outer frame)
    const housing = new Graphics();
    housing
      .rect(0, 0, HOUSING_W, HOUSING_H)
      .fill({ color: 0x111118 })
      .stroke({ width: 1, color: 0x333344 });
    this.addChild(housing);

    // Screen background
    this.screenBg = new Graphics();
    this.screenBg
      .rect(SCREEN_PAD, SCREEN_PAD, SCREEN_W, SCREEN_H)
      .fill({ color: 0x0a0a14 });
    this.addChild(this.screenBg);

    // Tokens text
    this.tokensText = new Text({
      text: "TOKENS: --",
      style: FONT_STYLE,
    });
    this.tokensText.x = SCREEN_PAD + 4;
    this.tokensText.y = SCREEN_PAD + 3;
    this.addChild(this.tokensText);

    // Progress bar background
    const barBg = new Graphics();
    barBg
      .rect(SCREEN_PAD + 6, SCREEN_PAD + 14, BAR_W, BAR_H)
      .fill({ color: 0x1a1a2a })
      .stroke({ width: 1, color: 0x333344 });
    this.addChild(barBg);

    // Progress bar fill (drawn dynamically)
    this.progressBar = new Graphics();
    this.progressBar.x = SCREEN_PAD + 6;
    this.progressBar.y = SCREEN_PAD + 14;
    this.addChild(this.progressBar);

    // Agents text
    this.agentsText = new Text({
      text: "AGENTS: 0/13",
      style: FONT_STYLE,
    });
    this.agentsText.x = SCREEN_PAD + 4;
    this.agentsText.y = SCREEN_PAD + 22;
    this.addChild(this.agentsText);

    // CRT scan line
    this.scanLine = new Graphics();
    this.scanLine
      .rect(SCREEN_PAD, 0, SCREEN_W, 1)
      .fill({ color: 0xffffff, alpha: 0.12 });
    this.addChild(this.scanLine);
  }

  /** Update displayed metrics. */
  updateMetrics(metrics: TokenMetrics, agentCount: number): void {
    // Format token count with comma separators
    const formatted = metrics.totalTokens.toLocaleString("en-US");
    this.tokensText.text = `TOKENS: ${formatted}`;

    this.agentsText.text = `AGENTS: ${agentCount}/13`;

    // Progress bar — rate limit percentage drives color & fill
    const pct = Math.max(0, Math.min(1, metrics.rateLimitPct / 100));
    const fillW = Math.round(BAR_W * pct);

    // Color transitions: green (0-50%), yellow (50-80%), red (80-100%)
    let barColor: number;
    if (pct < 0.5) {
      barColor = 0x22cc44;
    } else if (pct < 0.8) {
      barColor = 0xccaa22;
    } else {
      barColor = 0xcc2222;
    }

    this.progressBar.clear();
    if (fillW > 0) {
      this.progressBar.rect(0, 0, fillW, BAR_H).fill({ color: barColor });
    }
  }

  /** Advance the CRT scan line each frame. */
  update(_frameCount: number): void {
    this.scanY = (this.scanY + 1) % SCREEN_H;
    this.scanLine.y = SCREEN_PAD + this.scanY;
  }
}
