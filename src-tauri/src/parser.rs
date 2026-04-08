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
    #[serde(rename = "agentType")]
    #[allow(dead_code)]
    agent_type: String,
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

/// Escape a cwd path the same way Claude Code does for the projects directory.
/// Slashes become dashes, e.g. "/Users/me/project" -> "-Users-me-project"
fn escape_cwd(cwd: &str) -> String {
    cwd.replace('/', "-")
}

/// Resolve the JSONL transcript path for a given agent.
fn resolve_transcript_path(agent_id: &str) -> Option<PathBuf> {
    let (session_id, cwd) = find_latest_session()?;
    let escaped = escape_cwd(&cwd);
    let path = claude_dir()?
        .join("projects")
        .join(escaped)
        .join(&session_id)
        .join("subagents")
        .join(format!("agent-{}.jsonl", agent_id));
    if path.is_file() {
        Some(path)
    } else {
        None
    }
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
        let (status, current_task) = derive_agent_status(&member.name, &tasks);

        // Try to find transcript and compute tokens
        let (tokens, spawn_time) = match resolve_transcript_path(&member.agent_id) {
            Some(path) => parse_agent_transcript(&path),
            None => (0, None),
        };

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
            model: "unknown".to_string(),
            color: "green".to_string(),
            status,
            current_task,
            message_count,
            token_usage: tokens,
            spawn_time,
        });
    }

    let token_usage = TokenUsage {
        total_tokens,
        per_agent: per_agent_tokens,
        burn_rate: 0.0,
        cost_usd: 0.0,
        rate_limit_pct: 0.0,
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
