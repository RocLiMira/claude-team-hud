<script lang="ts">
  import { onDestroy } from "svelte";
  import { selectedAgentStore, type SelectedAgent } from "../lib/state/selection";
  import { messagesStore, type MessageInfo } from "../lib/state/messages";

  let selected: SelectedAgent | null = $state(null);
  let paneContent = $state("");
  let allMessages: MessageInfo[] = $state([]);
  let refreshInterval: ReturnType<typeof setInterval> | null = null;

  const unsubMsg = messagesStore.subscribe((v) => { allMessages = v; });

  const unsub = selectedAgentStore.subscribe((v) => {
    selected = v;
    if (v && v.paneId) {
      fetchContent(v.paneId);
      startPolling(v.paneId);
    } else if (v) {
      // No pane — show agent's message history
      paneContent = formatAgentMessages(v.name);
      stopPolling();
    } else {
      paneContent = "";
      stopPolling();
    }
  });

  onDestroy(() => {
    unsub();
    unsubMsg();
    stopPolling();
  });

  function getAgentMessages(): MessageInfo[] {
    if (!selected) return [];
    return allMessages
      .filter((m) => m.from === selected!.name || m.to === selected!.name)
      .filter((m) => {
        // Filter system JSON
        if (m.text.startsWith("{")) {
          try { if (typeof JSON.parse(m.text).type === "string") return false; } catch {}
        }
        return true;
      });
  }

  function formatAgentMessages(agentName: string): string {
    const msgs = allMessages
      .filter((m) => m.from === agentName || m.to === agentName)
      .filter((m) => {
        if (m.text.startsWith("{")) {
          try { if (typeof JSON.parse(m.text).type === "string") return false; } catch {}
        }
        return true;
      })
      .slice(-20); // Last 20 messages

    if (msgs.length === 0) return "[No messages for this agent]";

    return msgs.map((m) => {
      const time = formatTime(m.timestamp);
      return `[${time}] ${m.from} → ${m.to}\n${m.text}`;
    }).join("\n\n");
  }

  function formatTime(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "--:--";
    return d.toLocaleTimeString("en-US", { hour12: false });
  }

  function isTauriContext(): boolean {
    return typeof window !== "undefined" &&
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ !== undefined;
  }

  async function fetchContent(paneId: string) {
    if (!isTauriContext() || !paneId) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      paneContent = await invoke("get_pane_content", { paneId, lines: 40 }) as string;
    } catch {
      paneContent = "[Unable to read pane content]";
    }
  }

  async function fetchSessionLog() {
    if (!isTauriContext()) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      paneContent = await invoke("get_session_log", { lines: 20 }) as string;
    } catch {
      // Fallback to message view if session log fails
      if (selected) {
        paneContent = formatAgentMessages(selected.name);
      } else {
        paneContent = "[Unable to read session log]";
      }
      stopPolling(); // Don't keep retrying
    }
  }

  function startSessionPolling() {
    stopPolling();
    refreshInterval = setInterval(() => fetchSessionLog(), 2000);
  }

  function startPolling(paneId: string) {
    stopPolling();
    refreshInterval = setInterval(() => fetchContent(paneId), 1500);
  }

  function stopPolling() {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
  }

  function close() {
    selectedAgentStore.set(null);
  }
</script>

{#if selected}
  <div class="pane-overlay" role="dialog">
    <div class="pane-dialog">
      <div class="pane-header">
        <span class="pane-title">{selected.name}</span>
        <span class="pane-id">{selected.paneId || "no pane"}</span>
        <button class="pane-close" onclick={close}>X</button>
      </div>
      <pre class="pane-content">{paneContent || "Loading..."}</pre>
    </div>
    <button class="pane-backdrop" onclick={close} aria-label="Close"></button>
  </div>
{/if}

<style>
  .pane-overlay {
    position: fixed;
    inset: 0;
    z-index: 900;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .pane-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    border: none;
    cursor: pointer;
  }
  .pane-dialog {
    position: relative;
    z-index: 901;
    background: #0a0a14;
    border: 2px solid #3a3a48;
    width: 80%;
    max-width: 900px;
    height: 70%;
    max-height: 600px;
    display: flex;
    flex-direction: column;
    font-family: monospace;
  }
  .pane-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: #1a1a2e;
    border-bottom: 2px solid #3a3a48;
    flex-shrink: 0;
  }
  .pane-title {
    font-family: var(--font-pixel, monospace);
    font-size: 14px;
    color: #00cccc;
    font-weight: bold;
    flex: 1;
  }
  .pane-id {
    font-size: 11px;
    color: #5a5a68;
  }
  .pane-close {
    font-family: var(--font-pixel, monospace);
    font-size: 14px;
    color: #cc4444;
    background: none;
    border: 1px solid #cc4444;
    padding: 2px 8px;
    cursor: pointer;
  }
  .pane-close:hover {
    background: #3a1a1a;
  }
  .pane-content {
    flex: 1;
    overflow-y: auto;
    padding: 8px 12px;
    font-size: 12px;
    line-height: 1.4;
    color: #cccccc;
    white-space: pre-wrap;
    word-break: break-all;
    margin: 0;
  }
  .pane-content::-webkit-scrollbar {
    width: 6px;
  }
  .pane-content::-webkit-scrollbar-track {
    background: #0a0a14;
  }
  .pane-content::-webkit-scrollbar-thumb {
    background: #3a3a48;
  }
  .msg-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    white-space: normal;
  }
  .msg-entry {
    border-bottom: 1px solid #2a2a3a;
    padding-bottom: 6px;
  }
  .msg-time {
    font-size: 10px;
    color: #5a5a68;
    margin-right: 6px;
  }
  .msg-dir {
    font-size: 11px;
    color: #00cccc;
  }
  .msg-body {
    margin-top: 4px;
    font-size: 12px;
    color: #cccccc;
    line-height: 1.4;
  }
  .msg-empty {
    color: #5a5a68;
    font-style: italic;
  }
</style>
