# Claude Code Server API Specification

## Overview

The server manages Claude Code CLI instances as child processes using the `--print --output-format stream-json --input-format stream-json` mode for structured streaming I/O. It listens on `localhost` only (accessed via SSH tunnel).

**Base URL**: `http://localhost:8080`

## Authentication

Simple token-based auth. Each request must include an `Authorization: Bearer <token>` header. Tokens are configured in the server's config file or via environment variable.

Security is additionally provided by the SSH tunnel — only the tunneled client can reach the server.

## Endpoints

### Health Check

```
GET /health
```

No auth required.

**Response** `200 OK`:
```json
{
  "status": "ok",
  "version": "1.0.0",
  "sessions_active": 3,
  "uptime_seconds": 12345
}
```

---

### Sessions

All session endpoints require `Authorization: Bearer <token>` header.

#### Create Session

```
POST /sessions
```

**Request Body**:
```json
{
  "working_directory": "/path/to/project",
  "model": "opus",
  "resume_conversation_id": "uuid-string",
  "permission_mode": "default",
  "system_prompt": "optional custom system prompt",
  "persistent_prompt": "optional prompt for auto-restart mode",
  "cooldown_timeout_sec": 900
}
```

All fields are optional. `working_directory` defaults to the server's CWD. `model` is passed to `claude` via `--model` and to `codex` via `-m`. `resume_conversation_id` resumes a prior conversation (`--resume` for Claude, `thread_id` resume for Codex). `permission_mode` sets the permission mode (default, plan, bypassPermissions, etc.).

If `persistent_prompt` is set, the session enters persistent mode:
- The prompt is sent automatically when the session becomes `ready`.
- The first run starts immediately; later runs wait `cooldown_timeout_sec` (default `900`).
- `user_message` input is rejected for that session.

**Response** `201 Created`:
```json
{
  "id": "sess_abc123def456",
  "status": "starting",
  "created_at": 1707555600.123,
  "working_directory": "/path/to/project",
  "pid": 12345
}
```

**Errors**:
- `400` — invalid parameters (e.g. directory doesn't exist)
- `503` — max sessions reached

#### List Sessions

```
GET /sessions
```

**Response** `200 OK`:
```json
{
  "sessions": [
    {
      "id": "sess_abc123def456",
      "status": "ready",
      "created_at": 1707555600.123,
      "last_active_at": 1707555700.456,
      "working_directory": "/path/to/project"
    }
  ]
}
```

Session `status` values: `starting`, `ready`, `busy`, `dead`.

#### Get Session Details

```
GET /sessions/:id
```

Returns session metadata plus the last N lines of buffered output (for reconnect).

**Query Parameters**:
- `history_lines` (optional, default 200): Number of recent output messages to include.

**Response** `200 OK`:
```json
{
  "id": "sess_abc123def456",
  "status": "ready",
  "created_at": 1707555600.123,
  "last_active_at": 1707555700.456,
  "working_directory": "/path/to/project",
  "pid": 12345,
  "history": [
    {
      "type": "assistant",
      "message": { "type": "text", "text": "Hello! How can I help?" },
      "timestamp": 1707555601.234
    }
  ]
}
```

**Errors**:
- `404` — session not found

#### Send Input to Session

```
POST /sessions/:id/input
```

**Request Body**:
```json
{
  "type": "user_message",
  "content": "Fix the bug in main.py"
}
```

Message types:
- `user_message` — send a prompt to Claude (writes to stdin as stream-json)
- `tool_result` — respond to a tool use confirmation (`content` is the response)
- `interrupt` — send SIGINT to the process (no `content` needed)

For persistent sessions, `user_message` is not allowed and returns `400`.

**Response** `200 OK`:
```json
{
  "status": "sent"
}
```

**Errors**:
- `404` — session not found
- `400` — session is dead or invalid message type

#### Stream Session Output (SSE)

```
GET /sessions/:id/stream
```

Server-Sent Events stream for real-time output from the Claude Code process.

**Query Parameters**:
- `last_event_id` (optional): Resume from a specific event ID to avoid missing messages during reconnect.

**SSE Event Types**:

```
event: message
id: 42
data: {"type":"assistant","message":{"type":"text","text":"I'll fix that..."},"timestamp":1707555601.234}

event: status
id: 43
data: {"status":"busy"}

event: exit
id: 44
data: {"code":0}

event: error
id: 45
data: {"message":"Process crashed"}

event: ping
data: {}
```

The stream sends `ping` events every 15 seconds as keepalive.

**Errors**:
- `404` — session not found

#### Resize Terminal

```
POST /sessions/:id/resize
```

**Request Body**:
```json
{
  "cols": 120,
  "rows": 40
}
```

Note: In stream-json mode, terminal dimensions are less relevant since output is structured JSON, not raw terminal data. This endpoint is provided for future compatibility.

**Response** `200 OK`:
```json
{
  "status": "ok"
}
```

#### Destroy Session

```
DELETE /sessions/:id
```

Sends SIGTERM to the Claude Code process, waits briefly, then SIGKILL if needed.

**Response** `200 OK`:
```json
{
  "id": "sess_abc123def456",
  "status": "destroyed"
}
```

**Errors**:
- `404` — session not found

---

## Configuration

Environment variables:

| Variable | Default | Description |
|---|---|---|
| `CC_PORT` | `8080` | Port to listen on |
| `CC_HOST` | `127.0.0.1` | Bind address (keep as localhost) |
| `CC_MAX_SESSIONS` | `10` | Max concurrent sessions |
| `CC_CLAUDE_CMD` | `claude` | Path to Claude Code CLI binary |
| `CC_AUTH_TOKENS` | (none) | Comma-separated list of valid auth tokens. If empty, auth is disabled. |
| `CC_BUFFER_SIZE` | `1000` | Max output messages to buffer per session |
| `CC_SESSION_TIMEOUT` | `3600` | Seconds of inactivity before session cleanup |
| `CC_PERSISTENT_COOLDOWN_SEC` | `900` | Default cooldown (seconds) between persistent prompt runs |
| `CC_LOG_LEVEL` | `info` | Logging level (`debug`, `info`, `warn`, `error`) |

## Error Format

All HTTP error responses use:
```json
{
  "error": "Short error description"
}
```

## Claude Code Stream JSON Format

The server uses Claude Code's `--input-format stream-json` and `--output-format stream-json` modes.

**Input (written to stdin)**: Each message is a JSON object on its own line:
```json
{"type":"user_message","content":"Fix the bug"}
```

**Output (read from stdout)**: Each line is a JSON object representing a streaming event from Claude Code, such as assistant text chunks, tool use requests, tool results, etc.
