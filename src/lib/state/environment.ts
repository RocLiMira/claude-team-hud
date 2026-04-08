/**
 * Pure functions to compute EnvironmentState and CharacterPositions
 * from raw TeamSnapshot data.
 */

import type { EnvironmentState, TokenMetrics } from "./metrics";
import type { CharacterPosition } from "./office";
import type { AgentState } from "./agents";
import type { TaskInfo } from "./tasks";
import { ROLE_MAP } from "../constants/roles";

type Level5 = 0 | 1 | 2 | 3 | 4 | 5;
type Level3 = 0 | 1 | 2 | 3;

function clampLevel5(n: number): Level5 {
  return Math.min(5, Math.max(0, Math.floor(n))) as Level5;
}

function clampLevel3(n: number): Level3 {
  return Math.min(3, Math.max(0, Math.floor(n))) as Level3;
}

/** Map per-agent token usage to file stack level (0-5). */
function computeFileStackLevel(tokenUsage: number): Level5 {
  if (tokenUsage <= 1000) return 0;
  if (tokenUsage <= 10_000) return 1;
  if (tokenUsage <= 50_000) return 2;
  if (tokenUsage <= 150_000) return 3;
  if (tokenUsage <= 500_000) return 4;
  return 5;
}

/**
 * Map per-agent active duration to coffee count (0-5).
 * Uses agent's spawnTime, NOT session start.
 * If spawnTime is null, defaults to 0.
 */
function computeCoffeeCount(spawnTime: string | null, now: Date): Level5 {
  if (!spawnTime) return 0;
  const spawn = new Date(spawnTime);
  if (isNaN(spawn.getTime())) return 0;
  const minutesActive = (now.getTime() - spawn.getTime()) / 60_000;
  if (minutesActive <= 5) return 0;
  if (minutesActive <= 15) return 1;
  if (minutesActive <= 30) return 2;
  if (minutesActive <= 60) return 3;
  if (minutesActive <= 120) return 4;
  return 5;
}

/** Map completed task count owned by agent to plant level (0-5). */
function computePlantLevel(completedTaskCount: number): Level5 {
  if (completedTaskCount <= 0) return 0;
  if (completedTaskCount <= 1) return 1;
  if (completedTaskCount <= 3) return 2;
  if (completedTaskCount <= 5) return 3;
  if (completedTaskCount <= 8) return 4;
  return 5;
}

/**
 * Map blocked task count to trash level (0-3).
 *
 * V1 APPROXIMATION: Uses blocked task count as a proxy.
 * The intended data source is hud-metrics.log error/retry events
 * from custom hooks. When hook telemetry is available, this should
 * be replaced with error_count from hud-metrics.log.
 */
function computeTrashLevel(blockedTaskCount: number): Level3 {
  if (blockedTaskCount <= 0) return 0;
  if (blockedTaskCount <= 1) return 1;
  if (blockedTaskCount <= 3) return 2;
  return 3;
}

/** Derive monitor state from agent status and current task keywords. */
function computeMonitorState(
  status: string,
  currentTask: string | null
): "code" | "review" | "design" | "idle" | "error" | "meeting" | "off" {
  if (status === "offline") return "off";
  if (status === "idle") return "idle";

  const task = (currentTask ?? "").toLowerCase();
  if (/\b(review|pr)\b/.test(task)) return "review";
  if (/\b(design|architect|spec)\b/.test(task)) return "design";
  if (/\b(meeting|standup)\b/.test(task)) return "meeting";
  if (/\b(error|fix|bug)\b/.test(task)) return "error";

  return "code";
}

/** Compute whiteboard progress from task completion ratio (0-4). */
function computeWhiteboardProgress(
  tasks: TaskInfo[]
): 0 | 1 | 2 | 3 | 4 {
  if (tasks.length === 0) return 0;
  const done = tasks.filter((t) => t.status === "completed").length;
  const pct = (done / tasks.length) * 100;
  if (pct <= 0) return 0;
  if (pct <= 25) return 1;
  if (pct <= 50) return 2;
  if (pct <= 75) return 3;
  return 4;
}

/** Compute server load from rate limit percentage (0-3). */
function computeServerLoad(rateLimitPct: number): Level3 {
  if (rateLimitPct <= 25) return 0;
  if (rateLimitPct <= 50) return 1;
  if (rateLimitPct <= 75) return 2;
  return 3;
}

/** Compute morale from ratio of healthy (working/idle) vs unhealthy (blocked/offline) agents. */
function computeMorale(agents: AgentState[]): Level3 {
  if (agents.length === 0) return 0;
  const unhealthy = agents.filter(
    (a) => a.status === "blocked" || a.status === "offline"
  ).length;
  const pct = (unhealthy / agents.length) * 100;
  if (pct > 50) return 0;
  if (pct > 25) return 1;
  if (pct > 10) return 2;
  return 3;
}

