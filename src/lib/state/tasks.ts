import { writable } from "svelte/store";

export interface TaskInfo {
  id: string;
  subject: string;
  description: string | null;
  owner: string | null;
  status: string;
  blocks: string[];
  blockedBy: string[];
}

export const tasksStore = writable<TaskInfo[]>([]);
