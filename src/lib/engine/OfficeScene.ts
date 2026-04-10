import { Application, Container, TextureSource } from "pixi.js";
import { ROLE_MAP, ROLES, OFFICE, resolveRole, resetDynamicRoles } from "../constants/roles";
import { agentsStore, type AgentState } from "../state/agents";
import { officeStore, meetingActive, type CharacterPosition } from "../state/office";
import { metricsStore, environmentStore, type TokenMetrics, type EnvironmentState } from "../state/metrics";
import { messagesStore, type MessageInfo } from "../state/messages";
import { selectedAgentStore } from "../state/selection";
import { detectToolType } from "./ToolIcon";
import { TilemapLayer } from "./TilemapLayer";
import { Pathfinder } from "./Pathfinder";
import { Character } from "./Character";
import { CharacterFactory } from "./CharacterFactory";
import { WallMonitor } from "./WallMonitor";
import { EnvironmentOverlays } from "./EnvironmentOverlays";
import { loadAllAssets } from "./AssetLoader";

// Scene dimensions in pixels (native resolution)
const SCENE_W = OFFICE.MAP_WIDTH * OFFICE.TILE_SIZE;   // 640
const SCENE_H = OFFICE.MAP_HEIGHT * OFFICE.TILE_SIZE;  // 480

/**
 * Main PixiJS application managing the office scene.
 * Renders tilemap, characters, UI overlays.
 * Auto-scales to fill the window while maintaining pixel-perfect look.
 */
export class OfficeScene {
  private app: Application | null = null;
  private container: HTMLDivElement;
  private sceneContainer!: Container;

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

  // Spawn queue: stagger character entries so they walk in one by one
  private spawnQueue: AgentState[] = [];
  private spawnTimer: ReturnType<typeof setTimeout> | null = null;
  private static SPAWN_DELAY = 1500; // ms between each character spawn

  // Debounce: timestamp of last onAgentsChanged processing
  private lastAgentsUpdate = 0;

  // Message walk animation
  private lastMessageCount = 0;
  private messageWalkQueue: MessageInfo[] = [];
  private isMessageWalking = false;

  // Tool-driven animation: track which characters are at tool locations
  private atToolLocation = new Set<string>();
  private lastTaskMap = new Map<string, string | null>();

  // Tool location tile coordinates (walkable tiles adjacent to furniture)
  private static BOOKSHELF_POS = { x: 23, y: 16 };  // in front of bookshelf area
  private static SERVER_POS    = { x: 27, y: 16 };  // in front of server rack

  // Store unsubscribers
  private unsubscribers: (() => void)[] = [];

  // Resize observer
  private resizeObserver: ResizeObserver | null = null;

  constructor(container: HTMLDivElement) {
    this.container = container;
  }

  async init(): Promise<void> {
    // Pixel-perfect textures
    TextureSource.defaultOptions.scaleMode = "nearest";

    this.app = new Application();
    await this.app.init({
      width: SCENE_W * 3,  // Fixed render resolution (large enough for any display)
      height: SCENE_H * 3,
      background: 0x0a0a14,
      resolution: 1, // CSS handles display scaling
      antialias: false,
      roundPixels: true,
    });

    // Canvas fills container via CSS — no PixiJS auto-resize needed
    const canvas = this.app.canvas as HTMLCanvasElement;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.style.objectFit = "contain";
    this.container.appendChild(canvas);
    this.app.ticker.maxFPS = 30;

    console.log("[OfficeScene] Initializing, loading assets...");

    // Load all sprite assets before building the scene
    await loadAllAssets();

    console.log("[OfficeScene] Assets loaded, building scene...");

    // Scene container holds everything and gets scaled
    this.sceneContainer = new Container();
    this.app.stage.addChild(this.sceneContainer);

    this.setupLayers();
    this.updateScale();
    this.subscribeToStores();

    // Watch for container resize
    this.resizeObserver = new ResizeObserver(() => this.updateScale());
    this.resizeObserver.observe(this.container);

    // Start game loop
    this.app.ticker.add(() => this.gameLoop());

    console.log("[OfficeScene] Ready");
  }

  // ── Auto-scaling ───────────────────────────────────────────────

  /** Public method to force re-scale (called when panel toggles). */
  rescale(): void {
    // Reset cached size to force recalculation
    this.lastContainerW = 0;
    this.lastContainerH = 0;
    this.updateScale();
  }

  private lastContainerW = 0;
  private lastContainerH = 0;

