use crate::parser;
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio::time::{self, Duration};

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

fn claude_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude"))
}

fn teams_dir() -> Option<PathBuf> {
    claude_dir().map(|d| d.join("teams"))
}

fn tasks_dir() -> Option<PathBuf> {
    claude_dir().map(|d| d.join("tasks"))
}

// ---------------------------------------------------------------------------
// TeamWatcher
// ---------------------------------------------------------------------------

pub struct TeamWatcher {
    /// The filesystem watcher (None if creation failed).
    _watcher: Option<RecommendedWatcher>,
    /// Channel sender for the debounce task. Sends team names that had changes.
    debounce_tx: mpsc::UnboundedSender<String>,
    /// Teams currently being watched.
    watched_teams: HashSet<String>,
    /// Paths we've registered with the notify watcher, so we can unwatch them.
    watched_paths: Vec<(String, PathBuf)>,
    /// App handle for spawning polling tasks.
    app_handle: AppHandle,
}

impl TeamWatcher {
    /// Create a new TeamWatcher and start the debounce consumer task.
    pub fn new(app_handle: AppHandle) -> Self {
        let (debounce_tx, debounce_rx) = mpsc::unbounded_channel::<String>();

        // Start the debounce consumer task
        let handle_clone = app_handle.clone();
        tauri::async_runtime::spawn(Self::debounce_loop(debounce_rx, handle_clone));

        // Create the notify watcher. The event callback sends team names into
        // the debounce channel.
        let tx_for_watcher = debounce_tx.clone();
        let watcher = Self::create_watcher(tx_for_watcher);

        if watcher.is_none() {
            eprintln!("[watcher] Failed to create filesystem watcher; relying on polling fallback");
        }

        TeamWatcher {
            _watcher: watcher,
            debounce_tx,
            watched_teams: HashSet::new(),
            watched_paths: Vec::new(),
            app_handle,
        }
    }

    /// Create a RecommendedWatcher that maps filesystem events to team names
    /// and sends them into the debounce channel.
    fn create_watcher(
        tx: mpsc::UnboundedSender<String>,
    ) -> Option<RecommendedWatcher> {
        let teams_root = teams_dir()?;
        let tasks_root = tasks_dir()?;

        let watcher = RecommendedWatcher::new(
            move |res: Result<notify::Event, notify::Error>| {
                let event = match res {
                    Ok(ev) => ev,
                    Err(e) => {
                        eprintln!("[watcher] notify error: {}", e);
                        return;
                    }
                };

                // Determine which team(s) are affected by looking at the paths.
                for path in &event.paths {
                    let team_name = Self::team_name_from_path(path, &teams_root, &tasks_root);
                    if let Some(name) = team_name {
                        let _ = tx.send(name);
                    }
                }
            },
            Config::default(),
        )
        .ok()?;

        Some(watcher)
    }

    /// Extract a team name from a changed file path by checking if it falls
    /// under the teams or tasks directories.
    fn team_name_from_path(
        path: &std::path::Path,
        teams_root: &std::path::Path,
        tasks_root: &std::path::Path,
    ) -> Option<String> {
        // Try teams dir: ~/.claude/teams/{team}/...
        if let Ok(rel) = path.strip_prefix(teams_root) {
            if let Some(first) = rel.components().next() {
                return Some(first.as_os_str().to_string_lossy().to_string());
            }
        }
        // Try tasks dir: ~/.claude/tasks/{team}/...
        if let Ok(rel) = path.strip_prefix(tasks_root) {
            if let Some(first) = rel.components().next() {
                return Some(first.as_os_str().to_string_lossy().to_string());
            }
        }
        None
    }

