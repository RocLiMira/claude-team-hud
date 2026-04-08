<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import SidePanel from "./components/SidePanel.svelte";
  import { initBridge, destroyBridge } from "./lib/ipc/bridge";
  import { OfficeScene } from "./lib/engine/OfficeScene";

  let canvasContainer: HTMLDivElement;
  let officeScene: OfficeScene | null = null;
  let panelOpen = $state(false);

  function togglePanel() {
    panelOpen = !panelOpen;
  }

  onMount(async () => {
    await initBridge();
    officeScene = new OfficeScene(canvasContainer);
    await officeScene.init();
  });

  onDestroy(() => {
    officeScene?.destroy();
    destroyBridge();
  });
</script>

<div class="hud-root">
  <div class="canvas-area" bind:this={canvasContainer}></div>
  <button class="panel-toggle" onclick={togglePanel}>
    {panelOpen ? "▶" : "◀"}
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
    border: 1px solid #3a3a48;
    padding: 8px 4px;
    cursor: pointer;
    font-family: monospace;
    font-size: 14px;
  }
  .panel-toggle:hover {
    background: #2a2a3e;
  }
  .panel-area {
    width: 320px;
    min-width: 320px;
    background: #1a1a2e;
    border-left: 2px solid #3a3a48;
    overflow-y: auto;
  }
</style>
