# Claude Code Server

A Node.js/TypeScript server that manages Claude Code CLI instances and exposes a REST + SSE API. Designed to run on a remote machine, accessed by the Android app via an SSH tunnel.

Uses Claude Code's `--print --output-format stream-json --input-format stream-json` mode for structured streaming I/O — no PTY required.

## Requirements

- Node.js 20+
- Claude Code CLI installed and available in `$PATH` (or set `CC_CLAUDE_CMD`)

## Setup

```bash
cd server/
npm install
npm run build
```

## Running

```bash
# Start with defaults (localhost:8080)
npm start

# Or run in dev mode (no build step)
npm run dev

# With custom config
CC_PORT=9090 CC_AUTH_TOKENS="mytoken1,mytoken2" npm start
```

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|---|---|---|
| `CC_PORT` | `8080` | Port to listen on |
| `CC_HOST` | `127.0.0.1` | Bind address (keep as localhost for SSH tunnel use) |
| `CC_MAX_SESSIONS` | `10` | Maximum concurrent Claude Code sessions |
| `CC_CLAUDE_CMD` | `claude` | Path to the Claude Code CLI binary |
| `CC_AUTH_TOKENS` | (none) | Comma-separated list of valid Bearer tokens. If empty, auth is disabled. |
| `CC_BUFFER_SIZE` | `1000` | Max output messages to buffer per session (for reconnect history) |
| `CC_SESSION_TIMEOUT` | `3600` | Seconds of inactivity before session auto-cleanup |
| `CC_PERSISTENT_COOLDOWN_SEC` | `900` | Default cooldown seconds between persistent prompt reruns |
| `CC_LOG_LEVEL` | `info` | Logging level (`debug`, `info`, `warn`, `error`) |

## API Overview

See [api-spec.md](api-spec.md) for the full specification.

### REST Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | No | Health check |
| `POST` | `/sessions` | Yes | Create a new Claude Code session |
| `GET` | `/sessions` | Yes | List all sessions |
| `GET` | `/sessions/:id` | Yes | Get session details + buffered history |
| `POST` | `/sessions/:id/input` | Yes | Send input to a session |
| `GET` | `/sessions/:id/stream` | Yes | SSE stream for real-time output |
| `POST` | `/sessions/:id/resize` | Yes | Resize terminal (future use) |
| `DELETE` | `/sessions/:id` | Yes | Destroy a session |

### Input Message Types

Send via `POST /sessions/:id/input`:

- `user_message` — send a prompt to Claude (`{"type":"user_message","content":"..."}`)
- `tool_result` — respond to a tool use confirmation
- `interrupt` — send SIGINT to the process

When a session is created with `persistent_prompt`, `user_message` is disabled. The server automatically resubmits the configured prompt whenever the session returns to `ready` (first run immediately, then after cooldown).

### SSE Stream Events

Connect to `GET /sessions/:id/stream` for real-time output:

- `message` — structured JSON from Claude Code (system init, assistant responses, results)
- `status` — session status changes (ready, busy, dead)
- `exit` — process exited with code
- `error` — error notification
- `ping` — keepalive every 15s

Supports reconnect via `?last_event_id=N` query parameter.

## SSH Tunnel Usage

On the Android device (or any client), establish an SSH tunnel:

```bash
ssh -L 8080:localhost:8080 user@remote-machine
```

Then connect to `http://localhost:8080` from the client app.

## Architecture

```
Android App
    │
    │ SSH tunnel (port 8080)
    ▼
┌──────────────────────────┐
│   cc-server (Express)     │
│                           │
│  ┌─────────────────────┐  │
│  │  SessionManager      │  │
│  │                      │  │
│  │  Session 1 ──────────│──│──► claude --print --stream-json
│  │  Session 2 ──────────│──│──► claude --print --stream-json
│  │  Session N ──────────│──│──► claude --print --stream-json
│  │                      │  │
│  │  [Output Buffer]     │  │
│  │  [SSE Subscribers]   │  │
│  └─────────────────────┘  │
└──────────────────────────┘
```

Each session spawns a `claude` CLI process in stream-json mode. The server reads structured JSON from stdout, buffers it for reconnect, and streams it to connected SSE clients. User input is written to stdin as JSON messages.
