# Claude Code App

A mobile and web client for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — access Claude's agentic coding capabilities from your phone or browser.

## Architecture

**Thin server, smart client.** The server is a lightweight relay that spawns `claude` CLI processes and forwards stream-json messages over HTTP/SSE. Clients handle all UI rendering, permission approval flows, and message parsing.

```
┌─────────────┐       HTTP/SSE       ┌────────────┐     stdin/stdout     ┌────────────┐
│ Android App │◄─────────────────────►│   Server   │◄───────────────────►│ Claude CLI │
│  or Browser │                       │  (relay)   │    (stream-json)    │            │
└─────────────┘                       └────────────┘                     └────────────┘
```

## Clients

- **Android** — Kotlin/Jetpack Compose, Material3 dark theme, SSH tunnel support
- **Web** — bundled SPA served by the server at `/`

## Server

Node.js/TypeScript Express server. Spawns `claude` CLI with `--output-format stream-json --input-format stream-json --permission-prompt-tool stdio` and relays messages without interpretation.

### Setup

```bash
cd server
npm install
```

### Run

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `CC_HOST` | `127.0.0.1` | Listen address |
| `CC_PORT` | `8080` | Listen port |
| `CC_AUTH_TOKENS` | _(none)_ | Comma-separated bearer tokens |
| `CC_MAX_SESSIONS` | `10` | Max concurrent sessions |
| `CC_CLAUDE_CMD` | `claude` | Path to Claude CLI binary |
| `CC_BUFFER_SIZE` | `1000` | SSE message buffer size |
| `CC_SESSION_TIMEOUT` | `3600` | Session timeout in seconds |
| `CC_PERSISTENT_COOLDOWN_SEC` | `900` | Default assistant-inactivity timeout for persistent prompt sessions |
| `CC_LOG_LEVEL` | `info` | Log level |
| `CC_SESSIONS_DIR` | `sessions` | Session persistence directory |

### API endpoints

- `GET /health` — health check
- `POST /sessions` — create session
- `GET /sessions` — list sessions
- `GET /sessions/:id` — get session
- `DELETE /sessions/:id` — delete session
- `POST /sessions/:id/input` — send user message, tool result, or control response
- `GET /sessions/:id/stream` — SSE event stream
- `POST /sessions/:id/resize` — resize terminal

## Android build

Requires Android SDK and Java 17.

```bash
cd android
./gradlew assembleDebug
```

APK output: `android/app/build/outputs/apk/debug/app-debug.apk`
