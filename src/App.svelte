<script lang="ts">
  import "./app.css";
  import { onMount, onDestroy } from "svelte";
  import SidePanel from "./components/SidePanel.svelte";
  import MessageLog from "./components/MessageLog.svelte";
  import MessageInput from "./components/MessageInput.svelte";
  import PermissionDialog from "./components/PermissionDialog.svelte";
  import PaneViewer from "./components/PaneViewer.svelte";
  import {
    initBridge,
    destroyBridge,
    switchTeam,
    availableTeams,
    activeTeam,
    bridgeReady,
    clearStores,
  } from "./lib/ipc/bridge";
  import { OfficeScene } from "./lib/engine/OfficeScene";
  import { BuildingScene } from "./lib/engine/BuildingScene";
  import { allTeamsStore } from "./lib/state/multiTeam";
  import type { TeamSnapshot } from "./lib/ipc/types";

  let canvasContainer: HTMLDivElement;
  let buildingContainer: HTMLDivElement;
  let officeScene: OfficeScene | null = null;
  let buildingScene: BuildingScene | null = null;
  let panelOpen = $state(false);
  let teams: string[] = $state([]);
  let currentTeam: string | null = $state(null);
  let ready = $state(false);
  let viewMode: "building" | "floor" = $state("building");
  let allTeamSnapshots = $state(new Map<string, TeamSnapshot>());

  const unsubTeams = availableTeams.subscribe((v) => (teams = v));
  const unsubActive = activeTeam.subscribe((v) => {
    // Don't auto-reset here — enterFloor handles forceReset explicitly
    currentTeam = v;
  });
  const unsubReady = bridgeReady.subscribe((v) => (ready = v));
  const unsubAllTeams = allTeamsStore.subscribe((v) => {
    allTeamSnapshots = v;
    if (buildingScene && viewMode === "building") {
      buildingScene.update(v);
    }
  });

  function togglePanel() {
    panelOpen = !panelOpen;
    // Force re-scale after panel CSS transition settles
    if (officeScene) {
      requestAnimationFrame(() => {
        officeScene?.rescale();
        // Double-tap for WKWebView
        setTimeout(() => officeScene?.rescale(), 100);
      });
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (
      e.key === "Tab" &&
      !(e.target instanceof HTMLInputElement) &&
      !(e.target instanceof HTMLTextAreaElement)
    ) {
      e.preventDefault();
      togglePanel();
    }
    // ESC returns to building view
    if (e.key === "Escape" && viewMode === "floor") {
      exitFloor();
    }
  }

  async function handleTeamChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    await switchTeam(select.value);
  }

  // Force WKWebView repaint every 2s (workaround for stale DOM rendering)
  let repaintTick = $state(0);
  let repaintInterval: ReturnType<typeof setInterval> | null = null;

  async function enterFloor(teamName: string) {
    // 1. Reset scene FIRST
    if (officeScene) officeScene.forceReset();
    // 2. Clear stores
    clearStores();
    // 3. Switch to new team BEFORE showing floor view
    //    This ensures fresh snapshot is fetched and applied
    await switchTeam(teamName);
    // 4. Only now switch view (data is ready)
    viewMode = "floor";
    // 5. Rescale
    requestAnimationFrame(() => {
      officeScene?.rescale();
      setTimeout(() => officeScene?.rescale(), 200);
    });
  }

  function exitFloor() {
    viewMode = "building";
    if (buildingScene) {
      buildingScene.update(allTeamSnapshots);
    }
  }

  onMount(async () => {
    await initBridge();

    // Init office scene (floor view)
    officeScene = new OfficeScene(canvasContainer);
    await officeScene.init();

    // Init building scene (overview)
    buildingScene = new BuildingScene(buildingContainer);
    await buildingScene.init((teamName) => enterFloor(teamName));

    // Auto-select view: building if multiple teams, floor if single
    if (teams.length <= 1 && currentTeam) {
      viewMode = "floor";
    }

    repaintInterval = setInterval(() => {
      repaintTick = Date.now();
    }, 2000);
  });

  onDestroy(() => {
    officeScene?.destroy();
    buildingScene?.destroy();
    destroyBridge();
    unsubTeams();
    unsubActive();
    unsubReady();
    unsubAllTeams();
    if (repaintInterval) clearInterval(repaintInterval);
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<PermissionDialog />
<PaneViewer />
<div class="hud-root">
  <!-- Top area: canvas + info panel -->
  <div class="top-area">
    <!-- Building view -->
    <div class="canvas-area" bind:this={buildingContainer}
      style:display={viewMode === "building" ? "block" : "none"}>
      {#if ready && teams.length === 0}
        <div class="no-team-overlay">
          <div class="no-team-box">
            <h2 class="no-team-title">NO ACTIVE TEAM</h2>
            <p class="no-team-text">
              No team directories found.<br />
              Create a team in ~/.claude/teams/ to get started.
            </p>
          </div>
        </div>
      {/if}
    </div>

    <!-- Floor view -->
    <div class="canvas-area" bind:this={canvasContainer}
      style:display={viewMode === "floor" ? "block" : "none"}>
      {#if viewMode === "floor"}
        <button class="back-btn" onclick={exitFloor}>← BUILDING</button>
      {/if}
    </div>

    <button
      class="panel-toggle"
      class:panel-toggle-shifted={panelOpen}
      onclick={togglePanel}
    >
      {panelOpen ? "\u25B6" : "\u25C0"}
    </button>

    {#if panelOpen}
      <div class="panel-area info-panel" data-tick={repaintTick}>
        <SidePanel />
      </div>
    {/if}
  </div>

  <!-- Bottom area: messages (only in floor view) -->
  {#if viewMode === "floor"}
  <div class="bottom-area" data-tick={repaintTick}>
    <div class="msg-header-bar">
      <span class="msg-title">MESSAGES</span>
      <MessageInput />
    </div>
    <div class="msg-body">
      <MessageLog />
    </div>
  </div>
  {/if}
</div>

<style>
  .hud-root {
    display: flex;
    flex-direction: column;
    width: 100vw;
    height: 100vh;
    background: #0a0a14;
    overflow: hidden;
  }
  .top-area {
    display: flex;
    flex: 1;
    min-height: 0;
    position: relative;
  }
  .canvas-area {
    flex: 1;
    position: relative;
    min-width: 0;
  }
  .panel-toggle {
    position: absolute;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    z-index: 100;
    background: #1a1a2e;
    color: #e6f1ff;
    border: 2px solid #3a3a48;
    padding: 8px 4px;
    cursor: pointer;
    font-family: monospace;
    font-size: 16px;
  }
  .panel-toggle:hover {
    background: #2a2a3e;
  }
  .panel-toggle-shifted {
    right: 340px;
  }
  .panel-area {
    background: #1a1a2e;
    border-left: 2px solid #3a3a48;
    overflow-y: auto;
    height: 100%;
    will-change: contents;
    transform: translateZ(0);
  }
  .info-panel {
    width: 340px;
    min-width: 340px;
  }
  /* Bottom message area */
  .bottom-area {
    height: 180px;
    min-height: 120px;
    background: #1a1a2e;
    border-top: 2px solid #3a3a48;
    display: flex;
    flex-direction: column;
    font-family: var(--font-pixel, monospace);
  }
  .msg-header-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 4px 12px;
    background: #12122a;
    border-bottom: 1px solid #3a3a48;
    flex-shrink: 0;
  }
  .msg-title {
    font-size: 11px;
    color: var(--accent-yellow, #ccaa22);
    letter-spacing: 2px;
    flex-shrink: 0;
  }
  .msg-body {
    flex: 1;
    overflow: hidden;
  }
  /* Pixel-art scrollbar for panel */
  .panel-area::-webkit-scrollbar {
    width: 6px;
  }
  .panel-area::-webkit-scrollbar-track {
    background: #12122a;
  }
  .panel-area::-webkit-scrollbar-thumb {
    background: #3a3a48;
  }

  /* No Active Team overlay */
  .no-team-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(10, 10, 20, 0.85);
    z-index: 50;
  }
  .no-team-box {
    border: 2px solid #3a3a48;
    background: #1a1a2e;
    padding: 32px 40px;
    text-align: center;
  }
  .no-team-title {
    font-family: var(--font-pixel, monospace);
    font-size: 16px;
    color: var(--accent-red, #cc4444);
    margin-bottom: 12px;
  }
  .no-team-text {
    font-family: monospace;
    font-size: 13px;
    color: var(--text-secondary, #7a7a88);
    line-height: 1.6;
  }

  /* Team selector */
  .team-selector {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 60;
    display: flex;
    align-items: center;
    gap: 6px;
    background: #1a1a2e;
    border: 2px solid #3a3a48;
    padding: 4px 8px;
  }
  .team-selector-label {
    font-family: var(--font-pixel, monospace);
    font-size: 11px;
    color: var(--text-secondary, #7a7a88);
  }
  .team-select {
    font-family: monospace;
    font-size: 13px;
    color: var(--accent-cyan, #00cccc);
    background: #12122a;
    border: 1px solid #3a3a48;
    padding: 2px 4px;
    cursor: pointer;
  }
  .team-select:focus {
    outline: 1px solid var(--accent-cyan, #00cccc);
  }
  /* Back to building button */
  .back-btn {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 60;
    font-family: var(--font-pixel, monospace);
    font-size: 12px;
    color: #00cccc;
    background: #1a1a2e;
    border: 2px solid #3a3a48;
    padding: 4px 12px;
    cursor: pointer;
    letter-spacing: 1px;
  }
  .back-btn:hover {
    background: #2a2a3e;
  }
</style>