  private updateScale(): void {
    if (!this.app) return;

    const containerW = this.container.clientWidth;
    const containerH = this.container.clientHeight;

    if (containerW === 0 || containerH === 0) return;
    if (containerW === this.lastContainerW && containerH === this.lastContainerH) return;

    this.lastContainerW = containerW;
    this.lastContainerH = containerH;

    // Canvas is fixed at SCENE_W*3 x SCENE_H*3, CSS scales it to fit container.
    // We scale the sceneContainer within the fixed canvas.
    const canvasW = SCENE_W * 3;
    const canvasH = SCENE_H * 3;

    // Scene scale: fit the 640x480 scene into the fixed canvas
    const scaleX = canvasW / SCENE_W;
    const scaleY = canvasH / SCENE_H;
    const pixelScale = Math.min(scaleX, scaleY);

    this.sceneContainer.scale.set(pixelScale);

    // Center the scene within the fixed canvas
    const scaledW = SCENE_W * pixelScale;
    const scaledH = SCENE_H * pixelScale;
    this.sceneContainer.x = Math.round((canvasW - scaledW) / 2);
    this.sceneContainer.y = Math.round((canvasH - scaledH) / 2);
  }

  // ── Layer setup ────────────────────────────────────────────────

  private setupLayers(): void {
    if (!this.app) return;

    // 1. Tilemap
    this.tilemapLayer = new TilemapLayer();
    this.tilemapLayer.build();
    this.sceneContainer.addChild(this.tilemapLayer);

    // 2. Pathfinder
    this.pathfinder = new Pathfinder();
    this.pathfinder.initFromGrid(this.tilemapLayer.walkabilityGrid);

    // Debug: verify walkability
    const wg = this.tilemapLayer.walkabilityGrid;
    console.log(`[OfficeScene] Grid: ${wg[0]?.length}x${wg.length}`);
    console.log(`[OfficeScene] Door(${OFFICE.DOOR_X},${OFFICE.DOOR_Y})=${wg[OFFICE.DOOR_Y]?.[OFFICE.DOOR_X]}, Above(${OFFICE.DOOR_X},${OFFICE.DOOR_Y - 1})=${wg[OFFICE.DOOR_Y - 1]?.[OFFICE.DOOR_X]}`);

    // 3. Environment overlays
    this.environmentOverlays = new EnvironmentOverlays();
    this.environmentOverlays.setupAll();
    this.sceneContainer.addChild(this.environmentOverlays);

    // 4. Character container
    this.characterContainer = new Container();
    this.sceneContainer.addChild(this.characterContainer);

    // 5. UI container
    this.uiContainer = new Container();
    this.sceneContainer.addChild(this.uiContainer);

    // 6. Wall monitor
    this.wallMonitor = new WallMonitor();
    this.uiContainer.addChild(this.wallMonitor);

  }

  // ── Store subscriptions ────────────────────────────────────────

  private subscribeToStores(): void {
    this.unsubscribers.push(
      agentsStore.subscribe((agents) => this.onAgentsChanged(agents))
    );
    this.unsubscribers.push(
      officeStore.subscribe((positions) => this.onOfficeChanged(positions))
    );
    this.unsubscribers.push(
      meetingActive.subscribe((active) => this.onMeetingChanged(active))
    );
    this.unsubscribers.push(
      metricsStore.subscribe((metrics) => this.onMetricsChanged(metrics))
    );
    this.unsubscribers.push(
      environmentStore.subscribe((env) => this.onEnvironmentChanged(env))
    );
    this.unsubscribers.push(
      messagesStore.subscribe((msgs) => this.onMessagesChanged(msgs))
    );
  }

  // ── Store change handlers ──────────────────────────────────────

  private onAgentsChanged(agents: AgentState[]): void {
    // Debounce: skip if called within 400ms of last processing
    const now = Date.now();
    if (now - this.lastAgentsUpdate < 400) return;
    this.lastAgentsUpdate = now;

    const currentIds = new Set(this.characters.keys());
    const queuedIds = new Set(this.spawnQueue.map((a) => a.role));
    const newIds = new Set(agents.map((a) => a.role));

    // Smart spawn: if scene is empty and agents arrive, teleport to desk
    const shouldTeleport = this.characters.size === 0 && this.spawnQueue.length === 0 && agents.length > 0;

    for (const agent of agents) {
      if (!currentIds.has(agent.role) && !queuedIds.has(agent.role)) {
        (agent as AgentState & { _teleport?: boolean })._teleport = shouldTeleport;
        this.spawnQueue.push(agent);
      } else if (currentIds.has(agent.role)) {
        const char = this.characters.get(agent.role);
        if (char) {
          const statusMap: Record<string, "working" | "idle" | "blocked" | "offline"> = {
            working: "working", idle: "idle", blocked: "blocked", offline: "offline",
          };
          char.setStatus(statusMap[agent.status] ?? "idle");

          const prevTask = this.lastTaskMap.get(agent.role);
          if (agent.currentTask !== prevTask) {
            this.lastTaskMap.set(agent.role, agent.currentTask ?? null);
            this.handleToolAnimation(agent.role, char, agent.currentTask);
          }
        }
      }
    }

    this.processSpawnQueue();

    for (const roleId of currentIds) {
      if (!newIds.has(roleId)) {
        const char = this.characters.get(roleId);
        if (char && char.state !== "leaving") {
          this.despawnCharacter(roleId);
        }
      }
    }
  }

