# Claude Code Android App

Keep this file updated when codebase structure changes. Write only minimal explanation to help locate files to read/write.

## Design philosophy

The **server** is a thin relay: it spawns `claude` CLI processes with `--output-format stream-json --input-format stream-json` and forwards JSON messages between the CLI's stdin/stdout and the HTTP/SSE client with minimal parsing. It does not interpret message content, tool calls, or permission semantics beyond what is needed for session lifecycle.

The **Android client** is the smart end: it parses the stream-json protocol messages (referring to the Claude Agent SDK source code for the message schema), renders them in a chat UI, handles permission approval flows, and manages connection/session state.

## Structure

```
server/src/          # Node.js/TypeScript Express server, thin relay between Claude CLI and HTTP client
  index.ts           # Entry point, Express app setup
  config.ts          # Config from env vars (CC_HOST, CC_PORT, CC_MAX_SESSIONS, etc.)
  auth.ts            # Bearer token auth middleware
  routes.ts          # REST + SSE endpoints: /health, /sessions CRUD, /sessions/:id/input, /sessions/:id/stream, /sessions/:id/resize
  session.ts         # Session class (spawns `claude` CLI with stream-json), SessionManager
  logger.ts          # Simple custom logger (timestamp + level prefix)

android/app/src/main/java/com/claudecode/app/
  ClaudeCodeApp.kt           # Application class, holds singletons (SshManager, ApiClient, SettingsRepository)
  MainActivity.kt            # Single activity, hosts AppNavigation composable

  data/
    SettingsRepository.kt    # DataStore preferences persistence
    model/
      Session.kt             # Session data class + SessionStatus enum
      ChatMessage.kt         # Sealed class: User/Assistant/Result/System/Status/Error/Exit/ControlRequest messages + ContentBlock
      ConnectionState.kt     # SSH connection state sealed class
      SshConfig.kt           # SSH + direct API connection config

  network/
    ApiClient.kt             # OkHttp REST client: createSession, listSessions, getSession, sendInput, sendControlResponse, deleteSession, healthCheck
    SseClient.kt             # SSE stream parser -> Flow<SseEvent>; parses system/assistant/result/status/exit/error/control_request events

  ssh/
    SshManager.kt            # JSch SSH tunnel + remote server management

  ui/
    navigation/
      AppNavigation.kt       # Screen sealed class (Connection/Sessions/Chat/Settings), manual nav state
    connection/
      ConnectionScreen.kt    # SSH or Direct API connection form
      ConnectionViewModel.kt # Connect/disconnect logic
    sessions/
      SessionsScreen.kt      # Session list + NewSessionDialog (currently only working_directory field)
      SessionsViewModel.kt   # List/create/delete sessions via ApiClient
    chat/
      ChatScreen.kt          # Chat UI: message list, input bar, renders text/tool_use/results/permission approvals
      ChatViewModel.kt       # SSE subscription, message accumulation, sendMessage/approveControlRequest/denyControlRequest/sendInterrupt
    settings/
      SettingsScreen.kt      # Auth token, default model, working dir, server command fields
      SettingsViewModel.kt   # Read/write settings via SettingsRepository
    theme/
      Color.kt, Theme.kt    # Material3 dark theme
    util/
      AnsiParser.kt          # ANSI escape code -> AnnotatedString

sess.json                    # Example session JSON dump for reference
```

## Key flows

- **Session creation**: SessionsScreen -> SessionsViewModel.createSession() -> ApiClient.createSession() -> POST /sessions -> SessionManager.createSession() spawns `claude --print --output-format stream-json --input-format stream-json --verbose --replay-user-messages --permission-prompt-tool stdio [flags]`
- **Chat**: ChatScreen subscribes via SSE (GET /sessions/:id/stream). Server relays CLI stdout lines as SSE events with no content transformation. User input sent via POST /sessions/:id/input with type=user_message; server writes it to CLI stdin. Tool results sent with type=tool_result.
- **Permission approval**: Server launches CLI with `--permission-prompt-tool stdio` and sends an initialize control_request at session start. When CLI needs permission, it emits a `control_request` event (type=message, subtype=can_use_tool) with request_id, tool_name, input, blocked_path. Client renders approve/deny UI. Responses sent via POST /sessions/:id/input with type=control_response. Server forwards control messages as-is without parsing.

## Workflow

Always commit and push after every change.

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
