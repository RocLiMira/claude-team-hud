<script lang="ts">
  import SessionInfo from "./SessionInfo.svelte";
  import AgentRoster from "./AgentRoster.svelte";
  import TaskList from "./TaskList.svelte";
  import MessageLog from "./MessageLog.svelte";
  import TokenDashboard from "./TokenDashboard.svelte";

  interface SectionDef {
    key: string;
    label: string;
    defaultOpen: boolean;
  }

  const SECTIONS: SectionDef[] = [
    { key: "session", label: "SESSION", defaultOpen: true },
    { key: "agents", label: "AGENTS", defaultOpen: true },
    { key: "tasks", label: "TASKS", defaultOpen: true },
    { key: "tokens", label: "TOKENS", defaultOpen: true },
  ];

  let openSections: Record<string, boolean> = $state(
    Object.fromEntries(SECTIONS.map((s) => [s.key, s.defaultOpen]))
  );

  function toggleSection(key: string) {
    openSections[key] = !openSections[key];
  }
</script>

<div class="side-panel">
  <h2 class="panel-title">TEAM HUD</h2>

  {#each SECTIONS as section (section.key)}
    <section class="panel-section">
      <button
        class="section-header"
        onclick={() => toggleSection(section.key)}
        type="button"
      >
        <span class="section-toggle">
          {openSections[section.key] ? "[-]" : "[+]"}
        </span>
        <span class="section-label">{section.label}</span>
      </button>
      {#if openSections[section.key]}
        <div class="section-content">
          {#if section.key === "session"}
            <SessionInfo />
          {:else if section.key === "agents"}
            <AgentRoster />
          {:else if section.key === "tasks"}
            <TaskList />
          {:else if section.key === "messages"}
            <MessageLog />
          {:else if section.key === "tokens"}
            <TokenDashboard />
          {/if}
        </div>
      {/if}
    </section>
  {/each}
</div>

<style>
  .side-panel {
    padding: 8px;
    font-family: monospace;
    font-size: 9px;
    color: var(--text-primary, #e6f1ff);
    user-select: none;
    overflow: hidden;
    box-sizing: border-box;
  }
  .panel-title {
    font-family: monospace;
    font-size: 11px;
    text-align: center;
    margin-bottom: 10px;
    color: var(--accent-cyan, #00cccc);
    border-bottom: 2px solid var(--border, #3a3a48);
    padding-bottom: 6px;
  }
  .panel-section {
    margin-bottom: 4px;
    border: 2px solid var(--border, #3a3a48);
  }
  .section-header {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 4px 6px;
    background: #12122a;
    border: none;
    cursor: pointer;
    font-family: monospace;
    color: var(--accent-yellow, #ccaa22);
    font-size: 11px;
    text-align: left;
  }
  .section-header:hover {
    background: #1a1a34;
  }
  .section-toggle {
    font-family: monospace;
    font-size: 11px;
    color: var(--text-secondary, #7a7a88);
    flex-shrink: 0;
  }
  .section-label {
    letter-spacing: 1px;
  }
  .section-content {
    padding: 6px;
    border-top: 1px solid #2a2a3a;
    overflow: hidden;
  }
</style>