/**
 * Compute window weather from token burn rate.
 *
 * V1 APPROXIMATION: Uses token burn rate as a proxy for project velocity.
 * The intended data source is TaskCompleted hook timestamps, measuring
 * actual task completion velocity. When hook telemetry is available,
 * this should be replaced with completions-per-hour metric.
 */
function computeWeather(
  burnRate: number
): "sunny" | "cloudy" | "rainy" | "stormy" {
  if (burnRate < 100) return "sunny";
  if (burnRate < 500) return "cloudy";
  if (burnRate < 2000) return "rainy";
  return "stormy";
}

/** Count tasks with a given status owned by an agent. */
function countAgentTasks(
  tasks: TaskInfo[],
  agentName: string,
  status: string
): number {
  const normalized = status === "done" ? "completed" : status;
  return tasks.filter(
    (t) => t.owner === agentName && t.status === normalized
  ).length;
}

/** Count blocked tasks (by blockedBy array) owned by an agent. */
function countAgentBlockedTasks(
  tasks: TaskInfo[],
  agentName: string
): number {
  return tasks.filter(
    (t) => t.owner === agentName && t.blockedBy.length > 0
  ).length;
}

/**
 * Compute full EnvironmentState from agents, tasks, and metrics.
 */
export function computeEnvironment(
  agents: AgentState[],
  tasks: TaskInfo[],
  metrics: TokenMetrics
): EnvironmentState {
  const now = new Date();

  const perAgent: EnvironmentState["perAgent"] = {};
  for (const agent of agents) {
    const completedCount = countAgentTasks(tasks, agent.name, "done");
    const blockedCount = countAgentBlockedTasks(tasks, agent.name);

    perAgent[agent.role] = {
      fileStackLevel: computeFileStackLevel(agent.tokenUsage),
      coffeeCount: computeCoffeeCount(agent.spawnTime, now),
      plantLevel: computePlantLevel(completedCount),
      trashLevel: computeTrashLevel(blockedCount),
      monitorState: computeMonitorState(agent.status, agent.currentTask),
      roleSpecificLevel: computeFileStackLevel(agent.tokenUsage),
    };
  }

  return {
    perAgent,
    global: {
      whiteboardProgress: computeWhiteboardProgress(tasks),
      serverLoad: computeServerLoad(metrics.rateLimitPct),
      breakAreaMorale: computeMorale(agents),
      windowWeather: computeWeather(metrics.burnRate),
    },
  };
}

/**
 * Compute character positions from agents and task context.
 */
export function computePositions(
  agents: AgentState[],
  tasks: TaskInfo[]
): CharacterPosition[] {
  // Detect if a meeting is active based on task subjects
  const meetingActive = tasks.some((t) =>
    /\b(meeting|standup)\b/i.test(t.subject)
  );

  const positions: CharacterPosition[] = [];

  for (const agent of agents) {
    const roleConfig = ROLE_MAP.get(agent.role);
    if (!roleConfig) continue;

    if (agent.status === "offline") {
      positions.push({
        agentName: agent.role,
        tileX: roleConfig.deskTileX,
        tileY: roleConfig.deskTileY,
        targetX: roleConfig.deskTileX,
        targetY: roleConfig.deskTileY,
        state: "leaving",
      });
      continue;
    }

    // If meeting is active and agent is working on the meeting task, go to meeting room
    const isInMeeting =
      meetingActive &&
      agent.currentTask != null &&
      /\b(meeting|standup)\b/i.test(agent.currentTask);

    if (isInMeeting) {
      // Meeting room chair positions are stored in roleConfig
      const meetingX = 26 + (roleConfig.meetingChairIndex % 4) * 3;
      const meetingY = 3 + Math.floor(roleConfig.meetingChairIndex / 4) * 2;
      positions.push({
        agentName: agent.role,
        tileX: roleConfig.deskTileX,
        tileY: roleConfig.deskTileY,
        targetX: meetingX,
        targetY: meetingY,
        state: "meeting",
      });
      continue;
    }

    let charState: CharacterPosition["state"];
    switch (agent.status) {
      case "working":
        charState = "talking";
        break;
      case "idle":
        charState = "idle";
        break;
      case "blocked":
        charState = "blocked";
        break;
      default:
        charState = "idle";
    }

    positions.push({
      agentName: agent.name,
      tileX: roleConfig.deskTileX,
      tileY: roleConfig.deskTileY,
      targetX: roleConfig.deskTileX,
      targetY: roleConfig.deskTileY,
      state: charState,
    });
  }

  return positions;
}

/**
 * Check if a meeting is currently active based on task subjects.
 */
export function isMeetingActive(tasks: TaskInfo[]): boolean {
  return tasks.some((t) => /\b(meeting|standup)\b/i.test(t.subject));
}
