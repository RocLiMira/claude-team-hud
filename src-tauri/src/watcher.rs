use crate::parser;
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
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
    /// Stop flags for polling tasks. Setting to true causes the task to exit.
    poll_stop_flags: HashMap<String, Arc<AtomicBool>>,
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
            poll_stop_flags: HashMap::new(),
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

        // Cancel any previous polling task for this team
        if let Some(old_flag) = self.poll_stop_flags.remove(team_name) {
            old_flag.store(true, Ordering::Relaxed);
        }

        // Start polling fallback: every 3 seconds, rebuild snapshot
        let stop_flag = Arc::new(AtomicBool::new(false));
        self.poll_stop_flags.insert(team_name.to_string(), stop_flag.clone());

        let poll_team = team_name.to_string();
        let poll_handle = self.app_handle.clone();
        tauri::async_runtime::spawn(async move {
            let mut interval = time::interval(Duration::from_secs(3));
            loop {
                interval.tick().await;
                if stop_flag.load(Ordering::Relaxed) {
                    println!("[watcher/poll] Stopping poll for {}", poll_team);
                    break;
                }
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

    /// Stop watching a team. Removes filesystem watches and cancels the polling task.
    pub fn stop_watching(&mut self, team_name: &str) {
        if !self.watched_teams.remove(team_name) {
            return;
        }

        // Cancel the polling task
        if let Some(flag) = self.poll_stop_flags.remove(team_name) {
            flag.store(true, Ordering::Relaxed);
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
    }
}

/// Type alias for the managed watcher state. Used by Tauri commands.
pub type WatcherState = Arc<Mutex<TeamWatcher>>;

// ---------------------------------------------------------------------------
// Permission Socket Server — Unix domain socket IPC with hook scripts
// ---------------------------------------------------------------------------

use tokio::net::UnixListener;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::unix::OwnedWriteHalf;

/// Pending permission requests waiting for user decision.
/// Key: req_id (auto-incrementing), Value: socket write half to send response.
pub type PendingPermissions = Arc<Mutex<HashMap<String, OwnedWriteHalf>>>;

/// Start Unix socket server at /tmp/claude-hud.sock.
/// Receives PermissionRequest events from hook scripts, emits to frontend,
/// and holds the socket connection open until the user responds.
pub fn start_permission_socket(app_handle: AppHandle) -> PendingPermissions {
    let pending: PendingPermissions = Arc::new(Mutex::new(HashMap::new()));
    let pending_clone = pending.clone();

    tauri::async_runtime::spawn(async move {
        let socket_path = "/tmp/claude-hud.sock";

        // Remove stale socket file
        let _ = std::fs::remove_file(socket_path);

        let listener = match UnixListener::bind(socket_path) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[perm-socket] Failed to bind {}: {}", socket_path, e);
                return;
            }
        };

        // Set permissions so only the current user can connect
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(
                socket_path,
                std::fs::Permissions::from_mode(0o700),
            );
        }

        println!("[perm-socket] Listening on {}", socket_path);

        let mut req_counter: u64 = 0;

        loop {
            let (stream, _) = match listener.accept().await {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("[perm-socket] Accept error: {}", e);
                    continue;
                }
            };

            req_counter += 1;
            let req_id = format!("perm-{}", req_counter);
            let pending_inner = pending_clone.clone();
            let handle = app_handle.clone();

            tokio::spawn(async move {
                handle_permission_connection(stream, req_id, pending_inner, handle).await;
            });
        }
    });

    pending
}

/// Handle a single connection from the hook script.
async fn handle_permission_connection(
    stream: tokio::net::UnixStream,
    req_id: String,
    pending: PendingPermissions,
    app_handle: AppHandle,
) {
    let (mut reader, writer) = stream.into_split();

    // Read the event JSON from the hook script
    let mut buf = vec![0u8; 65536];
    let n = match tokio::time::timeout(Duration::from_secs(5), reader.read(&mut buf)).await {
        Ok(Ok(n)) if n > 0 => n,
        _ => return,
    };

    let data = &buf[..n];
    let event: serde_json::Value = match serde_json::from_slice(data) {
        Ok(v) => v,
        Err(_) => return,
    };

    let status = event.get("status").and_then(|s| s.as_str()).unwrap_or("");

    if status == "waiting_for_approval" {
        // Permission request — keep connection open, store writer for response
        let description = event.get("description")
            .and_then(|s| s.as_str())
            .unwrap_or("Permission requested")
            .to_string();
        let session_id = event.get("session_id")
            .and_then(|s| s.as_str())
            .unwrap_or("unknown")
            .to_string();
        let tool_name = event.get("tool_name")
            .and_then(|s| s.as_str())
            .unwrap_or("unknown")
            .to_string();

        println!("[perm-socket] Permission request {}: {}", req_id, description);

        // Store the writer half so we can respond later
        {
            let mut map = pending.lock().unwrap();
            map.insert(req_id.clone(), writer);
        }

        // Emit to frontend
        let perm_req = crate::models::PermissionRequest {
            agent_name: session_id,
            pane_id: req_id,  // Use req_id as the identifier for responding
            prompt_text: format!("[{}] {}", tool_name, description),
            timestamp: chrono_now_iso(),
        };

        if let Err(e) = app_handle.emit("permission-request", &perm_req) {
            eprintln!("[perm-socket] Failed to emit: {}", e);
        }
    }
    // Non-permission events: connection closes automatically (writer is dropped)
}

/// Send a response to a pending permission request via its socket connection.
pub async fn respond_to_permission(
    pending: &PendingPermissions,
    req_id: &str,
    decision: &str,
    reason: Option<&str>,
) -> Result<(), String> {
    let mut writer = {
        let mut map = pending.lock().map_err(|e| format!("Lock error: {}", e))?;
        map.remove(req_id)
            .ok_or_else(|| format!("No pending permission for {}", req_id))?
    };

    let response = serde_json::json!({
        "decision": decision,
        "reason": reason.unwrap_or(""),
    });
    let data = serde_json::to_vec(&response)
        .map_err(|e| format!("Serialize error: {}", e))?;

    writer.write_all(&data).await
        .map_err(|e| format!("Write error: {}", e))?;
    writer.shutdown().await
        .map_err(|e| format!("Shutdown error: {}", e))?;

    println!("[perm-socket] Responded to {}: {}", req_id, decision);
    Ok(())
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

