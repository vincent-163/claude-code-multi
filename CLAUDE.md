# AI Code App (Claude + Codex)

Keep this file updated when codebase structure changes. Write only minimal explanation to help locate files to read/write.

## Design philosophy

The **server** is a relay that supports two backends:
- **Claude**: Spawns `claude` CLI with `--output-format stream-json --input-format stream-json` and forwards JSON messages via stdin/stdout.
- **Codex**: Spawns `codex exec --json` per turn, translates JSONL ThreadEvents to the same SSE event format. Multi-turn via `codex exec resume <thread_id>`.

The **Android/web clients** render a unified chat UI regardless of backend. Backend selection is per-session.

## Structure

```
server/src/          # Node.js/TypeScript Express server, thin relay between Claude CLI and HTTP client
  index.ts           # Entry point, Express app setup, scheduler init
  config.ts          # Config from env vars (CC_HOST, CC_PORT, CC_MAX_SESSIONS, CC_CONTEXT_WINDOW_SIZE, CC_AUTO_COMPACT_THRESHOLD, CC_BACKEND, CC_CODEX_CMD, CC_CODEX_API_KEY, CC_CODEX_BASE_URL, etc.)
  auth.ts            # Bearer token auth middleware
  routes.ts          # REST + SSE endpoints: /health, /sessions CRUD, /sessions/:id/input, /sessions/:id/stream, /sessions/:id/resize
  session.ts         # Session class (spawns `claude` or `codex` CLI), SessionManager; Codex JSONL→SSE translation; MCP tools: set_session_title, schedule_task, list_schedules, delete_schedule, create_team_member, list_team_members, send_team_message
  scheduler.ts       # Scheduler: SQLite-backed task scheduling with polling; creates sessions at scheduled times
  logger.ts          # Simple custom logger (timestamp + level prefix)

android/app/src/main/java/com/claudecode/app/
  ClaudeCodeApp.kt           # Application class, holds singletons (SshManager, ApiClient, SettingsRepository)
  MainActivity.kt            # Single activity, hosts AppNavigation composable

  data/
    SettingsRepository.kt    # DataStore preferences persistence
    model/
      Session.kt             # Session data class + SessionStatus enum
      ChatMessage.kt         # Sealed class: User/Assistant/Result/System/Status/Error/Exit/ControlRequest/AskUserQuestion/PlanModeExit messages + ContentBlock + AskUserQuestionItem
      ConnectionState.kt     # SSH connection state sealed class
      SshConfig.kt           # SSH + direct API connection config

  network/
    ApiClient.kt             # OkHttp REST client: createSession, listSessions, getSession, sendInput, sendControlResponse, sendToolResult, updateSessionTitle, deleteSession, healthCheck
    SseClient.kt             # SSE stream parser -> Flow<SseEvent>; parses system/assistant/result/status/exit/error/control_request/AskUserQuestion/PlanModeExit events

  ssh/
    SshManager.kt            # JSch SSH tunnel + remote server management

  ui/
    navigation/
      AppNavigation.kt       # Screen sealed class (Connection/Sessions/Chat/Settings), manual nav state
    connection/
      ConnectionScreen.kt    # SSH or Direct API connection form
      ConnectionViewModel.kt # Connect/disconnect logic
    sessions/
      SessionsScreen.kt      # Session list grouped by team + NewSessionDialog
      SessionsViewModel.kt   # List/create/delete sessions via ApiClient
    chat/
      ChatScreen.kt          # Chat UI: message list, input bar, renders text/tool_use/results/permission approvals/AskUserQuestion interactive options/PlanModeExit approval/editable session title
      ChatViewModel.kt       # SSE subscription, message accumulation, sendMessage/approveControlRequest/denyControlRequest/answerQuestion/approvePlanExit/updateTitle/sendInterrupt
    settings/
      SettingsScreen.kt      # Auth token, default model, working dir, server command fields
      SettingsViewModel.kt   # Read/write settings via SettingsRepository
    theme/
      Color.kt, Theme.kt    # Material3 dark theme
    util/
      AnsiParser.kt          # ANSI escape code -> AnnotatedString

sess.json                    # Example session JSON dump for reference

web/src/                     # React/TypeScript web SPA
  lib/
    types.ts               # TypeScript interfaces: Session, ChatMessage (union), ContentBlock, AskUserQuestionMessage, PlanModeExitMessage
    api.ts                 # REST client: healthCheck, listSessions, createSession, getSession, sendInput, deleteSession
    sse.ts                 # SSE stream connection with reconnection via last_event_id
    parse.ts               # SSE event -> ChatMessage parser (parseEvents returns array; extracts AskUserQuestion and ExitPlanMode from assistant tool_use)
    ansi.ts                # ANSI escape code parser
    settings.ts            # Settings persistence to localStorage
  components/
    ChatPage.tsx           # Chat UI: message list, input bar, control_request approval, AskUserQuestion interactive UI, ExitPlanMode approval, editable session title
    SessionsPage.tsx       # Session list grouped by team + create dialog
    SettingsPage.tsx       # API URL, auth token, default model settings
    AnsiText.tsx           # ANSI-aware text renderer
```

