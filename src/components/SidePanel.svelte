<script lang="ts">
  import { teamStore } from "../lib/state/team";
  import { agentsStore } from "../lib/state/agents";
</script>

<div class="side-panel">
  <h2 class="panel-title">TEAM HUD</h2>

  <section class="panel-section">
    <h3>AGENTS</h3>
    <p class="placeholder">Waiting for team data...</p>
  </section>

  <section class="panel-section">
    <h3>TASKS</h3>
    <p class="placeholder">No active tasks</p>
  </section>

  <section class="panel-section">
    <h3>MESSAGES</h3>
    <p class="placeholder">No messages</p>
  </section>

  <section class="panel-section">
    <h3>TOKENS</h3>
    <p class="placeholder">--</p>
  </section>
</div>

<style>
  .side-panel {
    padding: 12px;
    font-family: var(--font-pixel, monospace);
    font-size: 8px;
    color: var(--text-primary, #e6f1ff);
  }
  .panel-title {
    font-size: 12px;
    text-align: center;
    margin-bottom: 16px;
    color: var(--accent-cyan, #00cccc);
    border-bottom: 2px solid var(--border, #3a3a48);
    padding-bottom: 8px;
  }
  .panel-section {
    margin-bottom: 16px;
  }
  .panel-section h3 {
    font-size: 9px;
    color: var(--accent-yellow, #ccaa22);
    margin-bottom: 6px;
  }
  .placeholder {
    color: var(--text-secondary, #7a7a88);
    font-style: italic;
  }
</style>
