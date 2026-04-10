/**
 * Tauri IPC bridge -- connects Rust backend events to Svelte stores.
 * In dev/mock mode (no Tauri context), generates synthetic data for testing.
 */

import { writable, get } from "svelte/store";
import type { TeamSnapshot, RawAgentState, RawMessage, RawTaskState } from "./types";
import { teamStore } from "../state/team";
import { agentsStore, type AgentState } from "../state/agents";
import { tasksStore, type TaskInfo } from "../state/tasks";
import { messagesStore, type MessageInfo } from "../state/messages";
import { metricsStore, environmentStore } from "../state/metrics";
import { officeStore, meetingActive } from "../state/office";
import { computeEnvironment, computePositions, isMeetingActive } from "../state/environment";
import { ROLES } from "../constants/roles";
import { allTeamsStore } from "../state/multiTeam";

/** Available team names discovered from backend. */
export const availableTeams = writable<string[]>([]);

/** Currently active team name. */
export const activeTeam = writable<string | null>(null);

/** Whether the bridge has completed initialization. */
export const bridgeReady = writable<boolean>(false);

let unlisten: (() => void) | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let mockInterval: ReturnType<typeof setInterval> | null = null;
let teamDiscoveryInterval: ReturnType<typeof setInterval> | null = null;

// --- Tauri context detection -------------------------------------------------

function isTauriContext(): boolean {
  return (
    typeof window !== "undefined" &&
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ !== undefined
  );
}

// --- Snake_case to camelCase mappers -----------------------------------------

function mapAgent(raw: RawAgentState): AgentState {
  return {
    name: raw.name,
    role: raw.role,
    model: raw.model,
    color: raw.color,
    status: raw.status,
    currentTask: raw.current_task,
    messageCount: raw.message_count,
    tokenUsage: raw.token_usage,
    spawnTime: raw.spawn_time,
    paneId: raw.pane_id,
  };
}

function mapTask(raw: RawTaskState): TaskInfo {
  return {
    id: raw.id,
    subject: raw.subject,
    description: raw.description,
    owner: raw.owner,
    status: raw.status,
    blocks: raw.blocks,
    blockedBy: raw.blocked_by,
  };
}

function mapMessage(raw: RawMessage): MessageInfo {
  return {
    from: raw.from,
    to: raw.to,
    text: raw.text,
    timestamp: raw.timestamp,
    read: raw.read,
  };
}

// --- Apply snapshot to all stores --------------------------------------------

function applySnapshot(snapshot: TeamSnapshot): void {
  const agents = snapshot.agents.map(mapAgent);
  const tasks = snapshot.tasks.map(mapTask);
  const messages = snapshot.messages.map(mapMessage);

  teamStore.set({
    name: snapshot.team_name,
    memberCount: agents.length,
    activeSince: snapshot.session_start ?? new Date().toISOString(),
  });

  agentsStore.set(agents);
  tasksStore.set(tasks);
  messagesStore.set(messages);

  metricsStore.set({
    totalTokens: snapshot.token_usage.total_tokens,
    perAgent: snapshot.token_usage.per_agent,
    burnRate: snapshot.token_usage.burn_rate,
    costUsd: snapshot.token_usage.cost_usd,
    rateLimitPct: snapshot.token_usage.rate_limit_pct,
    rateLimitReset: snapshot.token_usage.rate_limit_reset ?? null,
  });

  const currentMetrics = get(metricsStore);
  environmentStore.set(computeEnvironment(agents, tasks, currentMetrics));
  officeStore.set(computePositions(agents, tasks));
  meetingActive.set(isMeetingActive(tasks));
}

// --- Tauri mode --------------------------------------------------------------

async function initTauri(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");

  // Discover teams
  const teams: string[] = await invoke("list_teams");
  availableTeams.set(teams);

  if (teams.length > 0) {
    // Auto-select first team
    await switchTeamTauri(teams[0]);
  } else {
    console.log("[bridge] No teams found, will keep polling...");
  }

  bridgeReady.set(true);

  // Poll for new/removed teams every 3 seconds
  startTeamDiscovery(invoke);
}

function startTeamDiscovery(invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>): void {
  if (teamDiscoveryInterval) return;

  // Poll all teams' snapshots for building view
  const pollAllTeams = async (teams: string[]) => {
    const snapshots = new Map<string, TeamSnapshot>();
    for (const team of teams) {
      try {
        const snapshot = (await invoke("get_team_snapshot", { team })) as unknown as TeamSnapshot;
        snapshots.set(team, snapshot);
      } catch { /* skip unavailable teams */ }
    }
    allTeamsStore.set(snapshots);
  };

  teamDiscoveryInterval = setInterval(async () => {
    try {
      const teams = (await invoke("list_teams")) as string[];
      const current = get(availableTeams);
      const currentActive = get(activeTeam);

      // Always poll all teams for building view
      pollAllTeams(teams);

      // Detect changes
      const added = teams.filter((t) => !current.includes(t));
      const removed = current.filter((t) => !teams.includes(t));

      if (added.length === 0 && removed.length === 0) return;

      console.log("[bridge] Team change detected:", { added, removed });
      availableTeams.set(teams);

      // If active team was removed, clear all stores first, then switch
      if (currentActive && removed.includes(currentActive)) {
        // Force clear all stores so scene removes all characters immediately
        agentsStore.set([]);
        tasksStore.set([]);
        messagesStore.set([]);
        teamStore.set({ name: "", memberCount: 0, activeSince: "" });
        officeStore.set([]);
        meetingActive.set(false);

        if (teams.length > 0) {
          await switchTeamTauri(teams[0]);
        } else {
          activeTeam.set(null);
        }
      }

      // If no active team but teams now available, auto-select
      if (!currentActive && teams.length > 0) {
        await switchTeamTauri(teams[0]);
      }
    } catch (err) {
      console.warn("[bridge] Team discovery poll failed:", err);
    }
  }, 3000);
}

