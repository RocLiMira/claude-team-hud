<script lang="ts">
  import { onMount, onDestroy } from "svelte";

  interface PermRequest {
    agent_name: string;
    pane_id: string;
    prompt_text: string;
    timestamp: string;
  }

  let requests: PermRequest[] = $state([]);
  let unlisten: (() => void) | null = null;

  function isTauriContext(): boolean {
    return typeof window !== "undefined" &&
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ !== undefined;
  }

  onMount(async () => {
    if (!isTauriContext()) return;

    const { listen } = await import("@tauri-apps/api/event");
    unlisten = await listen<PermRequest>("permission-request", (event) => {
      const existing = requests.find(r => r.pane_id === event.payload.pane_id);
      if (!existing) {
        requests = [...requests, event.payload];
      }
    });
  });

  onDestroy(() => {
    if (unlisten) unlisten();
  });

  async function respond(req: PermRequest, decision: string) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      // Use hook-based response (writes response file that hook script reads)
      await invoke("respond_permission_hook", {
        reqId: req.pane_id,  // pane_id stores the request ID from hook
        decision,
        reason: decision === "deny" ? "Denied via Claude Team HUD" : null,
      });
    } catch (err) {
      console.error("[PermissionDialog] Failed to respond:", err);
    }
    requests = requests.filter(r => r.pane_id !== req.pane_id);
  }
</script>

{#if requests.length > 0}
  <div class="perm-overlay">
    {#each requests as req (req.pane_id)}
      <div class="perm-dialog">
        <div class="perm-header">
          PERMISSION REQUEST
        </div>
        <div class="perm-agent">
          Agent: <span class="perm-name">{req.agent_name}</span>
        </div>
        <pre class="perm-text">{req.prompt_text}</pre>
        <div class="perm-actions">
          <button class="perm-btn perm-allow" onclick={() => respond(req, "allow")}>
            ALLOW
          </button>
          <button class="perm-btn perm-deny" onclick={() => respond(req, "deny")}>
            DENY
          </button>
          <button class="perm-btn perm-ask" onclick={() => respond(req, "ask")}>
            ASK IN TERMINAL
          </button>
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .perm-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.7);
    z-index: 1000;
    flex-direction: column;
    gap: 12px;
  }
  .perm-dialog {
    background: #1a1a2e;
    border: 2px solid #cc8800;
    padding: 16px 20px;
    min-width: 420px;
    max-width: 600px;
    font-family: monospace;
  }
  .perm-header {
    font-family: var(--font-pixel, monospace);
    font-size: 14px;
    color: #ccaa00;
    text-align: center;
    margin-bottom: 12px;
    letter-spacing: 2px;
  }
  .perm-agent {
    font-size: 12px;
    color: #7a7a88;
    margin-bottom: 8px;
  }
  .perm-name {
    color: #00cccc;
    font-weight: bold;
  }
  .perm-text {
    background: #12122a;
    border: 1px solid #3a3a48;
    padding: 8px;
    font-size: 11px;
    color: #e6f1ff;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 200px;
    overflow-y: auto;
    margin-bottom: 12px;
  }
  .perm-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .perm-btn {
    font-family: var(--font-pixel, monospace);
    font-size: 11px;
    padding: 6px 12px;
    cursor: pointer;
    border: 2px solid;
    letter-spacing: 1px;
    text-align: center;
  }
  .perm-allow {
    background: #1a3a1a;
    color: #44cc44;
    border-color: #44cc44;
  }
  .perm-allow:hover { background: #2a5a2a; }
  .perm-always {
    background: #1a2a3a;
    color: #44aacc;
    border-color: #44aacc;
  }
  .perm-always:hover { background: #2a4a5a; }
  .perm-deny {
    background: #3a1a1a;
    color: #cc4444;
    border-color: #cc4444;
  }
  .perm-deny:hover { background: #5a2a2a; }
  .perm-never {
    background: #3a1a2a;
    color: #cc44aa;
    border-color: #cc44aa;
  }
  .perm-never:hover { background: #5a2a4a; }
</style>
