pub mod models;

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
    // TODO: Implement full parsing in parser.rs
    Ok(models::TeamSnapshot {
        team_name: team,
        agents: vec![],
        tasks: vec![],
        messages: vec![],
        token_usage: models::TokenUsage::default(),
        session_start: None,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![list_teams, get_team_snapshot])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
