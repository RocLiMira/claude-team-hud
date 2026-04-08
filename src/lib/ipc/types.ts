/**
 * Wire-format types matching Rust models.rs (snake_case).
 * The bridge maps these to camelCase store interfaces.
 */

export interface RawAgentState {
  name: string;
  role: string;
  model: string;
  color: string;
  status: "working" | "idle" | "blocked" | "offline";
  current_task: string | null;
  message_count: number;
  token_usage: number;
  spawn_time: string | null;
}

export interface RawMessage {
  from: string;
  to: string;
  text: string;
  timestamp: string;
  read: boolean;
}

export interface RawTaskState {
  id: string;
  subject: string;
  description: string | null;
  owner: string | null;
  status: string;
  blocks: string[];
  blocked_by: string[];
}

export interface RawTokenUsage {
  total_tokens: number;
  per_agent: Record<string, number>;
  burn_rate: number;
  cost_usd: number;
  rate_limit_pct: number;
}

export interface TeamSnapshot {
  team_name: string;
  agents: RawAgentState[];
  tasks: RawTaskState[];
  messages: RawMessage[];
  token_usage: RawTokenUsage;
  session_start: string | null;
}
