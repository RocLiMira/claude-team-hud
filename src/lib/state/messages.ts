import { writable } from "svelte/store";

export interface MessageInfo {
  from: string;
  to: string;
  text: string;
  timestamp: string;
  read: boolean;
}

export const messagesStore = writable<MessageInfo[]>([]);
