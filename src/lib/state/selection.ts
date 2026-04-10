import { writable } from "svelte/store";

export interface SelectedAgent {
  name: string;
  role: string;
  paneId: string;
}

/** Currently selected agent (clicked in office view). null = none selected. */
export const selectedAgentStore = writable<SelectedAgent | null>(null);
