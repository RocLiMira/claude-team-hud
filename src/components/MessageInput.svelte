<script lang="ts">
  import { onDestroy } from "svelte";
  import { agentsStore, type AgentState } from "../lib/state/agents";
  import { activeTeam } from "../lib/ipc/bridge";

  let agents: AgentState[] = $state([]);
  let team: string | null = $state(null);
  let selectedAgent = $state("");
  let messageText = $state("");
  let sending = $state(false);

  const unsubAgents = agentsStore.subscribe((v) => (agents = v));
  const unsubTeam = activeTeam.subscribe((v) => (team = v));
  onDestroy(() => { unsubAgents(); unsubTeam(); });

  function isTauriContext(): boolean {
    return typeof window !== "undefined" &&
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ !== undefined;
  }

  async function sendMessage() {
    if (!messageText.trim() || !selectedAgent || !team) return;

    sending = true;
    try {
      if (isTauriContext()) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("send_message", {
          team: team,
          to: selectedAgent,
          text: messageText.trim(),
        });
      }
      messageText = "";
    } catch (err) {
      console.error("[MessageInput] Failed to send:", err);
    } finally {
      sending = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }
</script>

<div class="msg-input">
  <select class="agent-select" bind:value={selectedAgent}>
    <option value="" disabled>TO:</option>
    {#each agents as agent (agent.role)}
      <option value={agent.name}>{agent.name}</option>
    {/each}
  </select>
  <input
    class="msg-textinput"
    bind:value={messageText}
    onkeydown={handleKeydown}
    placeholder="Type a message..."
    disabled={sending}
  />
  <button class="send-btn" onclick={sendMessage} disabled={sending || !messageText.trim() || !selectedAgent}>
    ▶
  </button>
</div>

<style>
  .msg-input {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
  }
  .agent-select {
    flex: 1;
    font-family: monospace;
    font-size: 11px;
    color: var(--accent-cyan, #00cccc);
    background: #1a1a2e;
    border: 1px solid #3a3a48;
    padding: 2px 4px;
    cursor: pointer;
  }
  .agent-select:focus {
    outline: 1px solid var(--accent-cyan, #00cccc);
  }
  .send-btn {
    font-family: monospace;
    font-size: 12px;
    color: #e6f1ff;
    background: #2a4a2e;
    border: 1px solid #3a6a3e;
    padding: 2px 8px;
    cursor: pointer;
  }
  .send-btn:hover:not(:disabled) {
    background: #3a6a3e;
  }
  .send-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .msg-textinput {
    flex: 1;
    font-family: monospace;
    font-size: 11px;
    color: #e6f1ff;
    background: #1a1a2e;
    border: 1px solid #3a3a48;
    padding: 4px 6px;
    height: 24px;
    box-sizing: border-box;
  }
  .msg-textinput:focus {
    outline: 1px solid var(--accent-cyan, #00cccc);
  }
  .msg-textinput::placeholder {
    color: #5a5a68;
  }
</style>
