import { Application, Container, TextureSource } from "pixi.js";
import { ROLE_MAP, ROLES } from "../constants/roles";
import { agentsStore, type AgentState } from "../state/agents";
import { officeStore, meetingActive, type CharacterPosition } from "../state/office";
import { metricsStore, environmentStore, type TokenMetrics, type EnvironmentState } from "../state/metrics";
import { TilemapLayer } from "./TilemapLayer";
import { Pathfinder } from "./Pathfinder";
import { Character } from "./Character";
import { CharacterFactory } from "./CharacterFactory";
import { WallMonitor } from "./WallMonitor";
import { EnvironmentOverlays } from "./EnvironmentOverlays";

/**
 * Main PixiJS application managing the office scene.
 * Renders tilemap, characters, UI overlays.
 * Subscribes to Svelte stores and reacts to state changes.
 */
export class OfficeScene {
  private app: Application | null = null;
  private container: HTMLDivElement;

  // Layers (z-order bottom to top)
  private tilemapLayer!: TilemapLayer;
  private environmentOverlays!: EnvironmentOverlays;
  private characterContainer!: Container;
  private uiContainer!: Container;

  // Subsystems
  private pathfinder!: Pathfinder;
  private wallMonitor!: WallMonitor;

  // Runtime state
  private characters = new Map<string, Character>();
  private frameCount = 0;
  private isMeetingActive = false;

  // Store unsubscribers
  private unsubscribers: (() => void)[] = [];

  constructor(container: HTMLDivElement) {
    this.container = container;
  }

  async init(): Promise<void> {
    // Global pixel-perfect texture defaults
    TextureSource.defaultOptions.scaleMode = "nearest";

    this.app = new Application();
    await this.app.init({
      resizeTo: this.container,
      background: 0x0a0a14,
      resolution: 2,
      autoDensity: true,
      antialias: false,
      roundPixels: true,
    });

    // Append the canvas
    this.container.appendChild(this.app.canvas);

    // Set max FPS to 30 for SNES-style feel
    this.app.ticker.maxFPS = 30;

    console.log("[OfficeScene] Initialized", {
      width: this.app.screen.width,
      height: this.app.screen.height,
    });

    this.setupLayers();
    this.subscribeToStores();

    // Start game loop
    this.app.ticker.add(() => this.gameLoop());
  }

  // ── Layer setup ─────────────────────────────────────────────────

  private setupLayers(): void {
    if (!this.app) return;

    // 1. Tilemap
    this.tilemapLayer = new TilemapLayer();
    this.tilemapLayer.build();
    this.app.stage.addChild(this.tilemapLayer);

    // 2. Pathfinder (needs walkability grid from tilemap)
    this.pathfinder = new Pathfinder();
    this.pathfinder.initFromGrid(this.tilemapLayer.walkabilityGrid);

    // 3. Environment overlays (above tilemap, below characters)
    this.environmentOverlays = new EnvironmentOverlays();
    this.environmentOverlays.setupAll();
    this.app.stage.addChild(this.environmentOverlays);

    // 4. Character container (Y-sorted each frame)
    this.characterContainer = new Container();
    this.app.stage.addChild(this.characterContainer);

    // 5. UI container (speech bubbles, wall monitor — always on top)
    this.uiContainer = new Container();
    this.app.stage.addChild(this.uiContainer);

    // 6. Wall monitor
    this.wallMonitor = new WallMonitor();
    this.uiContainer.addChild(this.wallMonitor);
  }

  // ── Store subscriptions ─────────────────────────────────────────

  private subscribeToStores(): void {
    // Agent spawning / despawning / status updates
    this.unsubscribers.push(
      agentsStore.subscribe((agents) => this.onAgentsChanged(agents))
    );

    // Character position / state overrides from office store
    this.unsubscribers.push(
      officeStore.subscribe((positions) => this.onOfficeChanged(positions))
    );

    // Meeting state
    this.unsubscribers.push(
      meetingActive.subscribe((active) => this.onMeetingChanged(active))
    );

    // Token metrics -> wall monitor
    this.unsubscribers.push(
      metricsStore.subscribe((metrics) => this.onMetricsChanged(metrics))
    );

    // Environment storytelling overlays
    this.unsubscribers.push(
      environmentStore.subscribe((env) => this.onEnvironmentChanged(env))
    );
  }

  // ── Store change handlers ───────────────────────────────────────

  private onAgentsChanged(agents: AgentState[]): void {
    const currentIds = new Set(this.characters.keys());
    const newIds = new Set(agents.map((a) => a.role));

    // Spawn new characters
    for (const agent of agents) {
      if (!currentIds.has(agent.role)) {
        this.spawnCharacter(agent);
      } else {
        // Update existing character status
        const char = this.characters.get(agent.role);
        if (char) {
          const statusMap: Record<string, "working" | "idle" | "blocked" | "offline"> = {
            working: "working",
            idle: "idle",
            blocked: "blocked",
            offline: "offline",
          };
          char.setStatus(statusMap[agent.status] ?? "idle");
        }
      }
    }

    // Despawn characters that are no longer in the agent list
    for (const roleId of currentIds) {
      if (!newIds.has(roleId)) {
        this.despawnCharacter(roleId);
      }
    }
  }

