import { writable } from "svelte/store";

export interface CharacterPosition {
  agentName: string;
  tileX: number;
  tileY: number;
  targetX: number;
  targetY: number;
  state: "idle" | "walking" | "meeting" | "talking" | "entering" | "leaving" | "blocked";
}

export const officeStore = writable<CharacterPosition[]>([]);
export const meetingActive = writable<boolean>(false);