  private processSpawnQueue(): void {
    if (this.spawnTimer || this.spawnQueue.length === 0) return;

    // Spawn the first one immediately
    const agent = this.spawnQueue.shift()!;
    this.spawnCharacter(agent);

    if (this.spawnQueue.length > 0) {
      const nextIsTeleport = (this.spawnQueue[0] as AgentState & { _teleport?: boolean })._teleport === true;
      const delay = nextIsTeleport ? 0 : OfficeScene.SPAWN_DELAY;
      this.spawnTimer = setTimeout(() => {
        this.spawnTimer = null;
        this.processSpawnQueue();
      }, delay);
    }
  }

  private onOfficeChanged(positions: CharacterPosition[]): void {
    for (const pos of positions) {
      const char = this.characters.get(pos.agentName);
      if (!char) continue;

      // Don't interrupt characters that are walking to their desk or leaving
      if (char.state === "entering" || char.state === "walking" || char.state === "leaving") {
        continue;
      }

      if (pos.state !== char.state) {
        if (pos.state === "walking") {
          char.setState("walking");
          this.pathfinder
            .findPathAllowing(char.tileX, char.tileY, pos.targetX, pos.targetY, this.tilemapLayer.walkabilityGrid)
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
      for (const [roleId, char] of this.characters) {
        const role = resolveRole(roleId);
        if (!role) continue;
        this.pathfinder
          .pathToMeeting(char.tileX, char.tileY, role.meetingChairIndex, this.tilemapLayer.walkabilityGrid)
          .then((path) => { if (path) char.setPath(path); });
      }
    } else {
      for (const [roleId, char] of this.characters) {
        const role = resolveRole(roleId);
        if (!role) continue;
        if (char.state === "meeting" || char.state === "idle" || char.state === "talking") {
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

  // ── Tool-driven animation ──────────────────────────────────────

  private handleToolAnimation(roleId: string, char: Character, task: string | null | undefined): void {
    // Update tool icon based on current task
    const toolType = detectToolType(task);
    char.showTool(toolType);

    // Skip movement if character is busy
    if (char.state === "walking" || char.state === "entering" || char.state === "leaving") return;

    const role = resolveRole(roleId);
    if (!role) return;

    if (!task) {
      // No task — return to desk if at a tool location
      if (this.atToolLocation.has(roleId)) {
        this.atToolLocation.delete(roleId);
        this.pathToDesk(char, role);
      }
      char.hideTool();
      return;
    }

    const taskLower = task.toLowerCase();

    // Detect tool type from task description
    let target: { x: number; y: number } | null = null;

    if (/\b(search|web|research|browse|document|read|review)\b/.test(taskLower)) {
      target = OfficeScene.BOOKSHELF_POS;
    } else if (/\b(deploy|build|test|bash|server|ci|cd|docker|run|exec)\b/.test(taskLower)) {
      target = OfficeScene.SERVER_POS;
    }

    if (target && !this.atToolLocation.has(roleId)) {
      this.atToolLocation.add(roleId);
      this.pathfinder
        .findPathAllowing(char.tileX, char.tileY, target.x, target.y, this.tilemapLayer.walkabilityGrid)
        .then((path) => {
          if (path && path.length > 0) {
            char.setPath(path);
          }
        });
    } else if (!target && this.atToolLocation.has(roleId)) {
      // Task changed to something non-tool, return to desk
      this.atToolLocation.delete(roleId);
      this.pathToDesk(char, role);
    }
  }

  // ── Message walk animation ─────────────────────────────────────

  private onMessagesChanged(messages: MessageInfo[]): void {
    if (messages.length <= this.lastMessageCount) {
      this.lastMessageCount = messages.length;
      return;
    }

    // Process only new messages
    const newMessages = messages.slice(this.lastMessageCount);
    this.lastMessageCount = messages.length;

    for (const msg of newMessages) {
      // Skip JSON system messages
      if (msg.text.startsWith("{")) {
        try { if (typeof JSON.parse(msg.text).type === "string") continue; } catch {}
      }
      this.messageWalkQueue.push(msg);
    }

    this.processMessageWalkQueue();
  }

  private processMessageWalkQueue(): void {
    if (this.isMessageWalking || this.messageWalkQueue.length === 0) return;

    const msg = this.messageWalkQueue.shift()!;
    const senderChar = this.findCharByName(msg.from);
    const recipientChar = this.findCharByName(msg.to);

    if (!senderChar || !recipientChar) {
      // Can't animate, skip to next
      this.processMessageWalkQueue();
      return;
    }

    // Don't interrupt characters that are already walking somewhere
    if (senderChar.state === "walking" || senderChar.state === "entering" || senderChar.state === "leaving") {
      this.processMessageWalkQueue();
      return;
    }

    this.isMessageWalking = true;
    const senderRoleId = [...this.characters.entries()].find(([, c]) => c === senderChar)?.[0] ?? "";
    const senderRole = resolveRole(senderRoleId);

    // Step 1: Walk sender to recipient's position
    const targetX = recipientChar.tileX;
    const targetY = recipientChar.tileY + 1; // Stand one tile below recipient
    this.pathfinder
      .findPathAllowing(senderChar.tileX, senderChar.tileY, targetX, targetY, this.tilemapLayer.walkabilityGrid)
      .then((path) => {
        if (path && path.length > 0) {
          senderChar.setPath(path);

          // Wait for arrival, then show bubble and walk back
          const checkArrival = () => {
            if (senderChar.state !== "walking") {
              // Arrived — show speech bubble
              senderChar.showSpeech(msg.text);

              // Step 2: After bubble finishes (~3s), walk back to own desk
              setTimeout(() => {
                if (senderRole) {
                  this.pathToDesk(senderChar, senderRole);
                }
                this.isMessageWalking = false;
                this.processMessageWalkQueue();
              }, 3500);
            } else {
              setTimeout(checkArrival, 200);
            }
          };
          setTimeout(checkArrival, 200);
        } else {
          // No path — just show bubble at current position
          senderChar.showSpeech(msg.text);
          this.isMessageWalking = false;
          setTimeout(() => this.processMessageWalkQueue(), 3500);
        }
      });
  }

  /** Find a character by agent display name (matches both role key and name). */
  private findCharByName(name: string): Character | null {
    // Direct match by role key
    const direct = this.characters.get(name);
    if (direct) return direct;

    // Match by role label
    for (const [roleId, char] of this.characters) {
      const role = resolveRole(roleId);
      if (role && (role.label === name || role.tag === name)) return char;
    }
    return null;
  }

  // ── Character management ───────────────────────────────────────

  private spawnCharacter(agent: AgentState): void {
    console.log(`[OfficeScene] Spawning: role="${agent.role}", name="${agent.name}"`);
    const char = CharacterFactory.createFromAgent(agent);
    if (!char) {
      console.warn(`[OfficeScene] Unknown role "${agent.role}"`);
      return;
    }

    this.characters.set(agent.role, char);
    this.characterContainer.addChild(char);

    // Click to view agent's pane content
    char.onClicked = () => {
      selectedAgentStore.set({
        name: agent.name,
        role: agent.role,
        paneId: agent.paneId ?? "",
      });
    };

    const role = resolveRole(agent.role);
    const shouldTeleport = (agent as AgentState & { _teleport?: boolean })._teleport === true;
    if (role) {
      if (shouldTeleport) {
        const TILE = OFFICE.TILE_SIZE;
        const chairX = role.deskTileX;
        const chairY = role.deskTileY + 2;
        char.tileX = chairX;
        char.tileY = chairY;
        char.pixelX = chairX * TILE + TILE / 2;
        char.pixelY = chairY * TILE + TILE / 2;
        char.x = char.pixelX;
        char.y = char.pixelY;
        char.setState("idle");
      } else {
        this.pathToDesk(char, role);
      }
    }
  }

  private despawnCharacter(roleId: string): void {
    const char = this.characters.get(roleId);
    if (!char) return;

    char.onLeaveComplete = () => this.cleanupCharacter(roleId);
    char.setState("leaving");

    this.pathfinder
      .pathToDoor(char.tileX, char.tileY, this.tilemapLayer.walkabilityGrid)
      .then((path) => {
        if (path && path.length > 1) {
          char.setPath(path);
        } else {
          // Already at door or no valid path — cleanup immediately
          this.cleanupCharacter(roleId);
        }
      });

    // Fallback: force cleanup after 15 seconds in case path never completes
    setTimeout(() => {
      if (this.characters.has(roleId)) {
        this.cleanupCharacter(roleId);
      }
    }, 15000);
  }

  private cleanupCharacter(roleId: string): void {
    const char = this.characters.get(roleId);
    if (!char) return;
    char.visible = false; // Immediately hide (works within current render frame)
    char.cleanupSpeechBubble();
    this.characterContainer.removeChild(char);
    char.destroy();
    this.characters.delete(roleId);
  }

  private pathToDesk(char: Character, role: typeof ROLES[number]): void {
    const chairX = role.deskTileX;
    const chairY = role.deskTileY + 2; // chair is 2 tiles below desk top (desk is 2 tall)
    const TILE = OFFICE.TILE_SIZE;

    this.pathfinder
      .pathToDesk(char.tileX, char.tileY, role, this.tilemapLayer.walkabilityGrid)
      .then((path) => {
        if (path && path.length > 0) {
          console.log(`[OfficeScene] Pathing ${role.id} to chair (${chairX},${chairY}): ${path.length} steps`);
          char.setPath(path);
        } else {
          // Fallback: teleport directly if pathfinding fails
          console.warn(`[OfficeScene] No path for ${role.id}, teleporting to chair (${chairX},${chairY})`);
          char.tileX = chairX;
          char.tileY = chairY;
          char.pixelX = chairX * TILE + TILE / 2;
          char.pixelY = chairY * TILE + TILE / 2;
          char.x = char.pixelX;
          char.y = char.pixelY;
          char.setState("idle");
        }
      });
  }

  // ── Game loop ──────────────────────────────────────────────────

  private gameLoop(): void {
    this.frameCount++;

    // Collect characters to cleanup (can't modify map during iteration)
    const toCleanup: string[] = [];

    for (const [roleId, char] of this.characters) {
      char.update(this.frameCount);

      if (this.isMeetingActive && char.state === "idle") {
        char.setState("meeting");
      }

      // Force cleanup: leaving characters by frame age (doesn't depend on callbacks)
      if (char.state === "leaving") {
        if (char.leaveStartFrame < 0) char.leaveStartFrame = this.frameCount;
        const leaveAge = this.frameCount - char.leaveStartFrame;
        // Cleanup if: near door with no path, OR been leaving for 10+ seconds
        if (leaveAge > 300 || (!char.path && leaveAge > 30)) {
          toCleanup.push(roleId);
        }
      }
    }

    for (const roleId of toCleanup) {
      this.cleanupCharacter(roleId);
    }

    this.wallMonitor.update(this.frameCount);
    this.ySortCharacters();

    // Poll container size every 15 frames (~0.5s) to catch resize misses
    if (this.frameCount % 15 === 0) {
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      if (w !== this.lastContainerW || h !== this.lastContainerH) {
        this.lastContainerW = 0; // force recalc
        this.updateScale();
      }
    }
  }

  private ySortCharacters(): void {
    const children = this.characterContainer.children;
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

  // ── Force reset (team change) ──────────────────────────────────

  /** Immediately remove all characters and reset state. No walk animations. */
  forceReset(): void {
    // Clear spawn queue
    this.spawnQueue = [];
    if (this.spawnTimer) {
      clearTimeout(this.spawnTimer);
      this.spawnTimer = null;
    }

    // Force remove all characters immediately
    for (const roleId of [...this.characters.keys()]) {
      this.cleanupCharacter(roleId);
    }

    // Reset message walk state
    this.messageWalkQueue = [];
    this.isMessageWalking = false;
    this.lastMessageCount = 0;

    // Reset tool animation state
    this.atToolLocation.clear();
    this.lastTaskMap.clear();

    // Reset meeting state
    this.isMeetingActive = false;

    // Reset dynamic role assignments
    resetDynamicRoles();

    // After reset, characters.size === 0, so onAgentsChanged will auto-teleport

    // Force re-scale
    this.updateScale();

    console.log("[OfficeScene] Force reset complete");
  }

  // ── Cleanup ────────────────────────────────────────────────────

  destroy(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.spawnTimer) {
      clearTimeout(this.spawnTimer);
      this.spawnTimer = null;
    }

    for (const roleId of [...this.characters.keys()]) {
      this.cleanupCharacter(roleId);
    }

    if (this.app) {
      this.app.destroy(true);
      this.app = null;
    }
  }
}
