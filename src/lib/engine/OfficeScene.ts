import { Application } from "pixi.js";

/**
 * Main PixiJS application managing the office scene.
 * Renders tilemap, characters, UI overlays.
 */
export class OfficeScene {
  private app: Application | null = null;
  private container: HTMLDivElement;

  constructor(container: HTMLDivElement) {
    this.container = container;
  }

  async init(): Promise<void> {
    this.app = new Application();
    await this.app.init({
      resizeTo: this.container,
      background: 0x0a0a14,
      resolution: 2,
      autoDensity: true,
      antialias: false,
      roundPixels: true,
    });

    // Ensure pixel-perfect rendering
    this.container.appendChild(this.app.canvas);

    // Set max FPS to 30 for SNES-style feel
    this.app.ticker.maxFPS = 30;

    console.log("[OfficeScene] Initialized", {
      width: this.app.screen.width,
      height: this.app.screen.height,
    });

    // TODO: Load tilemap, spawn characters, start game loop
  }

  destroy(): void {
    if (this.app) {
      this.app.destroy(true);
      this.app = null;
    }
  }
}