  private onOfficeChanged(positions: CharacterPosition[]): void {
    for (const pos of positions) {
      // officeStore uses agentName which maps to role id
      const char = this.characters.get(pos.agentName);
      if (!char) continue;

      if (pos.state !== char.state) {
        if (pos.state === "walking") {
          char.setState("walking");
          this.pathfinder
            .findPath(char.tileX, char.tileY, pos.targetX, pos.targetY)
            .then((path) => char.setPath(path));
        } else if (pos.state === "talking") {
          char.setState("talking");
        } else if (pos.state === "meeting") {
          char.setState("meeting");
        } else {
          char.setState(pos.state);
        }
      }
    }
  }

  private onMeetingChanged(active: boolean): void {
    this.isMeetingActive = active;

    if (active) {
      // Move all spawned characters to meeting room
      for (const [roleId, char] of this.characters) {
        const role = ROLE_MAP.get(roleId);
        if (!role) continue;
        this.pathfinder
          .pathToMeeting(char.tileX, char.tileY, role.meetingChairIndex)
          .then((path) => {
            if (path) {
              char.setPath(path);
            }
          });
      }
    } else {
      // Send everyone back to their desks
      for (const [roleId, char] of this.characters) {
        const role = ROLE_MAP.get(roleId);
        if (!role) continue;
        if (
          char.state === "meeting" ||
          char.state === "idle" ||
          char.state === "talking"
        ) {
          this.pathToDesk(char, role);
        }
      }
    }
  }

  private onMetricsChanged(metrics: TokenMetrics): void {
    this.wallMonitor.updateMetrics(metrics, this.characters.size);
  }

  private onEnvironmentChanged(env: EnvironmentState): void {
    for (const [agentId, levels] of Object.entries(env.perAgent)) {
      this.environmentOverlays.updateLevels(agentId, {
        fileStackLevel: levels.fileStackLevel,
        coffeeCount: levels.coffeeCount,
        plantLevel: levels.plantLevel,
        trashLevel: levels.trashLevel,
      });
    }
  }

  // ── Character management ────────────────────────────────────────

  private spawnCharacter(agent: AgentState): void {
    const char = CharacterFactory.createFromAgent(agent);
    if (!char) return;

    this.characters.set(agent.role, char);
    this.characterContainer.addChild(char);

    // Path from door to desk (chair tile = deskTileY + 1)
    const role = ROLE_MAP.get(agent.role);
    if (role) {
      this.pathToDesk(char, role);
    }

    console.log(`[OfficeScene] Spawned character: ${agent.role}`);
  }

  private despawnCharacter(roleId: string): void {
    const char = this.characters.get(roleId);
    if (!char) return;

    // Set up leave-complete callback for cleanup
    char.onLeaveComplete = () => {
      this.cleanupCharacter(roleId);
    };

    // Path to door, then leave
    char.setState("leaving");
    this.pathfinder
      .pathToDoor(char.tileX, char.tileY)
      .then((path) => {
        if (path) {
          char.setPath(path);
        } else {
          // Can't find path to door — just remove immediately
          this.cleanupCharacter(roleId);
        }
      });
  }

  private cleanupCharacter(roleId: string): void {
    const char = this.characters.get(roleId);
    if (!char) return;

    // Remove speech bubble
    char.cleanupSpeechBubble();

    // Remove from display
    this.characterContainer.removeChild(char);

    // Destroy PixiJS resources
    char.destroy();

    // Remove from map
    this.characters.delete(roleId);

    console.log(`[OfficeScene] Cleaned up character: ${roleId}`);
  }

  /** Path a character to their desk's chair tile, allowing the blocked chair. */
  private pathToDesk(char: Character, role: typeof ROLES[number]): void {
    const chairX = role.deskTileX;
    const chairY = role.deskTileY + 1;

    this.pathfinder
      .findPathAllowing(
        char.tileX,
        char.tileY,
        chairX,
        chairY,
        this.tilemapLayer.walkabilityGrid
      )
      .then((path) => {
        if (path) {
          char.setPath(path);
        }
      });
  }

  // ── Game loop ───────────────────────────────────────────────────

  private gameLoop(): void {
    this.frameCount++;

    // Update all characters
    for (const char of this.characters.values()) {
      char.update(this.frameCount);

      // If character just finished walking during a meeting, switch to meeting state
      if (this.isMeetingActive && char.state === "idle") {
        char.setState("meeting");
      }
    }

    // Update wall monitor CRT effect
    this.wallMonitor.update(this.frameCount);

    // Y-sort characters for correct depth
    this.ySortCharacters();
  }

  /**
   * Sort characters by Y position so that characters further south
   * (higher Y) render on top of characters further north (lower Y).
   */
  private ySortCharacters(): void {
    const children = this.characterContainer.children;
    // Simple insertion sort — efficient for nearly-sorted arrays
    for (let i = 1; i < children.length; i++) {
      const child = children[i];
      const yVal = child.y;
      let j = i - 1;
      while (j >= 0 && children[j].y > yVal) {
        children[j + 1] = children[j];
        j--;
      }
      children[j + 1] = child;
    }
  }

  // ── Cleanup ─────────────────────────────────────────────────────

  destroy(): void {
    // Unsubscribe from all Svelte stores
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];

    // Clean up all characters
    for (const roleId of [...this.characters.keys()]) {
      this.cleanupCharacter(roleId);
    }

    // Destroy the PixiJS application
    if (this.app) {
      this.app.destroy(true);
      this.app = null;
    }
  }
}
