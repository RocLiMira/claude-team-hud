import { writable } from "svelte/store";

export type AgentStatus = "working" | "idle" | "blocked" | "offline";

export interface AgentState {
  name: string;
  role: string;
  model: string;
  color: string;
  status: AgentStatus;
  currentTask: string | null;
  messageCount: number;
  tokenUsage: number;
  spawnTime: string | null;
  paneId: string | null;
}

export const agentsStore = writable<AgentState[]>([]);