async function switchTeamTauri(teamName: string): Promise<void> {
  // Cleanup previous watchers
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  activeTeam.set(teamName);

  const { invoke } = await import("@tauri-apps/api/core");

  // Try event-driven mode first (watch_team + team-update event).
  // rust-dev is implementing this; graceful fallback to polling if not available yet.
  let eventDriven = false;
  try {
    await invoke("watch_team", { team: teamName });
    const { listen } = await import("@tauri-apps/api/event");
    unlisten = await listen<TeamSnapshot>("team-update", (event) => {
      // Only apply snapshots for the currently active team
      if (event.payload.team_name === get(activeTeam)) {
        applySnapshot(event.payload);
      }
    });
    eventDriven = true;
    console.log("[bridge] Event-driven mode active for team:", teamName);
  } catch {
    console.log("[bridge] watch_team not available, falling back to polling");
  }

  // If event-driven failed, poll get_team_snapshot every 2 seconds
  if (!eventDriven) {
    const poll = async () => {
      // Only apply if this team is still the active one
      if (get(activeTeam) !== teamName) return;
      try {
        const snapshot: TeamSnapshot = await invoke("get_team_snapshot", {
          team: teamName,
        });
        if (get(activeTeam) === teamName) {
          applySnapshot(snapshot);
        }
      } catch (err) {
        console.warn("[bridge] Poll failed:", err);
      }
    };

    // Initial fetch
    await poll();
    pollInterval = setInterval(poll, 2000);
    console.log("[bridge] Polling mode active for team:", teamName);
  }
}

// --- Mock mode ---------------------------------------------------------------

const MOCK_AGENTS_ROLES = [
  "team-lead",
  "cto",
  "ts-architect",
  "devops-engineer",
  "qa-engineer",
] as const;

const MOCK_TASK_SUBJECTS = [
  "Set up project scaffolding",
  "Implement auth module",
  "Review PR #42 for API changes",
  "Design database schema",
  "Fix type errors in utils",
  "Run integration test suite",
];

const MOCK_MESSAGE_POOL = [
  "Starting work on the auth module refactor",
  "PR #42 looks good, just a few type issues",
  "Meeting scheduled for architecture review",
  "Found a bug in the error handling path",
  "Tests are passing on the new endpoint",
  "Deploying staging build now",
  "Need help with the database migration",
  "Code review complete, approving merge",
  "Investigating performance regression",
  "Updated the API documentation",
  "Fixing flaky test in CI pipeline",
  "Security audit findings ready for review",
];

const STATUS_CYCLE: Array<"working" | "idle" | "blocked" | "offline"> = [
  "working",
  "working",
  "idle",
  "blocked",
  "working",
];

