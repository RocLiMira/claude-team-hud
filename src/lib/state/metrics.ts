import { writable } from "svelte/store";

export interface TokenMetrics {
  totalTokens: number;
  perAgent: Record<string, number>;
  burnRate: number;
  costUsd: number;
  rateLimitPct: number;
  rateLimitReset: string | null;
}

export interface EnvironmentState {
  perAgent: Record<string, {
    fileStackLevel: 0 | 1 | 2 | 3 | 4 | 5;
    coffeeCount: 0 | 1 | 2 | 3 | 4 | 5;
    plantLevel: 0 | 1 | 2 | 3 | 4 | 5;
    trashLevel: 0 | 1 | 2 | 3;
    monitorState: "code" | "review" | "design" | "idle" | "error" | "meeting" | "off";
    roleSpecificLevel: 0 | 1 | 2 | 3 | 4 | 5;
  }>;
  global: {
    whiteboardProgress: 0 | 1 | 2 | 3 | 4;
    serverLoad: 0 | 1 | 2 | 3;
    breakAreaMorale: 0 | 1 | 2 | 3;
    windowWeather: "sunny" | "cloudy" | "rainy" | "stormy";
  };
}

export const metricsStore = writable<TokenMetrics>({
  totalTokens: 0,
  perAgent: {},
  burnRate: 0,
  costUsd: 0,
  rateLimitPct: 0,
  rateLimitReset: null,
});

export const environmentStore = writable<EnvironmentState>({
  perAgent: {},
  global: {
    whiteboardProgress: 0,
    serverLoad: 0,
    breakAreaMorale: 0,
    windowWeather: "sunny",
  },
});
