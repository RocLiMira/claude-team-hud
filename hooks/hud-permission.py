#!/usr/bin/env python3
"""
Claude Team HUD — Permission Hook
Receives permission requests from Claude Code, writes to temp file for HUD to pick up.
Waits for HUD's response, then outputs the decision to Claude Code.
"""
import json
import os
import sys
import time

REQ_DIR = "/tmp/claude-hud-permissions"
TIMEOUT_SECONDS = 300  # 5 minutes

def main():
    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)  # Let Claude Code handle it

    event = data.get("hook_event_name", "")
    if event != "PermissionRequest":
        sys.exit(0)

    # Build request info
    session_id = data.get("session_id", "unknown")
    tool_name = data.get("tool_name", "unknown")
    tool_input = data.get("tool_input", {})

    # Create unique request file
    os.makedirs(REQ_DIR, exist_ok=True)
    req_id = f"{session_id}-{int(time.time() * 1000)}"
    req_file = os.path.join(REQ_DIR, f"req-{req_id}.json")
    resp_file = os.path.join(REQ_DIR, f"resp-{req_id}.json")

    # Write request for HUD to read
    request = {
        "id": req_id,
        "session_id": session_id,
        "tool_name": tool_name,
        "tool_input": tool_input,
        "timestamp": time.time(),
    }

    # Add human-readable description
    if tool_name == "Write":
        request["description"] = f"Write to {tool_input.get('file_path', '?')}"
    elif tool_name == "Edit":
        request["description"] = f"Edit {tool_input.get('file_path', '?')}"
    elif tool_name == "Bash":
        cmd = tool_input.get("command", "?")
        request["description"] = f"Run: {cmd[:100]}"
    else:
        request["description"] = f"Use tool: {tool_name}"

    with open(req_file, "w") as f:
        json.dump(request, f)

    # Wait for HUD to respond
    for _ in range(TIMEOUT_SECONDS):
        if os.path.exists(resp_file):
            try:
                with open(resp_file) as f:
                    response = json.load(f)
            except (json.JSONDecodeError, IOError):
                time.sleep(0.5)
                continue

            # Cleanup
            try:
                os.remove(req_file)
                os.remove(resp_file)
            except OSError:
                pass

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
            else:
                # "ask" — let Claude Code show native UI
                try:
                    os.remove(req_file)
                except OSError:
                    pass
                sys.exit(0)

        time.sleep(1)

    # Timeout — cleanup and let Claude Code handle it
    try:
        os.remove(req_file)
    except OSError:
        pass
    sys.exit(0)


if __name__ == "__main__":
    main()
