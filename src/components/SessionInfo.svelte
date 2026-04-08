<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { teamStore } from "../lib/state/team";
  import { agentsStore } from "../lib/state/agents";

  let team: typeof $teamStore = $state(null);
  let agents: typeof $agentsStore = $state([]);
  let elapsed = $state("00:00:00");
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;

  const unsubTeam = teamStore.subscribe((v) => (team = v));
  const unsubAgents = agentsStore.subscribe((v) => (agents = v));

  function formatElapsed(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return [h, m, s].map((n) => n.toString().padStart(2, "0")).join(":");
  }

  function formatTime(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "--:--:--";
    return d.toLocaleTimeString("en-US", { hour12: false });
  }

  function updateElapsed() {
    if (!team?.activeSince) {
      elapsed = "00:00:00";
      return;
    }
    const start = new Date(team.activeSince).getTime();
    if (isNaN(start)) {
      elapsed = "00:00:00";
      return;
    }
    elapsed = formatElapsed(Date.now() - start);
  }

  onMount(() => {
    updateElapsed();
    elapsedTimer = setInterval(updateElapsed, 1000);
  });

  onDestroy(() => {
    if (elapsedTimer) clearInterval(elapsedTimer);
    unsubTeam();
    unsubAgents();
  });

  const activeCount = $derived(
    agents.filter((a) => a.status !== "offline").length
  );
</script>

<div class="session-info">
  {#if team}
    <div class="info-row">
      <span class="label">TEAM</span>
      <span class="value team-name">{team.name}</span>
    </div>
    <div class="info-row">
      <span class="label">START</span>
      <span class="value">{formatTime(team.activeSince)}</span>
    </div>
    <div class="info-row">
      <span class="label">ELAPSED</span>
      <span class="value elapsed">{elapsed}</span>
    </div>
    <div class="info-row">
      <span class="label">AGENTS</span>
      <span class="value">{activeCount}/{agents.length}</span>
    </div>
  {:else}
    <p class="placeholder">No session active</p>
  {/if}
</div>

<style>
  .session-info {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .label {
    font-family: var(--font-pixel, monospace);
    font-size: 7px;
    color: var(--text-secondary, #7a7a88);
    text-transform: uppercase;
  }
  .value {
    font-family: monospace;
    font-size: 10px;
    color: var(--text-primary, #e6f1ff);
  }
  .team-name {
    color: var(--accent-cyan, #00cccc);
    font-family: var(--font-pixel, monospace);
    font-size: 9px;
  }
  .elapsed {
    color: var(--accent-yellow, #ccaa22);
    font-family: var(--font-pixel, monospace);
  }
  .placeholder {
    color: var(--text-secondary, #7a7a88);
    font-style: italic;
    font-size: 8px;
  }
</style>