    /// The debounce consumer loop. Receives team names, waits 200ms to batch
    /// rapid changes, deduplicates, then builds snapshots and emits events.
    async fn debounce_loop(
        mut rx: mpsc::UnboundedReceiver<String>,
        app_handle: AppHandle,
    ) {
        loop {
            // Wait for the first event
            let first = match rx.recv().await {
                Some(name) => name,
                None => return, // channel closed
            };

            // Collect into a set, starting with the first
            let mut batch = HashSet::new();
            batch.insert(first);

            // Wait 200ms to let more events accumulate
            time::sleep(Duration::from_millis(200)).await;

            // Drain any additional events that arrived during the window
            while let Ok(name) = rx.try_recv() {
                batch.insert(name);
            }

            // Process each unique team
            for team_name in batch {
                match parser::build_team_snapshot(&team_name) {
                    Ok(snapshot) => {
                        if let Err(e) = app_handle.emit("team-update", &snapshot) {
                            eprintln!("[watcher] Failed to emit team-update for {}: {}", team_name, e);
                        }
                    }
                    Err(e) => {
                        eprintln!("[watcher] Failed to build snapshot for {}: {}", team_name, e);
                    }
                }
            }
        }
    }

    /// Start watching a team. Registers filesystem watches on the team's
    /// config/inbox dirs and task dir, and starts a 3-second polling fallback.
    pub fn watch_team(&mut self, team_name: &str) -> Result<(), String> {
        if self.watched_teams.contains(team_name) {
            return Ok(()); // already watching
        }

        let team_dir = teams_dir()
            .map(|d| d.join(team_name))
            .ok_or_else(|| "Could not determine home directory".to_string())?;

        let task_dir = tasks_dir()
            .map(|d| d.join(team_name))
            .ok_or_else(|| "Could not determine home directory".to_string())?;

        // Register FS watches if watcher is available
        if let Some(ref mut watcher) = self._watcher {
            // Watch team directory (config, inboxes)
            if team_dir.is_dir() {
                if let Err(e) = watcher.watch(&team_dir, RecursiveMode::Recursive) {
                    eprintln!(
                        "[watcher] Failed to watch team dir {}: {}",
                        team_dir.display(),
                        e
                    );
                } else {
                    self.watched_paths
                        .push((team_name.to_string(), team_dir.clone()));
                }
            }

            // Watch task directory
            if task_dir.is_dir() {
                if let Err(e) = watcher.watch(&task_dir, RecursiveMode::Recursive) {
                    eprintln!(
                        "[watcher] Failed to watch task dir {}: {}",
                        task_dir.display(),
                        e
                    );
                } else {
                    self.watched_paths
                        .push((team_name.to_string(), task_dir));
                }
            }
        }

        self.watched_teams.insert(team_name.to_string());

        // Start polling fallback: every 3 seconds, rebuild snapshot
        let poll_team = team_name.to_string();
        let poll_handle = self.app_handle.clone();
        tauri::async_runtime::spawn(async move {
            let mut interval = time::interval(Duration::from_secs(3));
            loop {
                interval.tick().await;
                match parser::build_team_snapshot(&poll_team) {
                    Ok(snapshot) => {
                        if let Err(e) = poll_handle.emit("team-update", &snapshot) {
                            eprintln!(
                                "[watcher/poll] Failed to emit for {}: {}",
                                poll_team, e
                            );
                        }
                    }
                    Err(e) => {
                        eprintln!(
                            "[watcher/poll] Failed to build snapshot for {}: {}",
                            poll_team, e
                        );
                    }
                }
            }
        });

        // Emit an immediate snapshot
        let _ = self.debounce_tx.send(team_name.to_string());

        Ok(())
    }

    /// Stop watching a team. Removes filesystem watches.
    pub fn stop_watching(&mut self, team_name: &str) {
        if !self.watched_teams.remove(team_name) {
            return;
        }

        if let Some(ref mut watcher) = self._watcher {
            let paths_to_remove: Vec<PathBuf> = self
                .watched_paths
                .iter()
                .filter(|(name, _)| name == team_name)
                .map(|(_, path)| path.clone())
                .collect();

            for path in &paths_to_remove {
                if let Err(e) = watcher.unwatch(path) {
                    eprintln!(
                        "[watcher] Failed to unwatch {}: {}",
                        path.display(),
                        e
                    );
                }
            }

            self.watched_paths.retain(|(name, _)| name != team_name);
        }

        // Note: the polling task will keep running. In a production version we'd
        // store a JoinHandle or cancellation token. For V1 this is acceptable --
        // the poll simply rebuilds a snapshot that the frontend ignores if the
        // team is no longer displayed. The task will be cleaned up when the app
        // exits.
    }
}

