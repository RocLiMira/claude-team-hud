<script lang="ts">
  import { onDestroy } from "svelte";
  import { agentsStore, type AgentState } from "../lib/state/agents";
  import { ROLE_MAP } from "../lib/constants/roles";

  let agents: AgentState[] = $state([]);
  const unsub = agentsStore.subscribe((v) => (agents = v));
  onDestroy(unsub);

  const LAYER_ORDER: Record<string, number> = {
    management: 0,
    executive: 1,
    technical: 2,
    execution: 3,
  };

  const sorted = $derived(
    [...agents].sort((a, b) => {
      const roleA = ROLE_MAP.get(a.role);
      const roleB = ROLE_MAP.get(b.role);
      const layerA = roleA ? LAYER_ORDER[roleA.layer] ?? 99 : 99;
      const layerB = roleB ? LAYER_ORDER[roleB.layer] ?? 99 : 99;
      return layerA - layerB;
    })
  );

  function getRoleColor(role: string): string {
    const cfg = ROLE_MAP.get(role);
    if (!cfg) return "#7a7a88";
    return "#" + cfg.colorHex.toString(16).padStart(6, "0");
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case "working": return "#44cc44";
      case "idle": return "#6688cc";
      case "blocked": return "#cc4444";
      case "offline": return "#7a7a88";
      default: return "#7a7a88";
    }
  }

  function truncate(s: string | null, max: number): string {
    if (!s) return "--";
    return s.length > max ? s.slice(0, max) + ".." : s;
  }

  function getRoleTag(role: string): string {
    const cfg = ROLE_MAP.get(role);
    return cfg ? cfg.tag : role.toUpperCase().slice(0, 4);
  }
</script>

<div class="roster">
  {#if sorted.length === 0}
    <p class="placeholder">Waiting for agents...</p>
  {:else}
    <table class="roster-table">
      <thead>
        <tr>
          <th></th>
          <th>NAME</th>
          <th>STATUS</th>
          <th>TASK</th>
          <th>MDL</th>
        </tr>
      </thead>
      <tbody>
        {#each sorted as agent (agent.name)}
          <tr class="agent-row">
            <td class="role-dot-cell">
              <span
                class="role-dot"
                style="background: {getRoleColor(agent.role)}"
                title={getRoleTag(agent.role)}
              ></span>
            </td>
            <td class="name-cell" title={agent.name}>
              <span class="role-tag">{getRoleTag(agent.role)}</span>
            </td>
            <td>
              <span
                class="status-badge"
                style="background: {getStatusColor(agent.status)}"
              >
                {agent.status.toUpperCase().slice(0, 4)}
              </span>
            </td>
            <td class="task-cell" title={agent.currentTask ?? ""}>
              {truncate(agent.currentTask, 15)}
            </td>
            <td class="model-cell">
              {agent.model.includes("opus") ? "OPU" : "SON"}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .roster {
    overflow-x: hidden;
  }
  .roster-table {
    width: 100%;
    border-collapse: collapse;
    font-family: monospace;
    font-size: 9px;
    border: 2px solid var(--border, #3a3a48);
    table-layout: fixed;
  }
  thead tr {
    background: #12122a;
  }
  th {
    font-family: monospace;
    font-size: 9px;
    color: var(--text-secondary, #7a7a88);
    text-align: left;
    padding: 3px 2px;
    border-bottom: 2px solid var(--border, #3a3a48);
    overflow: hidden;
  }
  th:nth-child(1) { width: 14px; }
  th:nth-child(2) { width: 60px; }
  th:nth-child(3) { width: 50px; }
  th:nth-child(4) { /* flex: auto via table-layout */ }
  th:nth-child(5) { width: 32px; }
  .agent-row {
    border-bottom: 1px solid #2a2a3a;
  }
  .agent-row:hover {
    background: #22223a;
  }
  td {
    padding: 2px 2px;
    vertical-align: middle;
    color: var(--text-primary, #e6f1ff);
    font-family: monospace;
    font-size: 9px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .role-dot-cell {
    width: 14px;
    text-align: center;
  }
  .role-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    /* Pixel-art: no border-radius */
  }
  .name-cell {
    white-space: nowrap;
    width: 60px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .role-tag {
    font-family: monospace;
    font-size: 9px;
    color: var(--text-primary, #e6f1ff);
  }
  .status-badge {
    display: inline-block;
    padding: 1px 3px;
    font-family: monospace;
    font-size: 9px;
    color: #000;
    text-transform: uppercase;
  }
  .task-cell {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: monospace;
    font-size: 9px;
    color: var(--text-secondary, #7a7a88);
  }
  .model-cell {
    font-family: monospace;
    font-size: 9px;
    color: var(--text-secondary, #7a7a88);
    text-align: center;
    width: 32px;
  }
  .placeholder {
    color: var(--text-secondary, #7a7a88);
    font-style: italic;
    font-family: monospace;
    font-size: 9px;
  }
</style>
