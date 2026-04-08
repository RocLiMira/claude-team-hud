<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { messagesStore, type MessageInfo } from "../lib/state/messages";

  let messages: MessageInfo[] = $state([]);
  let expandedIndex: number | null = $state(null);
  let scrollContainer: HTMLDivElement | undefined = $state(undefined);
  let prevCount = 0;

  const unsub = messagesStore.subscribe(async (v) => {
    messages = v;
    // Auto-scroll when new messages arrive
    if (v.length > prevCount && scrollContainer) {
      prevCount = v.length;
      await tick();
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
    prevCount = v.length;
  });

  onDestroy(unsub);

  function formatTimestamp(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "--:--:--";
    return d.toLocaleTimeString("en-US", { hour12: false });
  }

  function truncateText(text: string, max: number): string {
    return text.length > max ? text.slice(0, max) + "..." : text;
  }

  function toggleExpand(idx: number) {
    expandedIndex = expandedIndex === idx ? null : idx;
  }

  function isRecent(timestamp: string): boolean {
    const msgTime = new Date(timestamp).getTime();
    if (isNaN(msgTime)) return false;
    return Date.now() - msgTime < 5000;
  }
</script>

<div class="message-log" bind:this={scrollContainer}>
  {#if messages.length === 0}
    <p class="placeholder">No messages</p>
  {:else}
    {#each messages as msg, idx (idx)}
      <button
        class="msg-item"
        class:msg-recent={isRecent(msg.timestamp)}
        class:msg-unread={!msg.read}
        onclick={() => toggleExpand(idx)}
        type="button"
      >
        <div class="msg-header">
          <span class="msg-time">{formatTimestamp(msg.timestamp)}</span>
          <span class="msg-route">
            {msg.from} <span class="arrow">-&gt;</span> {msg.to}
          </span>
        </div>
        <div class="msg-text">
          {#if expandedIndex === idx}
            {msg.text}
          {:else}
            {truncateText(msg.text, 50)}
          {/if}
        </div>
      </button>
    {/each}
  {/if}
</div>

<style>
  .message-log {
    max-height: 200px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  /* Pixel-art scrollbar */
  .message-log::-webkit-scrollbar {
    width: 6px;
  }
  .message-log::-webkit-scrollbar-track {
    background: #12122a;
  }
  .message-log::-webkit-scrollbar-thumb {
    background: var(--border, #3a3a48);
  }
  .msg-item {
    display: block;
    width: 100%;
    text-align: left;
    background: #12122a;
    border: 1px solid #2a2a3a;
    padding: 4px 6px;
    cursor: pointer;
    font-family: monospace;
    color: var(--text-primary, #e6f1ff);
  }
  .msg-item:hover {
    background: #1a1a34;
  }
  .msg-recent {
    border-left: 2px solid var(--accent-cyan, #00cccc);
    animation: highlight-fade 3s ease-out;
  }
  @keyframes highlight-fade {
    0% { background: #1a2a3a; }
    100% { background: #12122a; }
  }
  .msg-unread {
    border-left-color: var(--accent-yellow, #ccaa22);
  }
  .msg-header {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-bottom: 2px;
  }
  .msg-time {
    font-family: var(--font-pixel, monospace);
    font-size: 6px;
    color: var(--text-secondary, #7a7a88);
    flex-shrink: 0;
  }
  .msg-route {
    font-family: var(--font-pixel, monospace);
    font-size: 6px;
    color: var(--accent-cyan, #00cccc);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .arrow {
    color: var(--text-secondary, #7a7a88);
  }
  .msg-text {
    font-size: 8px;
    line-height: 1.3;
    word-break: break-word;
    color: var(--text-primary, #e6f1ff);
  }
  .placeholder {
    color: var(--text-secondary, #7a7a88);
    font-style: italic;
    font-size: 8px;
  }
</style>
