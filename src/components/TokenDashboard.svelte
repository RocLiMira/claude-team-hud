<script lang="ts">
  import { onDestroy } from "svelte";
  import { metricsStore, type TokenMetrics } from "../lib/state/metrics";
  import { ROLE_MAP } from "../lib/constants/roles";

  let metrics: TokenMetrics = $state({
    totalTokens: 0,
    perAgent: {},
    burnRate: 0,
    costUsd: 0,
    rateLimitPct: 0,
    rateLimitReset: null,
  });

  const unsub = metricsStore.subscribe((v) => (metrics = v));
  onDestroy(unsub);

  function formatTokens(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
    return n.toString();
  }

  function formatCost(n: number): string {
    return "$" + n.toFixed(2);
  }

  function formatBurnRate(n: number): string {
    return n.toFixed(1) + " tok/min";
  }

  function getRateLimitColor(pct: number): string {
    if (pct >= 80) return "#cc4444";
    if (pct >= 50) return "#ccaa22";
    return "#44cc44";
  }

  /**
   * Get the color for an agent's bar based on their role.
   * Falls back to looking up by label since perAgent keys use agent names (labels).
   */
  function getAgentBarColor(agentName: string): string {
    // ROLE_MAP is keyed by role ID, but perAgent uses agent display names.
    // Search through all roles to find one matching this label.
    for (const [, cfg] of ROLE_MAP) {
      if (cfg.label === agentName) {
        return "#" + cfg.colorHex.toString(16).padStart(6, "0");
      }
    }
    return "#6688cc";
  }

  const agentEntries = $derived(
    Object.entries(metrics.perAgent).sort((a, b) => b[1] - a[1])
  );

  const maxAgentTokens = $derived(
    agentEntries.length > 0
      ? Math.max(...agentEntries.map(([, v]) => v))
      : 1
  );
</script>

<div class="token-dashboard">
  <!-- Summary stats -->
  <div class="stats-grid">
    <div class="stat">
      <span class="stat-label">TOTAL</span>
      <span class="stat-value">{formatTokens(metrics.totalTokens)}</span>
    </div>
    <div class="stat">
      <span class="stat-label">BURN</span>
      <span class="stat-value">{formatBurnRate(metrics.burnRate)}</span>
    </div>
    <div class="stat">
      <span class="stat-label">COST</span>
      <span class="stat-value cost">{formatCost(metrics.costUsd)}</span>
    </div>
  </div>

  <!-- Rate limit bar -->
  <div class="rate-limit">
    <div class="rate-label">
      <span>RATE LIMIT{metrics.rateLimitReset ? ` (resets ${metrics.rateLimitReset})` : ""}</span>
      <span style="color: {getRateLimitColor(metrics.rateLimitPct)}">
        {metrics.rateLimitPct.toFixed(0)}%
      </span>
    </div>
    <div class="rate-bar-bg">
      <div
        class="rate-bar-fill"
        style="width: {Math.min(100, metrics.rateLimitPct)}%; background: {getRateLimitColor(metrics.rateLimitPct)}"
      ></div>
    </div>
  </div>

  <!-- Per-agent breakdown -->
  {#if agentEntries.length > 0}
    <div class="agent-bars">
      <div class="bars-title">PER AGENT</div>
      {#each agentEntries as [name, tokens] (name)}
        <div class="agent-bar-row">
          <span class="agent-bar-name" title={name}>
            {name.length > 10 ? name.slice(0, 10) + ".." : name}
          </span>
          <div class="agent-bar-track">
            <div
              class="agent-bar-fill"
              style="width: {(tokens / maxAgentTokens) * 100}%; background: {getAgentBarColor(name)}"
            ></div>
          </div>
          <span class="agent-bar-value">{formatTokens(tokens)}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .token-dashboard {
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow: hidden;
  }
  .stats-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 3px;
  }
  .stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    background: #12122a;
    border: 2px solid var(--border, #3a3a48);
    padding: 3px 2px;
    overflow: hidden;
    min-width: 0;
  }
  .stat-label {
    font-family: monospace;
    font-size: 8px;
    color: var(--text-secondary, #7a7a88);
    margin-bottom: 1px;
    white-space: nowrap;
  }
  .stat-value {
    font-family: monospace;
    font-size: 8px;
    color: var(--text-primary, #e6f1ff);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .cost {
    color: var(--accent-yellow, #ccaa22);
  }
  .rate-limit {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .rate-label {
    display: flex;
    justify-content: space-between;
    font-family: monospace;
    font-size: 9px;
    color: var(--text-secondary, #7a7a88);
  }
  .rate-bar-bg {
    height: 8px;
    background: #12122a;
    border: 2px solid var(--border, #3a3a48);
    overflow: hidden;
  }
  .rate-bar-fill {
    height: 100%;
    transition: width 0.3s steps(8);
  }
  .agent-bars {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .bars-title {
    font-family: monospace;
    font-size: 9px;
    color: var(--text-secondary, #7a7a88);
    margin-bottom: 2px;
  }
  .agent-bar-row {
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .agent-bar-name {
    font-family: monospace;
    font-size: 8px;
    color: var(--text-primary, #e6f1ff);
    width: 60px;
    flex-shrink: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .agent-bar-track {
    flex: 1;
    height: 6px;
    background: #12122a;
    border: 1px solid #2a2a3a;
    overflow: hidden;
    min-width: 0;
  }
  .agent-bar-fill {
    height: 100%;
    transition: width 0.3s steps(8);
  }
  .agent-bar-value {
    font-family: monospace;
    font-size: 8px;
    color: var(--text-secondary, #7a7a88);
    width: 34px;
    text-align: right;
    flex-shrink: 0;
  }
</style>
