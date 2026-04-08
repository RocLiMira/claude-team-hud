import { Container, Graphics } from "pixi.js";

export type IndicatorStatus = "working" | "idle" | "blocked" | "offline";

const STATUS_COLORS: Record<IndicatorStatus, number> = {
  working: 0x22cc44,
  idle: 0xccaa22,
  blocked: 0xcc2222,
  offline: 0x555555,
};

const DOT_RADIUS = 3;
const PULSE_HALF_CYCLE = 15; // frames (toggle every 15 frames @ 30fps = 0.5s)

/**
 * Small colored circle rendered above a character's head.
 * Pulses when the status is "blocked".
 */
export class StatusIndicator extends Container {
  private dot: Graphics;
  private currentStatus: IndicatorStatus = "idle";
  private pulseFrame = 0;

  constructor() {
    super();
    this.dot = new Graphics();
    this.addChild(this.dot);
    this.drawDot(STATUS_COLORS.idle);
  }

  setStatus(status: IndicatorStatus): void {
    if (status === this.currentStatus) return;
    this.currentStatus = status;
    this.pulseFrame = 0;
    this.drawDot(STATUS_COLORS[status]);
    this.dot.alpha = 1;
  }

  update(frameCount: number): void {
    if (this.currentStatus === "blocked") {
      this.pulseFrame++;
      const phase = this.pulseFrame % (PULSE_HALF_CYCLE * 2);
      this.dot.alpha = phase < PULSE_HALF_CYCLE ? 1.0 : 0.4;
    }
  }

  private drawDot(color: number): void {
    this.dot.clear();
    this.dot.circle(0, 0, DOT_RADIUS).fill({ color });
  }
}
