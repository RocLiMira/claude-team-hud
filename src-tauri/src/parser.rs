use crate::models::{AgentState, AgentStatus, Message, TaskState, TeamSnapshot, TokenUsage};
use serde::Deserialize;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Internal deserialization types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct ConfigMember {
    name: String,
    #[serde(rename = "agentId")]
    agent_id: String,
    #[serde(rename = "agentType", default)]
    #[allow(dead_code)]
    agent_type: Option<String>,
    #[serde(rename = "isActive", default)]
    is_active: Option<bool>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    color: Option<String>,
    #[serde(rename = "tmuxPaneId", default)]
    tmux_pane_id: Option<String>,
    #[serde(rename = "backendType", default)]
    backend_type: Option<String>,
}

#[derive(Deserialize)]
struct RawConfig {
    members: Vec<ConfigMember>,
}

#[derive(Deserialize)]
struct InboxMessage {
    from: String,
    text: String,
    timestamp: String,
    #[serde(default)]
    read: bool,
}

/// Minimal shape of a JSONL transcript entry. We only care about
/// `type == "assistant"` entries that carry usage information.
#[derive(Deserialize)]
struct TranscriptEntry {
    #[serde(rename = "type")]
    entry_type: Option<String>,
    message: Option<TranscriptMessage>,
    timestamp: Option<String>,
}

#[derive(Deserialize)]
struct TranscriptMessage {
    usage: Option<TranscriptUsage>,
}

#[derive(Deserialize)]
struct TranscriptUsage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
}

/// Minimal shape of a session file under ~/.claude/sessions/*.json
#[derive(Deserialize)]
struct SessionFile {
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    cwd: Option<String>,
}

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
// Session discovery
// ---------------------------------------------------------------------------

/// Find the most recently modified session file and return (session_id, cwd).
fn find_latest_session() -> Option<(String, String)> {
    let sessions_dir = claude_dir()?.join("sessions");
    if !sessions_dir.is_dir() {
        return None;
    }

    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;

    let entries = fs::read_dir(&sessions_dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(meta) = fs::metadata(&path) {
            let mtime = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
            if best.as_ref().map_or(true, |(t, _)| mtime > *t) {
                best = Some((mtime, path));
            }
        }
    }

    let (_, path) = best?;
    let data = fs::read_to_string(&path).ok()?;
    let session: SessionFile = serde_json::from_str(&data).ok()?;

    Some((session.session_id?, session.cwd?))
}

