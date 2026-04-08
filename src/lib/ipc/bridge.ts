/**
 * Tauri IPC bridge — connects Rust backend events to Svelte stores.
 * In dev/mock mode, generates synthetic data for testing.
 */

let unlisten: (() => void) | null = null;

export async function initBridge(): Promise<void> {
  // TODO: In Tauri context, listen to "team-update" events
  // For now, stub for standalone frontend development
  console.log("[bridge] IPC bridge initialized (stub mode)");
}

export function destroyBridge(): void {
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
  console.log("[bridge] IPC bridge destroyed");
}
