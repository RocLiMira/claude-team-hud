pub mod models;
pub mod parser;
pub mod watcher;

use std::sync::{Arc, Mutex};
use tauri::Manager;
use watcher::WatcherState;

/// List available teams from ~/.claude/teams/
#[tauri::command]
fn list_teams() -> Vec<String> {
    let teams_dir = dirs::home_dir()
        .map(|h| h.join(".claude").join("teams"))
        .unwrap_or_default();

    if !teams_dir.exists() {
        return vec![];
    }

    std::fs::read_dir(&teams_dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .filter(|e| e.path().join("config.json").exists())
                .filter_map(|e| e.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default()
}

/// Get a snapshot of a team's current state
#[tauri::command]
fn get_team_snapshot(team: String) -> Result<models::TeamSnapshot, String> {
    parser::build_team_snapshot(&team)
}

/// Start watching a team for filesystem changes.
/// Registers FS watches and starts a polling fallback.
#[tauri::command]
fn watch_team(
    team: String,
    state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    let mut watcher = state
        .lock()
        .map_err(|e| format!("Failed to acquire watcher lock: {}", e))?;
    watcher.watch_team(&team)
}

/// Stop watching a team.
#[tauri::command]
fn stop_watching_team(
    team: String,
    state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    let mut watcher = state
        .lock()
        .map_err(|e| format!("Failed to acquire watcher lock: {}", e))?;
    watcher.stop_watching(&team);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // Initialize the filesystem watcher with a tokio runtime context.
            // Tauri v2 provides a tokio runtime, but setup() runs synchronously
            // on the main thread. We create the watcher inside a spawned task
            // that has access to the tokio runtime, then store it in managed state.
            let watcher = tokio::runtime::Handle::current().block_on(async {
                watcher::TeamWatcher::new(handle)
            });

            app.manage(Arc::new(Mutex::new(watcher)) as WatcherState);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_teams,
            get_team_snapshot,
            watch_team,
            stop_watching_team
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
