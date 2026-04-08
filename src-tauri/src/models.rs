use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Agent status derived from task state
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Working,
    Idle,
    Blocked,
    Offline,
}

/// Per-agent state snapshot
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentState {
    pub name: String,
    pub role: String,
    pub model: String,
    pub color: String,
    pub status: AgentStatus,
    pub current_task: Option<String>,
    pub message_count: u32,
    pub token_usage: u64,
    pub spawn_time: Option<String>,
}

/// A message between agents
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub from: String,
    pub to: String,
    pub text: String,
    pub timestamp: String,
    pub read: bool,
}

/// Task state from task files
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskState {
    pub id: String,
    pub subject: String,
    pub description: Option<String>,
    pub owner: Option<String>,
    pub status: String,
    #[serde(default)]
    pub blocks: Vec<String>,
    #[serde(default)]
    pub blocked_by: Vec<String>,
}

/// Token usage metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenUsage {
    pub total_tokens: u64,
    pub per_agent: HashMap<String, u64>,
    pub burn_rate: f64,
    pub cost_usd: f64,
    pub rate_limit_pct: f64,
}

impl Default for TokenUsage {
    fn default() -> Self {
        Self {
            total_tokens: 0,
            per_agent: HashMap::new(),
            burn_rate: 0.0,
            cost_usd: 0.0,
            rate_limit_pct: 0.0,
        }
    }
}

/// Complete team snapshot emitted to frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamSnapshot {
    pub team_name: String,
    pub agents: Vec<AgentState>,
    pub tasks: Vec<TaskState>,
    pub messages: Vec<Message>,
    pub token_usage: TokenUsage,
    pub session_start: Option<String>,
}