function buildMockSnapshot(cycleCount: number): TeamSnapshot {
  const sessionStart = new Date(Date.now() - 15 * 60_000).toISOString();

  const agents: TeamSnapshot["agents"] = MOCK_AGENTS_ROLES.map(
    (roleId, idx) => {
      const roleCfg = ROLES.find((r) => r.id === roleId)!;
      const statusIdx = (cycleCount + idx) % STATUS_CYCLE.length;
      const status = STATUS_CYCLE[statusIdx];
      // Each agent spawns at a different offset (staggered by 3 min each)
      const spawnOffset = idx * 3 * 60_000;
      const spawnTime = new Date(
        Date.now() - 15 * 60_000 + spawnOffset
      ).toISOString();
      const baseTokens = (idx + 1) * 5000;
      const tokenGrowth = cycleCount * (800 + idx * 300);

      return {
        name: roleCfg.label,
        role: roleId,
        model: roleCfg.model === "opus" ? "claude-opus-4" : "claude-sonnet-4",
        color: roleCfg.color,
        status,
        current_task:
          status === "idle" || status === "offline"
            ? null
            : MOCK_TASK_SUBJECTS[
                (idx + cycleCount) % MOCK_TASK_SUBJECTS.length
              ],
        message_count: cycleCount * 2 + idx,
        token_usage: baseTokens + tokenGrowth,
        spawn_time: spawnTime,
        pane_id: null,
      };
    }
  );

  const tasks: TeamSnapshot["tasks"] = MOCK_TASK_SUBJECTS.map(
    (subject, idx) => {
      const statusPool = ["todo", "in-progress", "in-progress", "done"];
      const statusIdx = (cycleCount + idx) % statusPool.length;
      const ownerIdx = idx % MOCK_AGENTS_ROLES.length;
      const roleCfg = ROLES.find(
        (r) => r.id === MOCK_AGENTS_ROLES[ownerIdx]
      )!;

      return {
        id: `TASK-${(idx + 1).toString().padStart(3, "0")}`,
        subject,
        description: null,
        owner: roleCfg.label,
        status: statusPool[statusIdx],
        blocks:
          idx === 2
            ? [`TASK-${(idx + 2).toString().padStart(3, "0")}`]
            : [],
        blocked_by:
          idx === 3 && cycleCount % 3 === 0
            ? [`TASK-${(idx - 1).toString().padStart(3, "0")}`]
            : [],
      };
    }
  );

  const totalTokens = agents.reduce((sum, a) => sum + a.token_usage, 0);
  const perAgent: Record<string, number> = {};
  for (const a of agents) {
    perAgent[a.name] = a.token_usage;
  }

  // Generate messages -- accumulate over cycles, cap at 50
  const messages: TeamSnapshot["messages"] = [];
  const msgCount = Math.min(cycleCount * 2 + 3, 50);
  for (let i = 0; i < msgCount; i++) {
    const fromIdx = i % MOCK_AGENTS_ROLES.length;
    const toIdx = (i + 1) % MOCK_AGENTS_ROLES.length;
    const fromRole = ROLES.find((r) => r.id === MOCK_AGENTS_ROLES[fromIdx])!;
    const toRole = ROLES.find((r) => r.id === MOCK_AGENTS_ROLES[toIdx])!;
    const msgTime = new Date(
      Date.now() - (msgCount - i) * 30_000
    ).toISOString();

    messages.push({
      from: fromRole.label,
      to: toRole.label,
      text: MOCK_MESSAGE_POOL[i % MOCK_MESSAGE_POOL.length],
      timestamp: msgTime,
      read: i < msgCount - 3,
    });
  }

  return {
    team_name: "mock-team",
    agents,
    tasks,
    messages,
    token_usage: {
      total_tokens: totalTokens,
      per_agent: perAgent,
      burn_rate: 50 + cycleCount * 25,
      cost_usd: totalTokens * 0.000015,
      rate_limit_pct: Math.min(95, 10 + cycleCount * 5),
      rate_limit_reset: "2h 30m",
    },
    session_start: sessionStart,
  };
}

function initMock(): void {
  console.log("[bridge] Mock mode -- no Tauri context detected");

  // Start with NO team -- empty office
  bridgeReady.set(true);

  // After 2 seconds, "discover" a team (simulates user running /init-team)
  setTimeout(() => {
    availableTeams.set(["mock-team"]);
    activeTeam.set("mock-team");
    console.log("[bridge] Mock: Team discovered!");

    // Gradually spawn agents one by one, simulating real team creation
    let spawnIndex = 0;
    let cycleCount = 0;

    const spawnNext = () => {
      if (spawnIndex >= MOCK_AGENTS_ROLES.length) {
        // All agents spawned, switch to normal cycling
        console.log("[bridge] Mock: All agents spawned, cycling states");
        mockInterval = setInterval(() => {
          cycleCount++;
          applySnapshot(buildMockSnapshot(cycleCount));
        }, 3000);
        return;
      }

      // Build snapshot with only the agents spawned so far
      spawnIndex++;
      const snapshot = buildMockSnapshot(cycleCount);
      snapshot.agents = snapshot.agents.slice(0, spawnIndex);
      snapshot.token_usage.per_agent = {};
      for (const a of snapshot.agents) {
        snapshot.token_usage.per_agent[a.name] = a.token_usage;
      }
      applySnapshot(snapshot);

      // Next agent arrives after 2-3 seconds
      setTimeout(spawnNext, 2000 + Math.random() * 1000);
    };

    // First agent (Team Lead) arrives after 1 second
    setTimeout(spawnNext, 1000);
  }, 2000);

  console.log("[bridge] Mock mode ready -- team will appear in 2s");
}

// --- Public API --------------------------------------------------------------

export async function initBridge(): Promise<void> {
  if (isTauriContext()) {
    await initTauri();
  } else {
    initMock();
  }
}

export async function switchTeam(teamName: string): Promise<void> {
  if (isTauriContext()) {
    await switchTeamTauri(teamName);
  } else {
    // In mock mode, just update the active team label
    activeTeam.set(teamName);
  }
}

/** Clear all team-specific stores. Used when switching floors. */
export function clearStores(): void {
  agentsStore.set([]);
  tasksStore.set([]);
  messagesStore.set([]);
  teamStore.set({ name: "", memberCount: 0, activeSince: "" });
  officeStore.set([]);
  meetingActive.set(false);
}

export function destroyBridge(): void {
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  if (mockInterval) {
    clearInterval(mockInterval);
    mockInterval = null;
  }
  if (teamDiscoveryInterval) {
    clearInterval(teamDiscoveryInterval);
    teamDiscoveryInterval = null;
  }
  console.log("[bridge] IPC bridge destroyed");
}