/// Find the session matching the current working directory (where team lead runs).
/// Unlike find_latest_session, this won't return sessions from other projects.
fn find_session_for_cwd() -> Option<(String, String)> {
    let sessions_dir = claude_dir()?.join("sessions");
    if !sessions_dir.is_dir() {
        return None;
    }

    // First get the team lead's CWD from any active team config
    let teams_root = teams_dir()?;
    let mut target_cwd: Option<String> = None;

    if let Ok(entries) = fs::read_dir(&teams_root) {
        for entry in entries.flatten() {
            let config_path = entry.path().join("config.json");
            if let Ok(data) = fs::read_to_string(&config_path) {
                if let Ok(config) = serde_json::from_str::<serde_json::Value>(&data) {
                    if let Some(members) = config.get("members").and_then(|m| m.as_array()) {
                        for member in members {
                            if member.get("name").and_then(|n| n.as_str()) == Some("team-lead") {
                                if let Some(cwd) = member.get("cwd").and_then(|c| c.as_str()) {
                                    target_cwd = Some(cwd.to_string());
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            if target_cwd.is_some() { break; }
        }
    }

    let target_cwd = target_cwd?;

    // Find the most recent session with matching CWD
    let mut best: Option<(std::time::SystemTime, String, String)> = None;

    if let Ok(entries) = fs::read_dir(&sessions_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            if let Ok(data) = fs::read_to_string(&path) {
                if let Ok(session) = serde_json::from_str::<SessionFile>(&data) {
                    if let (Some(sid), Some(cwd)) = (session.session_id, session.cwd) {
                        if cwd == target_cwd {
                            if let Ok(meta) = fs::metadata(&path) {
                                let mtime = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
                                if best.as_ref().map_or(true, |(t, _, _)| mtime > *t) {
                                    best = Some((mtime, sid, cwd));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    best.map(|(_, sid, cwd)| (sid, cwd))
}

/// Escape a cwd path the same way Claude Code does for the projects directory.
/// Slashes become dashes, e.g. "/Users/me/project" -> "-Users-me-project"
fn escape_cwd(cwd: &str) -> String {
    cwd.replace('/', "-")
}

/// Resolve the JSONL transcript path for a given agent.
/// First tries the subagent path, then scans project JSONL files for team transcripts.
fn resolve_transcript_path(agent_id: &str) -> Option<PathBuf> {
    let (_session_id, cwd) = find_latest_session()?;
    let escaped = escape_cwd(&cwd);
    let projects_dir = claude_dir()?.join("projects").join(&escaped);

    // Old approach: subagent transcript (kept for non-team agents)
    let subagent_path = projects_dir
        .join(&_session_id)
        .join("subagents")
        .join(format!("agent-{}.jsonl", agent_id));
    if subagent_path.is_file() {
        return Some(subagent_path);
    }

    None
}

/// Resolve transcript path for a team agent by scanning JSONL files for teamName/agentName.
/// Team agents have their own top-level JSONL transcripts (not in subagents/).
fn resolve_team_transcript(team_name: &str, agent_name: &str) -> Option<PathBuf> {
    let (_session_id, cwd) = find_latest_session()?;
    let escaped = escape_cwd(&cwd);
    let projects_dir = claude_dir()?.join("projects").join(&escaped);

    if !projects_dir.is_dir() {
        return None;
    }

    let entries = fs::read_dir(&projects_dir).ok()?;
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        // Skip subagent directories
        if path.to_str().map_or(false, |s| s.contains("subagents")) {
            continue;
        }

        // Read first few lines to check teamName and agentName
        let file = match fs::File::open(&path) {
            Ok(f) => f,
            Err(_) => continue,
        };
        let reader = BufReader::new(file);
        let mut matched = false;

        for (i, line) in reader.lines().enumerate() {
            if i >= 5 { break; } // Only check first 5 lines
            let line = match line {
                Ok(l) => l,
                Err(_) => continue,
            };
            // Quick string check before full parse
            if !line.contains("teamName") { continue; }
            if let Ok(entry) = serde_json::from_str::<serde_json::Value>(&line) {
                if entry.get("teamName").and_then(|v| v.as_str()) == Some(team_name)
                    && entry.get("agentName").and_then(|v| v.as_str()) == Some(agent_name)
                {
                    matched = true;
                    break;
                }
            }
        }

        if matched {
            // Track the most recently modified matching file
            if let Ok(meta) = fs::metadata(&path) {
                let mtime = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
                if best.as_ref().map_or(true, |(t, _)| mtime > *t) {
                    best = Some((mtime, path));
                }
            }
        }
    }

    best.map(|(_, p)| p)
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/// Parse team config.json, returning (members list).
fn parse_team_config(team_dir: &Path) -> Result<Vec<ConfigMember>, String> {
    let config_path = team_dir.join("config.json");
    let data = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config.json at {}: {}", config_path.display(), e))?;
    let config: RawConfig = serde_json::from_str(&data)
        .map_err(|e| format!("Failed to parse config.json: {}", e))?;
    Ok(config.members)
}

/// Parse all task files from ~/.claude/tasks/{team}/*.json
fn parse_tasks(team_name: &str) -> Result<Vec<TaskState>, String> {
    let dir = match tasks_dir() {
        Some(d) => d.join(team_name),
        None => return Ok(vec![]),
    };

    if !dir.is_dir() {
        return Ok(vec![]);
    }

    let entries = fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read tasks dir: {}", e))?;

    let mut tasks = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        match fs::read_to_string(&path) {
            Ok(data) => match serde_json::from_str::<TaskState>(&data) {
                Ok(task) => tasks.push(task),
                Err(e) => {
                    eprintln!("Skipping malformed task file {}: {}", path.display(), e);
                }
            },
            Err(e) => {
                eprintln!("Failed to read task file {}: {}", path.display(), e);
            }
        }
    }

    Ok(tasks)
}

/// Parse a single agent's inbox file. The `to` field is derived from the filename.
fn parse_inbox(inbox_path: &Path, agent_name: &str) -> Result<Vec<Message>, String> {
    let data = fs::read_to_string(inbox_path)
        .map_err(|e| format!("Failed to read inbox {}: {}", inbox_path.display(), e))?;

    let raw_messages: Vec<InboxMessage> = serde_json::from_str(&data)
        .map_err(|e| format!("Failed to parse inbox {}: {}", inbox_path.display(), e))?;

    Ok(raw_messages
        .into_iter()
        .map(|m| Message {
            from: m.from,
            to: agent_name.to_string(),
            text: m.text,
            timestamp: m.timestamp,
            read: m.read,
        })
        .collect())
}

/// Parse all inbox files from {team_dir}/inboxes/*.json
fn parse_all_inboxes(team_dir: &Path) -> Result<Vec<Message>, String> {
    let inboxes_dir = team_dir.join("inboxes");
    if !inboxes_dir.is_dir() {
        return Ok(vec![]);
    }

    let entries = fs::read_dir(&inboxes_dir)
        .map_err(|e| format!("Failed to read inboxes dir: {}", e))?;

    let mut messages = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        // Derive agent name from filename: "qa-engineer.json" -> "qa-engineer"
        let agent_name = match path.file_stem().and_then(|s| s.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };
        match parse_inbox(&path, &agent_name) {
            Ok(mut msgs) => messages.append(&mut msgs),
            Err(e) => {
                eprintln!("Skipping malformed inbox {}: {}", path.display(), e);
            }
        }
    }

    Ok(messages)
}

/// Sum input_tokens + output_tokens from all assistant entries in a JSONL transcript.
/// Returns (total_tokens, first_timestamp).
fn parse_agent_transcript(jsonl_path: &Path) -> (u64, Option<String>) {
    let file = match fs::File::open(jsonl_path) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("Failed to open transcript {}: {}", jsonl_path.display(), e);
            return (0, None);
        }
    };

    let reader = BufReader::new(file);
    let mut total: u64 = 0;
    let mut first_timestamp: Option<String> = None;

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let entry: TranscriptEntry = match serde_json::from_str(trimmed) {
            Ok(e) => e,
            Err(_) => continue, // skip malformed lines
        };

        // Record the very first timestamp we encounter (for spawn_time)
        if first_timestamp.is_none() {
            if let Some(ref ts) = entry.timestamp {
                first_timestamp = Some(ts.clone());
            }
        }

        // Only count tokens from assistant entries
        if entry.entry_type.as_deref() != Some("assistant") {
            continue;
        }

        if let Some(msg) = entry.message {
            if let Some(usage) = msg.usage {
                total += usage.input_tokens.unwrap_or(0);
                total += usage.output_tokens.unwrap_or(0);
            }
        }
    }

    (total, first_timestamp)
}

/// Derive agent status from tasks. Refined logic:
/// - If agent owns an in_progress task whose blockedBy contains tasks that are
///   not yet completed -> Blocked
/// - If agent owns any in_progress task -> Working
/// - Otherwise -> Idle
fn derive_agent_status(agent_name: &str, tasks: &[TaskState]) -> (AgentStatus, Option<String>) {
    let owned: Vec<&TaskState> = tasks
        .iter()
        .filter(|t| t.owner.as_deref() == Some(agent_name))
        .collect();

    // Build a lookup of task statuses by id for checking blockers
    let status_map: HashMap<&str, &str> = tasks
        .iter()
        .map(|t| (t.id.as_str(), t.status.as_str()))
        .collect();

    let mut has_in_progress = false;
    let mut current_task: Option<String> = None;

    for task in &owned {
        if task.status == "in_progress" || task.status == "in-progress" {
            has_in_progress = true;
            current_task = Some(task.subject.clone());

            // Check if any blocker is still incomplete
            let has_incomplete_blocker = task.blocked_by.iter().any(|blocker_id| {
                match status_map.get(blocker_id.as_str()) {
                    Some(&status) => status != "completed",
                    None => true, // unknown blocker treated as incomplete
                }
            });

            if !task.blocked_by.is_empty() && has_incomplete_blocker {
                return (AgentStatus::Blocked, current_task);
            }
        }
    }

    if has_in_progress {
        return (AgentStatus::Working, current_task);
    }

    (AgentStatus::Idle, None)
}

/// Parse an ISO 8601 timestamp and return minutes elapsed since then.
fn chrono_elapsed_minutes(iso_str: &str) -> f64 {
    // Simple ISO 8601 parse: "2026-04-09T08:11:09.782Z"
    // Extract components manually to avoid adding chrono dependency
    use std::time::{SystemTime, UNIX_EPOCH};

    let parts: Vec<&str> = iso_str.split('T').collect();
    if parts.len() != 2 { return 0.0; }

    let date_parts: Vec<u64> = parts[0].split('-').filter_map(|s| s.parse().ok()).collect();
    let time_str = parts[1].trim_end_matches('Z');
    let time_parts: Vec<f64> = time_str.split(':').filter_map(|s| s.parse().ok()).collect();

    if date_parts.len() < 3 || time_parts.len() < 3 { return 0.0; }

    // Rough epoch calculation (good enough for elapsed time)
    let y = date_parts[0];
    let m = date_parts[1];
    let d = date_parts[2];
    let days_approx = (y - 1970) * 365 + (y - 1969) / 4 + match m {
        1 => 0, 2 => 31, 3 => 59, 4 => 90, 5 => 120, 6 => 151,
        7 => 181, 8 => 212, 9 => 243, 10 => 273, 11 => 304, 12 => 334, _ => 0,
    } + d - 1;
    let secs_then = days_approx * 86400 + (time_parts[0] as u64) * 3600
        + (time_parts[1] as u64) * 60 + time_parts[2] as u64;

    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    if now_secs > secs_then {
        (now_secs - secs_then) as f64 / 60.0
    } else {
        0.0
    }
}

/// Parse rate limit percentage from tmux pane status bars.
/// Looks for "Usage ...XX%" pattern in any active agent's pane.
fn parse_rate_limit_from_panes(members: &[ConfigMember]) -> (f64, Option<String>) {
    for member in members {
        let pane_id = match &member.tmux_pane_id {
            Some(id) if !id.is_empty() => id,
            _ => continue,
        };

        let output = match std::process::Command::new("tmux")
            .args(["capture-pane", "-t", pane_id, "-p", "-S", "-5"])
            .output()
        {
            Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).to_string(),
            _ => continue,
        };

        for line in output.lines().rev() {
            if let Some((pct, reset)) = extract_usage_info(line) {
                return (pct, reset);
            }
        }
    }
    (0.0, None)
}

/// Extract usage percentage and reset time from a line like:
/// "Usage █░░░ 13% (resets in 3h 54m)"
fn extract_usage_info(line: &str) -> Option<(f64, Option<String>)> {
    let usage_pos = line.find("Usage")?;
    let after_usage = &line[usage_pos..];

    // Find "XX%" pattern
    let mut pct: Option<f64> = None;
    let chars: Vec<char> = after_usage.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '%' && i > 0 {
            let mut j = i - 1;
            while j > 0 && (chars[j].is_ascii_digit() || chars[j] == '.') {
                j -= 1;
            }
            let num_str: String = chars[j + 1..i].iter().collect();
            if let Ok(p) = num_str.parse::<f64>() {
                pct = Some(p);
            }
        }
        i += 1;
    }

    let pct = pct?;

    // Extract "resets in Xh Xm" from parentheses
    let reset = if let Some(start) = after_usage.find("resets in ") {
        let rest = &after_usage[start + 10..];
        let end = rest.find(')').unwrap_or(rest.len());
        Some(rest[..end].trim().to_string())
    } else {
        None
    };

    Some((pct, reset))
}

/// Check if a tmux pane has an active Claude Code agent.
/// Uses #{pane_current_command} — if it's a shell (bash/zsh), Claude has exited.
fn is_agent_alive_in_pane(pane_id: &str) -> bool {
    let output = match std::process::Command::new("tmux")
        .args(["display-message", "-t", pane_id, "-p", "#{pane_current_command}"])
        .output()
    {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        _ => return false, // Pane doesn't exist
    };

    // If current command is a shell, Claude Code has exited
    let dead_commands = ["bash", "zsh", "sh", "fish"];
    if dead_commands.iter().any(|&cmd| output == cmd) {
        return false;
    }

    // If empty, pane might be gone
    if output.is_empty() {
        return false;
    }

    true
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Build a complete TeamSnapshot by reading all relevant files.
pub fn build_team_snapshot(team_name: &str) -> Result<TeamSnapshot, String> {
    let team_dir = match teams_dir() {
        Some(d) => d.join(team_name),
        None => return Err("Could not determine home directory".to_string()),
    };

    if !team_dir.is_dir() {
        return Err(format!("Team directory not found: {}", team_dir.display()));
    }

    // 1. Parse config
    let members = parse_team_config(&team_dir)?;

    // 2. Parse tasks
    let tasks = parse_tasks(team_name)?;

    // 3. Parse messages
    let messages = parse_all_inboxes(&team_dir)?;

    // 4. Build per-agent state
    let mut agents = Vec::new();
    let mut per_agent_tokens: HashMap<String, u64> = HashMap::new();
    let mut total_tokens: u64 = 0;
    let mut earliest_timestamp: Option<String> = None;

    for member in &members {
        // Skip tmux-based members whose pane no longer exists (terminated)
        if member.backend_type.as_deref() == Some("tmux") {
            if let Some(ref pane_id) = member.tmux_pane_id {
                if !pane_id.is_empty() && !is_agent_alive_in_pane(pane_id) {
                    continue;
                }
            }
        }

        let (status, current_task) = derive_agent_status(&member.name, &tasks);

        // Try to find transcript and compute tokens
        // First try team transcript (JSONL with teamName/agentName), then subagent path
        let (tokens, spawn_time) = resolve_team_transcript(team_name, &member.name)
            .or_else(|| resolve_transcript_path(&member.agent_id))
            .map(|path| parse_agent_transcript(&path))
            .unwrap_or((0, None));

        total_tokens += tokens;
        if tokens > 0 {
            per_agent_tokens.insert(member.name.clone(), tokens);
        }

        // Track earliest timestamp for session_start
        if let Some(ref ts) = spawn_time {
            if earliest_timestamp.as_ref().map_or(true, |e| ts < e) {
                earliest_timestamp = Some(ts.clone());
            }
        }

        // Count messages for this agent
        let message_count = messages
            .iter()
            .filter(|m| m.to == member.name || m.from == member.name)
            .count() as u32;

        agents.push(AgentState {
            name: member.name.clone(),
            role: member.name.clone(),
            model: member.model.clone().unwrap_or_else(|| "unknown".to_string()),
            color: member.color.clone().unwrap_or_else(|| "green".to_string()),
            status,
            current_task,
            message_count,
            token_usage: tokens,
            spawn_time,
            pane_id: member.tmux_pane_id.clone(),
        });
    }

    // Compute burn rate (tokens/min) from session elapsed time
    let burn_rate = if let Some(ref start) = earliest_timestamp {
        // Parse ISO timestamp and compute minutes elapsed
        let elapsed_mins = chrono_elapsed_minutes(start);
        if elapsed_mins > 0.5 { total_tokens as f64 / elapsed_mins } else { 0.0 }
    } else {
        0.0
    };

    // Rough cost estimate: ~$3/MTok input, ~$15/MTok output (blended ~$9/MTok)
    let cost_usd = total_tokens as f64 * 9.0 / 1_000_000.0;

    // Parse rate limit from any active agent's tmux pane status bar
    let (rate_limit_pct, rate_limit_reset) = parse_rate_limit_from_panes(&members);

    let token_usage = TokenUsage {
        total_tokens,
        per_agent: per_agent_tokens,
        burn_rate,
        cost_usd,
        rate_limit_pct,
        rate_limit_reset,
    };

    Ok(TeamSnapshot {
        team_name: team_name.to_string(),
        agents,
        tasks,
        messages,
        token_usage,
        session_start: earliest_timestamp,
    })
}

/// Send a message to a team member's inbox by appending to their inbox JSON file.
pub fn send_inbox_message(team_name: &str, to: &str, text: &str) -> Result<(), String> {
    let team_dir = match teams_dir() {
        Some(d) => d.join(team_name),
        None => return Err("Could not determine home directory".to_string()),
    };

    let inboxes_dir = team_dir.join("inboxes");
    if !inboxes_dir.is_dir() {
        fs::create_dir_all(&inboxes_dir)
            .map_err(|e| format!("Failed to create inboxes dir: {}", e))?;
    }

    let inbox_path = inboxes_dir.join(format!("{}.json", to));

    // Read existing messages or start with empty array
    let mut messages: Vec<serde_json::Value> = if inbox_path.is_file() {
        let data = fs::read_to_string(&inbox_path)
            .map_err(|e| format!("Failed to read inbox: {}", e))?;
        serde_json::from_str(&data)
            .map_err(|e| format!("Failed to parse inbox: {}", e))?
    } else {
        vec![]
    };

    // Build timestamp in ISO 8601 format
    use std::time::{SystemTime, UNIX_EPOCH};
    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    // Simple ISO format: good enough for display
    let timestamp = format_timestamp_iso(now_secs as u64);

    // Append new message
    let msg = serde_json::json!({
        "from": "hud-user",
        "text": text,
        "timestamp": timestamp,
        "read": false
    });
    messages.push(msg);

    // Write back
    let data = serde_json::to_string_pretty(&messages)
        .map_err(|e| format!("Failed to serialize inbox: {}", e))?;
    fs::write(&inbox_path, data)
        .map_err(|e| format!("Failed to write inbox: {}", e))?;

    Ok(())
}

/// Read the current session's JSONL transcript, return last N entries formatted.
/// Only reads the last ~64KB of the file to avoid memory issues with large transcripts.
pub fn read_session_log(max_entries: u32) -> Result<String, String> {
    // Find the session with matching CWD
    let (session_id, cwd) = find_session_for_cwd()
        .ok_or_else(|| "No active session found for this project".to_string())?;

    let escaped = escape_cwd(&cwd);
    let transcript_path = claude_dir()
        .ok_or_else(|| "No home dir".to_string())?
        .join("projects")
        .join(&escaped)
        .join(format!("{}.jsonl", session_id));

    if !transcript_path.is_file() {
        return Err("Session transcript not found".to_string());
    }

    // Use tail -c to read last 16KB (avoids OOM — single JSONL lines can be huge)
    let output = std::process::Command::new("tail")
        .args(["-c", "16384", transcript_path.to_str().unwrap_or("")])
        .output()
        .map_err(|e| format!("tail failed: {}", e))?;

    let raw = String::from_utf8_lossy(&output.stdout);
    let mut entries: Vec<String> = Vec::new();

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.len() > 50000 { continue; } // Skip empty/huge lines

        let parsed: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let entry_type = parsed.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let timestamp = parsed.get("timestamp").and_then(|t| t.as_str()).unwrap_or("");
        let ts_short = if timestamp.len() >= 19 { &timestamp[11..19] } else { timestamp };

        let formatted = match entry_type {
            "user" => {
                let content = parsed.get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(|c| c.as_str())
                    .unwrap_or("");
                let display = if content.len() > 200 { format!("{}...", &content[..200]) } else { content.to_string() };
                format!("[{}] USER: {}", ts_short, display)
            },
            "assistant" => {
                let content = parsed.get("message")
                    .and_then(|m| m.get("content"));
                match content {
                    Some(serde_json::Value::Array(arr)) => {
                        let mut parts: Vec<String> = Vec::new();
                        for item in arr {
                            let item_type = item.get("type").and_then(|t| t.as_str()).unwrap_or("");
                            match item_type {
                                "text" => {
                                    let text = item.get("text").and_then(|t| t.as_str()).unwrap_or("");
                                    let display = if text.len() > 300 { format!("{}...", &text[..300]) } else { text.to_string() };
                                    parts.push(display);
                                },
                                "tool_use" => {
                                    let name = item.get("name").and_then(|n| n.as_str()).unwrap_or("?");
                                    parts.push(format!("[Tool: {}]", name));
                                },
                                _ => {}
                            }
                        }
                        if parts.is_empty() { continue; }
                        format!("[{}] ASSISTANT: {}", ts_short, parts.join(" | "))
                    },
                    _ => continue,
                }
            },
            _ => continue,
        };

        entries.push(formatted);
    }

    if entries.is_empty() {
        return Ok("[No recent session activity]".to_string());
    }

    Ok(entries.join("\n\n"))
}

/// Format milliseconds since epoch as ISO 8601 string.
pub fn format_timestamp_iso(millis: u64) -> String {
    let secs = millis / 1000;
    // Rough conversion - good enough for timestamps
    let s = secs % 60;
    let m = (secs / 60) % 60;
    let h = (secs / 3600) % 24;
    let total_days = secs / 86400;

    // Compute year/month/day from days since epoch
    let mut y = 1970u64;
    let mut remaining = total_days;
    loop {
        let days_in_year = if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) { 366 } else { 365 };
        if remaining < days_in_year { break; }
        remaining -= days_in_year;
        y += 1;
    }
    let is_leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let days_in_months = [31, if is_leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut mo = 0usize;
    for (i, &dim) in days_in_months.iter().enumerate() {
        if remaining < dim as u64 { mo = i; break; }
        remaining -= dim as u64;
    }
    let d = remaining + 1;

    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.000Z", y, mo + 1, d, h, m, s)
}
