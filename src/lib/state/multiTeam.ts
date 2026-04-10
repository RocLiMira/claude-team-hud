import { writable } from "svelte/store";
import type { TeamSnapshot } from "../ipc/types";

/** All team snapshots keyed by team name. */
export const allTeamsStore = writable<Map<string, TeamSnapshot>>(new Map());

/** Current view mode. */
export type ViewMode = "building" | "floor";
export const viewModeStore = writable<ViewMode>("building");

/** Which team is focused (in floor view). */
export const focusedTeamStore = writable<string | null>(null);
