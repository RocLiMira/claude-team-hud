<script lang="ts">
  import { onDestroy } from "svelte";
  import { tasksStore, type TaskInfo } from "../lib/state/tasks";

  let tasks: TaskInfo[] = $state([]);
  const unsub = tasksStore.subscribe((v) => (tasks = v));
  onDestroy(unsub);

  function getStatusColor(status: string): string {
    switch (status.toLowerCase()) {
      case "done": return "#44cc44";
      case "in-progress": return "#ccaa22";
      case "blocked": return "#cc4444";
      case "todo": return "#6688cc";
      default: return "#7a7a88";
    }
  }

  function isBlocked(task: TaskInfo): boolean {
    return task.blockedBy.length > 0;
  }
</script>

<div class="task-list">
  {#if tasks.length === 0}
    <p class="placeholder">No active tasks</p>
  {:else}
    {#each tasks as task (task.id)}
      <div class="task-item" class:task-blocked={isBlocked(task)}>
        <div class="task-header">
          <span class="task-id">{task.id}</span>
          <span
            class="task-status"
            style="background: {getStatusColor(task.status)}"
          >
            {task.status.toUpperCase()}
          </span>
          {#if isBlocked(task)}
            <span class="blocked-badge">BLOCKED</span>
          {/if}
        </div>
        <div class="task-subject">{task.subject}</div>
        <div class="task-owner">
          {task.owner ?? "unassigned"}
        </div>
      </div>
    {/each}
  {/if}
</div>

<style>
  .task-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .task-item {
    border: 2px solid var(--border, #3a3a48);
    padding: 6px;
    background: #12122a;
  }
  .task-item:hover {
    background: #1a1a34;
  }
  .task-blocked {
    border-color: #cc4444;
  }
  .task-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 3px;
  }
  .task-id {
    font-family: var(--font-pixel, monospace);
    font-size: 7px;
    color: var(--accent-cyan, #00cccc);
  }
  .task-status {
    display: inline-block;
    padding: 1px 4px;
    font-family: var(--font-pixel, monospace);
    font-size: 6px;
    color: #000;
  }
  .blocked-badge {
    display: inline-block;
    padding: 1px 4px;
    background: #cc4444;
    font-family: var(--font-pixel, monospace);
    font-size: 6px;
    color: #fff;
    animation: blink-blocked 1s step-end infinite;
  }
  @keyframes blink-blocked {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  .task-subject {
    font-family: monospace;
    font-size: 8px;
    color: var(--text-primary, #e6f1ff);
    margin-bottom: 2px;
  }
  .task-owner {
    font-family: monospace;
    font-size: 7px;
    color: var(--text-secondary, #7a7a88);
  }
  .placeholder {
    color: var(--text-secondary, #7a7a88);
    font-style: italic;
    font-size: 8px;
  }
</style>
