<script lang="ts">
  import "./app.css";
  import { onMount, onDestroy } from "svelte";
  import SidePanel from "./components/SidePanel.svelte";
  import {
    initBridge,
    destroyBridge,
    switchTeam,
    availableTeams,
    activeTeam,
    bridgeReady,
  } from "./lib/ipc/bridge";
  import { OfficeScene } from "./lib/engine/OfficeScene";

  let canvasContainer: HTMLDivElement;
  let officeScene: OfficeScene | null = null;
  let panelOpen = $state(false);
  let teams: string[] = $state([]);
  let currentTeam: string | null = $state(null);
  let ready = $state(false);

  const unsubTeams = availableTeams.subscribe((v) => (teams = v));
  const unsubActive = activeTeam.subscribe((v) => (currentTeam = v));
  const unsubReady = bridgeReady.subscribe((v) => (ready = v));

  function togglePanel() {
    panelOpen = !panelOpen;
  }

  function handleKeydown(e: KeyboardEvent) {
    // Tab toggles panel, but not when an input is focused
    if (
      e.key === "Tab" &&
      !(e.target instanceof HTMLInputElement) &&
      !(e.target instanceof HTMLTextAreaElement)
    ) {
      e.preventDefault();
      togglePanel();
    }
  }

  async function handleTeamChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    await switchTeam(select.value);
  }

  onMount(async () => {
    await initBridge();
    officeScene = new OfficeScene(canvasContainer);
    await officeScene.init();
  });

  onDestroy(() => {
    officeScene?.destroy();
    destroyBridge();
    unsubTeams();
    unsubActive();
    unsubReady();
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="hud-root">
  <div class="canvas-area" bind:this={canvasContainer}>
    <!-- No Active Team overlay -->
    {#if ready && currentTeam === null}
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

    <!-- Team selector (when multiple teams) -->
    {#if teams.length > 1}
      <div class="team-selector">
        <label class="team-selector-label" for="team-select">TEAM:</label>
        <select
          id="team-select"
          class="team-select"
          onchange={handleTeamChange}
          value={currentTeam ?? ""}
        >
          {#each teams as team (team)}
            <option value={team}>{team}</option>
          {/each}
        </select>
      </div>
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
    <div class="panel-area">
      <SidePanel />
    </div>
  {/if}
</div>

<style>
  .hud-root {
    display: flex;
    width: 100vw;
    height: 100vh;
    background: #0a0a14;
    overflow: hidden;
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
    font-size: 14px;
  }
  .panel-toggle:hover {
    background: #2a2a3e;
  }
  .panel-toggle-shifted {
    right: 320px;
  }
  .panel-area {
    width: 320px;
    min-width: 320px;
    background: #1a1a2e;
    border-left: 2px solid #3a3a48;
    overflow-y: auto;
    height: 100%;
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
    font-size: 14px;
    color: var(--accent-red, #cc4444);
    margin-bottom: 12px;
  }
  .no-team-text {
    font-family: monospace;
    font-size: 11px;
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
    font-size: 8px;
    color: var(--text-secondary, #7a7a88);
  }
  .team-select {
    font-family: monospace;
    font-size: 10px;
    color: var(--accent-cyan, #00cccc);
    background: #12122a;
    border: 1px solid #3a3a48;
    padding: 2px 4px;
    cursor: pointer;
  }
  .team-select:focus {
    outline: 1px solid var(--accent-cyan, #00cccc);
  }
</style>