## Key flows

- **Session creation**: POST /sessions with optional `backend` field ('claude' or 'codex'). Claude: spawns persistent CLI process. Codex: creates session in ready state, waits for first user message to spawn `codex exec --json`.
- **Chat (Claude)**: SSE stream relays CLI stdout as-is. User input → stdin.
- **Chat (Codex)**: Each user message spawns `codex exec --json` (or `codex exec resume <thread_id>` for follow-ups). Server translates JSONL ThreadEvents (thread.started, item.started/completed, turn.completed) to the same SSE format as Claude. Process exits after each turn; session stays alive.
- **Permission approval**: Server launches CLI with `--permission-prompt-tool stdio` and sends an initialize control_request at session start. When CLI needs permission, it emits a `control_request` event (type=message, subtype=can_use_tool) with request_id, tool_name, input, blocked_path. Client renders approve/deny UI. Responses sent via POST /sessions/:id/input with type=control_response. Server forwards control messages as-is without parsing.
- **AskUserQuestion**: When Claude calls the `AskUserQuestion` tool, it appears as a `tool_use` block (name=AskUserQuestion) in an assistant message. The parser extracts these into separate `ask_user_question` (web) / `ChatMessage.AskUserQuestion` (Android) messages rendered as interactive option-selection UI. User answers are sent back as `type=tool_result` with the matching `tool_use_id` and content `{"answers":{"0":"selected_label",...}}`. Both web and Android support single-select, multi-select, and "Other" free-text options.
- **ExitPlanMode**: When Claude calls `ExitPlanMode`, it appears as a `tool_use` block (name=ExitPlanMode) in an assistant message. The parser extracts these into separate `plan_mode_exit` (web) / `ChatMessage.PlanModeExit` (Android) messages rendered with an "Approve" button. Approval sends back a `type=tool_result` with the matching `tool_use_id` and empty JSON content `{}`.
- **Scheduling**: Claude can schedule future tasks via MCP tools (`schedule_task`, `list_schedules`, `delete_schedule`). Tasks are stored in SQLite (`sessions/scheduler.db`). A 5-second polling loop checks for due tasks and launches new sessions with the scheduled prompt. `list_schedules` and `delete_schedule` are scoped to subdirectories of the calling session's working directory.
- **Agent Teams**: Claude can spawn team members via `create_team_member` MCP tool. The first session to create a member becomes the team lead (teamId = own id). Members inherit the lead's working directory and session config (model, permissions, flags). `list_team_members` returns all sessions in the same team. `send_team_message` delivers a user message to another team member with sender identity. Sessions have optional `description` field (settable via `set_session_title`). Both web and Android frontends group team sessions together in the session list.
- **Auto-compact**: Server tracks token usage from `result` messages' `usage` field. When input tokens exceed `CC_AUTO_COMPACT_THRESHOLD` (default 80%) of `CC_CONTEXT_WINDOW_SIZE` (default 200000), server auto-sends `/compact` to the CLI. Emits `context_usage` SSE events with `context_window_size`, `used_percentage`, and token breakdown. Session JSON includes `context_window_size`, `context_used_pct`, `context_usage`.
- **Codex env vars**: `CC_BACKEND` (default 'claude'), `CC_CODEX_CMD` (default 'codex'), `CC_CODEX_API_KEY` (OPENAI_API_KEY for codex), `CC_CODEX_BASE_URL` (OPENAI_BASE_URL, e.g. http://127.0.0.1:4000/v1). Codex requires `codex login --with-api-key` to have been run beforehand, and uses `--dangerously-bypass-approvals-and-sandbox --skip-git-repo-check` flags.

## Workflow

Always commit and push after every change.
After committing and pushing, if Android app code was modified, attempt a build (`cd android && ./gradlew assembleDebug`). If the build fails, fix the errors, then commit and push again.

## Build

Requires: Android SDK at `~/Android/Sdk`, Java 17.

```bash
cd android
./gradlew assembleDebug
```

APK output: `android/app/build/outputs/apk/debug/app-debug.apk`

Debug keystore is configured to `/tmp/debug.keystore`. If missing, generate:
```bash
keytool -genkeypair -v -keystore /tmp/debug.keystore -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US"
```
