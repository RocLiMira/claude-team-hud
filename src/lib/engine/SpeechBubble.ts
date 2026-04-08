import { Container, Graphics, Text, TextStyle } from "pixi.js";

const MAX_CHARS = 30;
const PADDING_X = 6;
const PADDING_Y = 4;
const TAIL_SIZE = 4;
const FONT_SIZE = 7;

// Animation timings (in frames @ 30fps)
const SCALE_IN_FRAMES = 4;
const HOLD_FRAMES = 90; // 3 seconds
const SCALE_OUT_FRAMES = 4;
const TOTAL_FRAMES = SCALE_IN_FRAMES + HOLD_FRAMES + SCALE_OUT_FRAMES;

// Discrete scale steps for scale-in / scale-out
const SCALE_STEPS = [0.0, 0.33, 0.66, 1.0];

/**
 * White rounded-rect speech bubble with triangular tail.
 * Appears above a character, auto-dismisses after 3 seconds.
 */
export class SpeechBubble extends Container {
  private bg: Graphics;
  private textObj: Text;
  private frameAge = 0;

  constructor(text: string, maxChars: number = MAX_CHARS) {
    super();

    // Truncate
    const displayText =
      text.length > maxChars ? text.slice(0, maxChars - 3) + "..." : text;

    // Text object
    this.textObj = new Text({
      text: displayText,
      style: new TextStyle({
        fontFamily: "monospace",
        fontSize: FONT_SIZE,
        fill: 0x1a1a2e,
        letterSpacing: 0,
      }),
    });

    // Measure text to size the bubble
    const tw = this.textObj.width;
    const th = this.textObj.height;
    const bw = tw + PADDING_X * 2;
    const bh = th + PADDING_Y * 2;

    // Background bubble
    this.bg = new Graphics();
    this.bg
      .roundRect(-bw / 2, -bh - TAIL_SIZE, bw, bh, 3)
      .fill({ color: 0xffffff })
      .stroke({ width: 1, color: 0x3a3a48 });

    // Triangular tail pointing down
    this.bg
      .moveTo(-TAIL_SIZE, -TAIL_SIZE)
      .lineTo(0, 0)
      .lineTo(TAIL_SIZE, -TAIL_SIZE)
      .closePath()
      .fill({ color: 0xffffff })
      .stroke({ width: 1, color: 0x3a3a48 });

    // Position text inside bubble
    this.textObj.x = -tw / 2;
    this.textObj.y = -bh - TAIL_SIZE + PADDING_Y;

    this.addChild(this.bg);
    this.addChild(this.textObj);

    // Start invisible (scale-in will handle appearance)
    this.scale.set(0);
  }

  update(_frameCount: number): void {
    this.frameAge++;

    if (this.frameAge <= SCALE_IN_FRAMES) {
      // Scale-in phase
      const step = Math.min(this.frameAge, SCALE_STEPS.length - 1);
      const s = SCALE_STEPS[step];
      this.scale.set(s);
    } else if (this.frameAge <= SCALE_IN_FRAMES + HOLD_FRAMES) {
      // Hold phase — ensure full scale
      this.scale.set(1);
    } else {
      // Scale-out phase
      const outFrame = this.frameAge - SCALE_IN_FRAMES - HOLD_FRAMES;
      const step = Math.max(
        0,
        SCALE_STEPS.length - 1 - Math.min(outFrame, SCALE_STEPS.length - 1)
      );
      const s = SCALE_STEPS[step];
      this.scale.set(s);
    }
  }

  isDone(): boolean {
    return this.frameAge >= TOTAL_FRAMES;
  }
}
