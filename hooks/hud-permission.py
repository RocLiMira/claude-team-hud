#!/usr/bin/env python3
"""
Claude Team HUD — Permission Hook (PermissionRequest)

Receives permission requests from Claude Code via the PermissionRequest hook event,
forwards them to the HUD app via Unix domain socket, and waits for the user's decision.

Only fires when Claude Code actually needs user approval (not for every tool call).
Agents must NOT use --dangerously-skip-permissions for this hook to fire.

Architecture:
  Claude Code -> this script -> Unix socket -> HUD (Rust backend) -> Frontend UI
                             <- user decision <- socket response <-
"""
import json
import os
import socket
import sys

SOCKET_PATH = "/tmp/claude-hud.sock"
TIMEOUT_SECONDS = 300  # 5 minutes


def send_event(state):
    """Send event to HUD via Unix socket, return response if permission request."""
    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(TIMEOUT_SECONDS)
        sock.connect(SOCKET_PATH)
        sock.sendall(json.dumps(state).encode())

        # For permission requests, wait for response
        if state.get("status") == "waiting_for_approval":
            response = sock.recv(4096)
            sock.close()
            if response:
                return json.loads(response.decode())
        else:
            sock.close()

        return None
    except (socket.error, OSError, json.JSONDecodeError):
        return None


def main():
    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)

    event = data.get("hook_event_name", "")

    # Only handle PermissionRequest events
    if event != "PermissionRequest":
        sys.exit(0)

    session_id = data.get("session_id", "unknown")
    tool_name = data.get("tool_name", "unknown")
    tool_input = data.get("tool_input", {})

    # Build human-readable description
    if tool_name == "Write":
        description = f"Write to {tool_input.get('file_path', '?')}"
    elif tool_name == "Edit":
        description = f"Edit {tool_input.get('file_path', '?')}"
    elif tool_name == "Bash":
        cmd = tool_input.get("command", "?")
        description = f"Run: {cmd[:100]}"
    else:
        description = f"Use tool: {tool_name}"

    # Send to HUD and wait for decision
    state = {
        "session_id": session_id,
        "event": event,
        "status": "waiting_for_approval",
        "tool_name": tool_name,
        "tool_input": tool_input,
        "description": description,
        "pid": os.getppid(),
    }

    response = send_event(state)

    if response:
        decision = response.get("decision", "ask")

        if decision == "allow":
            output = {
                "hookSpecificOutput": {
                    "hookEventName": "PermissionRequest",
                    "decision": {"behavior": "allow"},
                }
            }
            print(json.dumps(output))
            sys.exit(0)

        elif decision == "deny":
            output = {
                "hookSpecificOutput": {
                    "hookEventName": "PermissionRequest",
                    "decision": {
                        "behavior": "deny",
                        "message": response.get("reason", "Denied via Claude Team HUD"),
                    },
                }
            }
            print(json.dumps(output))
            sys.exit(0)

    # No response or "ask" — let Claude Code show its native permission UI
    sys.exit(0)


if __name__ == "__main__":
    main()