/// Type alias for the managed watcher state. Used by Tauri commands.
pub type WatcherState = Arc<Mutex<TeamWatcher>>;

// ---------------------------------------------------------------------------
// Tmux Pane Monitor — detects permission prompts
// ---------------------------------------------------------------------------

/// Start a background task that monitors /tmp/claude-hud-permissions/ for hook-based
/// permission requests. Much more reliable than tmux pane scraping.
pub fn start_pane_monitor(app_handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let perm_dir = std::path::PathBuf::from("/tmp/claude-hud-permissions");
        let mut seen_requests: std::collections::HashSet<String> = std::collections::HashSet::new();

        loop {
            time::sleep(Duration::from_millis(500)).await;

            if !perm_dir.is_dir() {
                continue;
            }

            let entries = match std::fs::read_dir(&perm_dir) {
                Ok(e) => e,
                Err(_) => continue,
            };

            for entry in entries.flatten() {
                let path = entry.path();
                let name = match path.file_name().and_then(|n| n.to_str()) {
                    Some(n) => n.to_string(),
                    None => continue,
                };

                // Only process request files (not response files)
                if !name.starts_with("req-") || !name.ends_with(".json") {
                    continue;
                }

                // Skip already seen requests
                if seen_requests.contains(&name) {
                    continue;
                }

                let data = match std::fs::read_to_string(&path) {
                    Ok(d) => d,
                    Err(_) => continue,
                };

                let request: serde_json::Value = match serde_json::from_str(&data) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                seen_requests.insert(name);

                let req = crate::models::PermissionRequest {
                    agent_name: request.get("session_id")
                        .and_then(|s| s.as_str())
                        .unwrap_or("unknown")
                        .to_string(),
                    pane_id: request.get("id")
                        .and_then(|s| s.as_str())
                        .unwrap_or("")
                        .to_string(),
                    prompt_text: request.get("description")
                        .and_then(|s| s.as_str())
                        .unwrap_or("Permission requested")
                        .to_string(),
                    timestamp: chrono_now_iso(),
                };

                if let Err(e) = app_handle.emit("permission-request", &req) {
                    eprintln!("[perm-monitor] Failed to emit: {}", e);
                }
            }

            // Cleanup seen requests that no longer have files
            seen_requests.retain(|name| perm_dir.join(name).exists());
        }
    });
}

/// Check tmux pane output for Claude Code permission prompt patterns.
///
/// Real Claude Code prompts look like:
/// ```
/// Claude wants to run: Bash: npm install lodash
/// [y] Allow once  [Y] Always allow  [n] Deny once  [N] Always deny
/// ```
/// Or:
/// ```
/// Claude wants to edit file.ts
/// [y] Allow once  ...
/// ```
fn detect_permission_prompt(output: &str) -> Option<String> {
    let lines: Vec<&str> = output.lines().collect();

    // Scan from bottom up for the most recent prompt
    for (i, line) in lines.iter().enumerate().rev() {
        let trimmed = line.trim();

        // Primary pattern: "[y] Allow once" or "[Y] Always allow"
        let is_choice_line = trimmed.contains("[y]") && trimmed.contains("Allow")
            || trimmed.contains("[Y]") && trimmed.contains("Always");

        // Secondary pattern: "Allow?" or "(y/n)" for older versions
        let is_legacy = trimmed.contains("Allow?")
            || (trimmed.contains("(y/n)") && trimmed.len() < 60);

        if is_choice_line || is_legacy {
            // Collect context: look above for "Claude wants to..." line
            let mut context_lines: Vec<&str> = Vec::new();
            let start = if i >= 5 { i - 5 } else { 0 };
            for j in start..=i {
                let l = lines[j].trim();
                if !l.is_empty() {
                    context_lines.push(lines[j]);
                }
            }
            return Some(context_lines.join("\n").trim().to_string());
        }
    }

    None
}

/// Simple ISO timestamp for now.
fn chrono_now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    crate::parser::format_timestamp_iso(millis as u64)
}

