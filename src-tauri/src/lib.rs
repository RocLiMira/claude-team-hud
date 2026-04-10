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

/// Send a message to a team member's inbox.
#[tauri::command]
fn send_message(team: String, to: String, text: String) -> Result<(), String> {
    parser::send_inbox_message(&team, &to, &text)
}

/// Get the session transcript for the lead agent (current session).
/// Reads the JSONL transcript and returns formatted recent entries.
#[tauri::command]
fn get_session_log(lines: Option<u32>) -> Result<String, String> {
    parser::read_session_log(lines.unwrap_or(30))
}

/// Get the content of a tmux pane (for viewing agent terminal output).
#[tauri::command]
fn get_pane_content(pane_id: String, lines: Option<u32>) -> Result<String, String> {
    let start_line = format!("-{}", lines.unwrap_or(50));
    let output = std::process::Command::new("tmux")
        .args(["capture-pane", "-t", &pane_id, "-p", "-S", &start_line])
        .output()
        .map_err(|e| format!("Failed to capture pane {}: {}", pane_id, e))?;

    if !output.status.success() {
        return Err(format!("Pane {} not found", pane_id));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Respond to a permission request from the hook system.
/// Writes a response file that the hook script reads.
#[tauri::command]
fn respond_permission_hook(req_id: String, decision: String, reason: Option<String>) -> Result<(), String> {
    let resp_file = format!("/tmp/claude-hud-permissions/resp-{}.json", req_id);
    let response = serde_json::json!({
        "decision": decision,
        "reason": reason.unwrap_or_default(),
    });
    std::fs::write(&resp_file, serde_json::to_string(&response).unwrap_or_default())
        .map_err(|e| format!("Failed to write response: {}", e))?;
    Ok(())
}

/// Respond to a permission prompt in a tmux pane.
/// key: "y" (allow once), "Y" (always allow), "n" (deny once), "N" (always deny)
#[tauri::command]
fn respond_permission(pane_id: String, key: String) -> Result<(), String> {
    // Claude Code reads single keypresses, no Enter needed
    std::process::Command::new("tmux")
        .args(["send-keys", "-t", &pane_id, &key])
        .output()
        .map_err(|e| format!("Failed to send keys to tmux pane {}: {}", pane_id, e))?;
    Ok(())
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

/// Install the permission hook script and register it in Claude Code settings.
fn install_permission_hook() -> Result<(), String> {
    let home = dirs::home_dir().ok_or("No home dir")?;
    let hooks_dir = home.join(".claude").join("hooks");
    let hook_path = hooks_dir.join("hud-permission.py");
    let settings_path = home.join(".claude").join("settings.json");

    // Create hooks dir
    std::fs::create_dir_all(&hooks_dir)
        .map_err(|e| format!("mkdir failed: {}", e))?;

    // Write hook script (always overwrite to update)
    let hook_script = include_str!("../../hooks/hud-permission.py");
    std::fs::write(&hook_path, hook_script)
        .map_err(|e| format!("write hook failed: {}", e))?;

    // Register in settings.json if not already present
    if settings_path.is_file() {
        let data = std::fs::read_to_string(&settings_path)
            .map_err(|e| format!("read settings failed: {}", e))?;
        let mut settings: serde_json::Value = serde_json::from_str(&data)
            .map_err(|e| format!("parse settings failed: {}", e))?;

        let hooks = settings
            .as_object_mut()
            .and_then(|o| o.entry("hooks").or_insert_with(|| serde_json::json!({})).as_object_mut())
            .and_then(|h| h.entry("PermissionRequest").or_insert_with(|| serde_json::json!([])).as_array_mut());

        if let Some(perm_hooks) = hooks {
            let already_installed = perm_hooks.iter().any(|entry| {
                entry.get("hooks")
                    .and_then(|h| h.as_array())
                    .map(|arr| arr.iter().any(|h| {
                        h.get("command").and_then(|c| c.as_str())
                            .map(|c| c.contains("hud-permission.py"))
                            .unwrap_or(false)
                    }))
                    .unwrap_or(false)
            });

            if !already_installed {
                perm_hooks.push(serde_json::json!({
                    "matcher": "*",
                    "hooks": [{
                        "type": "command",
                        "command": format!("python3 {}", hook_path.display()),
                        "timeout": 300
                    }]
                }));

                let updated = serde_json::to_string_pretty(&settings)
                    .map_err(|e| format!("serialize failed: {}", e))?;
                std::fs::write(&settings_path, updated)
                    .map_err(|e| format!("write settings failed: {}", e))?;

                println!("[setup] Permission hook installed");
            } else {
                println!("[setup] Permission hook already installed");
            }
        }
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // TeamWatcher::new() creates channels and a notify watcher synchronously,
            // then spawns async tasks via tauri::async_runtime (not tokio::spawn)
            // so it works in the setup() context.
            let watcher = watcher::TeamWatcher::new(handle.clone());

            app.manage(Arc::new(Mutex::new(watcher)) as WatcherState);

            // Install permission hook if not already present
            if let Err(e) = install_permission_hook() {
                eprintln!("[setup] Failed to install permission hook: {}", e);
            }

            // Start permission request monitor
            watcher::start_pane_monitor(handle);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_teams,
            get_team_snapshot,
            watch_team,
            stop_watching_team,
            send_message,
            get_session_log,
            get_pane_content,
            respond_permission,
            respond_permission_hook
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
