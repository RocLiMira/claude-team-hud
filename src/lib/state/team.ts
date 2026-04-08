import { writable } from "svelte/store";

export interface TeamInfo {
  name: string;
  memberCount: number;
  activeSince: string;
}

export const teamStore = writable<TeamInfo | null>(null);
