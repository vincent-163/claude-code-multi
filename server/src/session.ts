import { ChildProcess, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { createInterface, Interface } from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { Config } from './config';
import { logger } from './logger';
import type { Scheduler } from './scheduler';

export type SessionStatus = 'starting' | 'ready' | 'busy' | 'waiting_for_input' | 'dead';

export interface BufferedEvent {
  id: number;
  event: string;
  data: unknown;
  timestamp: number;
}

export type SSESubscriber = (event: BufferedEvent) => void;

const MCP_SERVER_NAME = 'cc-app';
const MCP_TOOL_SET_TITLE = 'set_session_title';
const MCP_TOOL_SCHEDULE_TASK = 'schedule_task';
const MCP_TOOL_LIST_SCHEDULES = 'list_schedules';
const MCP_TOOL_DELETE_SCHEDULE = 'delete_schedule';

export class Session {
  id: string;
  readonly createdAt: number;
  readonly workingDirectory: string;
  status: SessionStatus = 'starting';
  lastActiveAt: number;
  pid: number | undefined;
  cliSessionId: string | undefined;
  title: string | undefined;

  totalCostUsd: number = 0;

  /** Called when the title is changed via MCP tool */
  onTitleChanged: ((sessionId: string, title: string) => void) | null = null;

  /** Scheduler instance for schedule MCP tools */
  scheduler: Scheduler | null = null;

  /** Resolves when the CLI emits its system init message with session_id */
  readonly cliSessionIdReady: Promise<string>;
  private resolveCliSessionId!: (id: string) => void;

  private process: ChildProcess | null = null;
  private buffer: BufferedEvent[] = [];
  private bufferSize: number;
  private eventCounter = 0;
  private subscribers = new Set<SSESubscriber>();
  private stdoutRl: Interface | null = null;
  private jsonlStream: fs.WriteStream | null = null;

  /** Called when CLI session_id is captured from the init message */
  onCliSessionId: ((sessionId: string, cliSessionId: string) => void) | null = null;

  constructor(
    id: string,
    workingDirectory: string,
    bufferSize: number,
    jsonlPath?: string,
  ) {
    this.id = id;
    this.createdAt = Date.now() / 1000;
    this.lastActiveAt = this.createdAt;
    this.workingDirectory = workingDirectory;
    this.bufferSize = bufferSize;
    this.cliSessionIdReady = new Promise<string>((resolve) => {
      this.resolveCliSessionId = resolve;
    });
    if (jsonlPath) {
      this.jsonlStream = fs.createWriteStream(jsonlPath, { flags: 'a' });
    }
  }

  attach(proc: ChildProcess): void {
    this.process = proc;
    this.pid = proc.pid;
    this.status = 'ready';
    this.pushEvent('status', { status: 'ready' });

    // Read structured JSON lines from stdout
    if (proc.stdout) {
      this.stdoutRl = createInterface({ input: proc.stdout });
      this.stdoutRl.on('line', (line) => {
        this.lastActiveAt = Date.now() / 1000;
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const parsed = JSON.parse(trimmed);
          // Capture CLI session_id from the system init message
          if (
            parsed.type === 'system' &&
            parsed.subtype === 'init' &&
            parsed.session_id &&
            !this.cliSessionId
          ) {
            const newCliId: string = parsed.session_id;
            this.cliSessionId = newCliId;
            logger.info(`Session ${this.id} got CLI session_id: ${newCliId}`);
            this.onCliSessionId?.(this.id, newCliId);
            this.resolveCliSessionId(newCliId);
          }

          // Intercept MCP control requests from CLI and handle them
          if (parsed.type === 'control_request' && parsed.request?.subtype === 'mcp_message') {
            this.handleMcpControlRequest(parsed);
            return; // Don't forward to clients
          }

          // Track session status from CLI message types
          this.updateStatusFromMessage(parsed);
          this.pushEvent('message', parsed);
        } catch {
          // Non-JSON output, send as raw text
          this.pushEvent('message', { type: 'raw', text: trimmed });
        }
      });
    }

    // Read stderr as raw text
    if (proc.stderr) {
      proc.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        logger.debug(`Session ${this.id} stderr: ${text.trim()}`);
        this.pushEvent('message', { type: 'stderr', text });
      });
    }

    proc.on('exit', (code, signal) => {
      logger.info(`Session ${this.id} exited: code=${code} signal=${signal}`);
      this.status = 'dead';
      this.pushEvent('exit', { code, signal });
      this.pushEvent('status', { status: 'dead' });
      this.stdoutRl?.close();
      this.stdoutRl = null;
      this.process = null;
    });

    proc.on('error', (err) => {
      logger.error(`Session ${this.id} process error: ${err.message}`);
      this.status = 'dead';
      this.pushEvent('error', { message: err.message });
      this.pushEvent('status', { status: 'dead' });
    });
  }

  subscribe(fn: SSESubscriber): void {
    this.subscribers.add(fn);
  }

  unsubscribe(fn: SSESubscriber): void {
    this.subscribers.delete(fn);
  }

  get bufferLength(): number {
    return this.buffer.length;
  }

  getHistory(lines: number): BufferedEvent[] {
    if (lines >= this.buffer.length) return [...this.buffer];
    return this.buffer.slice(-lines);
  }

  sendInput(text: string): boolean {
    if (!this.process || !this.process.stdin || this.status === 'dead') {
      return false;
    }
    this.lastActiveAt = Date.now() / 1000;
    try {
      this.process.stdin.write(text + '\n');
      return true;
    } catch (err) {
      logger.warn(`Session ${this.id} stdin write failed: ${err}`);
      return false;
    }
  }

  sendStreamJsonMessage(msg: Record<string, unknown>): boolean {
    return this.sendInput(JSON.stringify(msg));
  }

  sendInterrupt(): boolean {
    if (!this.process || this.status === 'dead') return false;
    try {
      this.process.kill('SIGINT');
      return true;
    } catch {
      return false;
    }
  }

  async destroy(): Promise<void> {
    if (!this.process || this.status === 'dead') {
      this.status = 'dead';
      return;
    }

    try {
      this.process.kill('SIGTERM');
    } catch {
      // already dead
    }

    // Wait up to 5 seconds for graceful exit
    const exited = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 5000);
      this.process?.on('exit', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });

    if (!exited && this.process) {
      try {
        this.process.kill('SIGKILL');
      } catch {
        // already dead
      }
    }

    this.status = 'dead';
    this.stdoutRl?.close();
    this.stdoutRl = null;
    this.jsonlStream?.end();
    this.jsonlStream = null;
    this.process = null;
  }

  toJSON() {
    return {
      id: this.id,
      status: this.status,
      created_at: this.createdAt,
      last_active_at: this.lastActiveAt,
      working_directory: this.workingDirectory,
      pid: this.pid,
      cli_session_id: this.cliSessionId,
      total_cost_usd: this.totalCostUsd,
      title: this.title,
    };
  }

  toSummaryJSON() {
    return {
      id: this.id,
      status: this.status,
      created_at: this.createdAt,
      last_active_at: this.lastActiveAt,
      working_directory: this.workingDirectory,
      cli_session_id: this.cliSessionId,
      total_cost_usd: this.totalCostUsd,
      title: this.title,
    };
  }

  /**
   * Load buffered events from a JSONL file into this session's buffer.
   * Used when resuming a session to provide history to SSE clients.
   */
  loadBufferFromFile(jsonlPath: string): void {
    try {
      const content = fs.readFileSync(jsonlPath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const evt: BufferedEvent = JSON.parse(line);
          this.buffer.push(evt);
          if (evt.id > this.eventCounter) {
            this.eventCounter = evt.id;
          }
        } catch {
          // skip malformed lines
        }
      }
      // Trim to buffer size
      if (this.buffer.length > this.bufferSize) {
        this.buffer = this.buffer.slice(-this.bufferSize);
      }
      logger.info(`Loaded ${this.buffer.length} events from ${jsonlPath} for session ${this.id}`);
    } catch (err) {
      logger.warn(`Failed to load JSONL history for session ${this.id}: ${err}`);
    }
  }

  /**
   * Read session metadata from a JSONL file's first system init event.
   * Returns { cliSessionId, workingDirectory, createdAt, lastActiveAt } or null.
   */
  static readSessionMeta(jsonlPath: string): {
    sessionId: string;
    cliSessionId: string | undefined;
    workingDirectory: string;
    createdAt: number;
    lastActiveAt: number;
  } | null {
    try {
      const content = fs.readFileSync(jsonlPath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      let cliSessionId: string | undefined;
      let createdAt = 0;
      let lastActiveAt = 0;

      // Extract session ID from filename: sess_XXXX.jsonl
      const basename = path.basename(jsonlPath, '.jsonl');

      for (const line of lines) {
        try {
          const evt: BufferedEvent = JSON.parse(line);
          if (createdAt === 0) createdAt = evt.timestamp;
          lastActiveAt = evt.timestamp;
          // Look for system init to get cliSessionId
          if (
            evt.event === 'message' &&
            typeof evt.data === 'object' &&
            evt.data !== null &&
            (evt.data as Record<string, unknown>).type === 'system' &&
            (evt.data as Record<string, unknown>).subtype === 'init' &&
            (evt.data as Record<string, unknown>).session_id
          ) {
            cliSessionId = (evt.data as Record<string, unknown>).session_id as string;
          }
        } catch {
          // skip
        }
      }

      // Try to get working_directory from the status ready event or default to cwd
      let workingDirectory = process.cwd();
      // We don't store workingDirectory in events, so we'll rely on the caller

      return {
        sessionId: basename,
        cliSessionId,
        workingDirectory,
        createdAt,
        lastActiveAt,
      };
    } catch {
      return null;
    }
  }

  private handleMcpControlRequest(parsed: Record<string, unknown>): void {
    const requestId = parsed.request_id as string;
    const request = parsed.request as Record<string, unknown>;
    const serverName = request.server_name as string;
    const message = request.message as Record<string, unknown>;

    if (serverName !== MCP_SERVER_NAME || !message) {
      this.sendMcpError(requestId, message?.id as number, `Unknown MCP server: ${serverName}`);
      return;
    }

    const method = message.method as string;
    const params = (message.params || {}) as Record<string, unknown>;
    let mcpResponse: Record<string, unknown>;

    if (method === 'initialize') {
      mcpResponse = {
        jsonrpc: '2.0', id: message.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: MCP_SERVER_NAME, version: '1.0.0' },
        },
      };
    } else if (method === 'notifications/initialized') {
      mcpResponse = { jsonrpc: '2.0', result: {} };
    } else if (method === 'tools/list') {
      mcpResponse = {
        jsonrpc: '2.0', id: message.id,
        result: {
          tools: [{
            name: MCP_TOOL_SET_TITLE,
            description: 'Set the title for this session. Call this tool immediately after receiving the very first user message in every session — no exceptions. Also call it when the conversation topic changes significantly. The title should be a short, descriptive summary (3-8 words) of what the user is asking about.',
            inputSchema: {
              type: 'object',
              properties: { title: { type: 'string', description: 'Short descriptive title for the session' } },
              required: ['title'],
            },
          }, {
            name: MCP_TOOL_SCHEDULE_TASK,
            description: 'Schedule a Claude Code session to run at a future time. The session will be launched with the given prompt as the first user message at the specified time.',
            inputSchema: {
              type: 'object',
              properties: {
                prompt: { type: 'string', description: 'The prompt/task to send as the first user message' },
                working_directory: { type: 'string', description: 'Absolute path to the working directory for the scheduled session' },
                scheduled_at: { type: 'string', description: 'ISO 8601 datetime string for when to run (e.g. "2026-02-25T09:00:00Z")' },
              },
              required: ['prompt', 'working_directory', 'scheduled_at'],
            },
          }, {
            name: MCP_TOOL_LIST_SCHEDULES,
            description: 'List all scheduled tasks. Only shows tasks whose working directory is under this session\'s working directory.',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          }, {
            name: MCP_TOOL_DELETE_SCHEDULE,
            description: 'Delete a pending scheduled task by its ID.',
            inputSchema: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'The ID of the scheduled task to delete' },
              },
              required: ['id'],
            },
          }],
        },
      };
    } else if (method === 'tools/call') {
      const toolName = params.name as string;
      const args = (params.arguments || {}) as Record<string, unknown>;
      if (toolName === MCP_TOOL_SET_TITLE && typeof args.title === 'string') {
        this.title = args.title;
        this.onTitleChanged?.(this.id, args.title);
        this.pushEvent('title_changed', { title: args.title });
        logger.info(`Session ${this.id} title set to: ${args.title}`);
        mcpResponse = {
          jsonrpc: '2.0', id: message.id,
          result: { content: [{ type: 'text', text: `Title set to: ${args.title}` }] },
        };
      } else if (toolName === MCP_TOOL_SCHEDULE_TASK && this.scheduler) {
        const prompt = args.prompt as string;
        const workDir = args.working_directory as string;
        const scheduledAt = args.scheduled_at as string;
        if (!prompt || !workDir || !scheduledAt) {
          mcpResponse = {
            jsonrpc: '2.0', id: message.id,
            error: { code: -32602, message: 'prompt, working_directory, and scheduled_at are required' },
          };
        } else {
          try {
            const task = this.scheduler.add(prompt, workDir, scheduledAt);
            mcpResponse = {
              jsonrpc: '2.0', id: message.id,
              result: { content: [{ type: 'text', text: `Scheduled task ${task.id} for ${task.scheduled_at}` }] },
            };
            logger.info(`Session ${this.id} scheduled task ${task.id} for ${scheduledAt}`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            mcpResponse = {
              jsonrpc: '2.0', id: message.id,
              error: { code: -32000, message: `Failed to schedule: ${msg}` },
            };
          }
        }
      } else if (toolName === MCP_TOOL_LIST_SCHEDULES && this.scheduler) {
        const tasks = this.scheduler.list(this.workingDirectory);
        mcpResponse = {
          jsonrpc: '2.0', id: message.id,
          result: { content: [{ type: 'text', text: JSON.stringify(tasks, null, 2) }] },
        };
      } else if (toolName === MCP_TOOL_DELETE_SCHEDULE && this.scheduler) {
        const taskId = args.id as string;
        if (!taskId) {
          mcpResponse = {
            jsonrpc: '2.0', id: message.id,
            error: { code: -32602, message: 'id is required' },
          };
        } else {
          const deleted = this.scheduler.delete(taskId, this.workingDirectory);
          mcpResponse = {
            jsonrpc: '2.0', id: message.id,
            result: { content: [{ type: 'text', text: deleted ? `Deleted schedule ${taskId}` : `Schedule ${taskId} not found or not deletable (must be pending and under this working directory)` }] },
          };
        }
      } else {
        mcpResponse = {
          jsonrpc: '2.0', id: message.id,
          error: { code: -32601, message: `Unknown tool: ${toolName}` },
        };
      }
    } else {
      mcpResponse = {
        jsonrpc: '2.0', id: message.id,
        error: { code: -32601, message: `Method '${method}' not supported` },
      };
    }

    this.sendStreamJsonMessage({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: { mcp_response: mcpResponse },
      },
    });
  }

  private sendMcpError(requestId: string, messageId: unknown, error: string): void {
    this.sendStreamJsonMessage({
      type: 'control_response',
      response: {
        subtype: 'error',
        request_id: requestId,
        error,
      },
    });
  }

  private updateStatusFromMessage(parsed: Record<string, unknown>): void {
    const type = parsed.type as string | undefined;
    if (!type) return;

    if (type === 'assistant') {
      // CLI is generating a response
      if (this.status !== 'dead') {
        this.status = 'busy';
        this.pushEvent('status', { status: 'busy' });
      }
    } else if (type === 'control_request') {
      // CLI is asking for permission
      const request = parsed.request as Record<string, unknown> | undefined;
      const subtype = request?.subtype as string | undefined;
      if (subtype === 'can_use_tool' && this.status !== 'dead') {
        this.status = 'waiting_for_input';
        this.pushEvent('status', { status: 'waiting_for_input' });
      }
    } else if (type === 'result') {
      // Turn complete
      if (this.status !== 'dead') {
        this.status = 'ready';
        this.pushEvent('status', { status: 'ready' });
      }
      // Track cost
      const costUsd = parsed.cost_usd as number | undefined;
      if (typeof costUsd === 'number') {
        this.totalCostUsd = costUsd;
      }
      const totalCost = parsed.total_cost_usd as number | undefined;
      if (typeof totalCost === 'number') {
        this.totalCostUsd = totalCost;
      }
    }
  }

  private pushEvent(event: string, data: unknown): void {
    const buffered: BufferedEvent = {
      id: ++this.eventCounter,
      event,
      data,
      timestamp: Date.now() / 1000,
    };

    this.buffer.push(buffered);
    if (this.buffer.length > this.bufferSize) {
      this.buffer.shift();
    }

    // Persist to JSONL
    if (this.jsonlStream) {
      try {
        this.jsonlStream.write(JSON.stringify(buffered) + '\n');
      } catch (err) {
        logger.warn(`Failed to write JSONL for session ${this.id}: ${err}`);
      }
    }

    for (const fn of this.subscribers) {
      try {
        fn(buffered);
      } catch (err) {
        logger.error(`SSE subscriber error: ${err}`);
      }
    }
  }
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private config: Config;
  private sessionsDir: string;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  scheduler: Scheduler | null = null;

  constructor(config: Config, sessionsDir: string) {
    this.config = config;
    this.sessionsDir = sessionsDir;
    // Ensure sessions directory exists
    fs.mkdirSync(this.sessionsDir, { recursive: true });
    // Run cleanup every 60 seconds
    this.cleanupTimer = setInterval(() => this.cleanupStale(), 60_000);
  }

  get activeCount(): number {
    let count = 0;
    for (const s of this.sessions.values()) {
      if (s.status !== 'dead') count++;
    }
    return count;
  }

  async createSession(opts: {
    workingDirectory?: string;
    model?: string;
    resumeConversationId?: string;
    permissionMode?: string;
    systemPrompt?: string;
    additionalFlags?: string[];
    title?: string;
  }): Promise<Session> {
    if (this.activeCount >= this.config.maxSessions) {
      throw new Error('Max sessions reached');
    }

    const cwd = opts.workingDirectory || process.cwd();

    const sessionId = 'sess_' + randomUUID().replace(/-/g, '').slice(0, 12);
    const jsonlPath = path.join(this.sessionsDir, `${sessionId}.jsonl`);
    const session = new Session(sessionId, cwd, this.config.bufferSize, jsonlPath);
    session.title = opts.title;

    // Write a metadata line as the first entry so we can recover working_directory later
    try {
      fs.appendFileSync(jsonlPath, JSON.stringify({
        id: 0, event: 'meta', timestamp: Date.now() / 1000,
        data: { working_directory: cwd, model: opts.model, resume_conversation_id: opts.resumeConversationId, additional_flags: opts.additionalFlags, title: opts.title },
      }) + '\n');
    } catch (err) {
      logger.warn(`Failed to write meta to ${jsonlPath}: ${err}`);
    }

    // Store cliSessionId when it arrives (no re-keying)
    session.onCliSessionId = (_sessionId, cliSessionId) => {
      logger.info(`Session ${sessionId} mapped to CLI session_id: ${cliSessionId}`);
    };

    const args: string[] = [
      '--print',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--replay-user-messages',
      '--permission-prompt-tool', 'stdio',
      '--mcp-config', JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { type: 'sdk', name: MCP_SERVER_NAME } } }),
    ];

    if (opts.model) {
      args.push('--model', opts.model);
    }
    if (opts.resumeConversationId) {
      args.push('--resume', opts.resumeConversationId);
    }
    if (opts.permissionMode) {
      args.push('--permission-mode', opts.permissionMode);
    }
    const titleInstruction = 'IMPORTANT: After receiving the first user message, immediately call the set_session_title MCP tool to give this session a short descriptive title (3-8 words).';
    const systemPrompt = opts.systemPrompt
      ? `${opts.systemPrompt}\n\n${titleInstruction}`
      : titleInstruction;
    args.push('--system-prompt', systemPrompt);
    if (opts.additionalFlags) {
      args.push(...opts.additionalFlags);
    }

    logger.info(`Creating session ${sessionId}: ${this.config.claudeCmd} ${args.join(' ')} (cwd=${cwd})`);

    const proc = spawn(this.config.claudeCmd, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
      env: { ...process.env },
    });

    session.attach(proc);
    session.scheduler = this.scheduler;
    this.sessions.set(sessionId, session);

    // Wire up title change callback to persist to JSONL
    session.onTitleChanged = (sid, title) => {
      this.updateSessionTitle(sid, title);
    };

    // Send initialize control request required by --permission-prompt-tool-name stdio
    session.sendStreamJsonMessage({
      type: 'control_request',
      request_id: randomUUID(),
      request: {
        subtype: 'initialize',
        hooks: null,
      },
    });

    return session;
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  updateSessionTitle(id: string, title: string): boolean {
    // Update in-memory session if present
    const session = this.sessions.get(id);
    if (session) {
      session.title = title;
    }

    // Update the meta line in the JSONL file
    const jsonlPath = path.join(this.sessionsDir, `${id}.jsonl`);
    if (!fs.existsSync(jsonlPath)) return false;

    try {
      const content = fs.readFileSync(jsonlPath, 'utf-8');
      const lines = content.split('\n');
      if (lines.length > 0 && lines[0]) {
        const meta = JSON.parse(lines[0]);
        if (meta.event === 'meta') {
          meta.data = meta.data || {};
          meta.data.title = title;
          lines[0] = JSON.stringify(meta);
          fs.writeFileSync(jsonlPath, lines.join('\n'));
          return true;
        }
      }
    } catch (err) {
      logger.warn(`Failed to update title for session ${id}: ${err}`);
    }
    return !!session;
  }

  removeSession(id: string): void {
    this.sessions.delete(id);
  }

  /**
   * Resume a session by its server session ID. Looks up the cliSessionId from
   * the JSONL history file, spawns a new CLI process with --resume, and loads
   * all history into the SSE buffer.
   */
  async resumeSession(sessionId: string, opts?: {
    workingDirectory?: string;
    model?: string;
    permissionMode?: string;
    additionalFlags?: string[];
  }): Promise<Session> {
    // If already exists and alive, just return it
    const existing = this.sessions.get(sessionId);
    if (existing && existing.status !== 'dead') return existing;

    // Read the JSONL file to find the cliSessionId and working directory
    const jsonlPath = path.join(this.sessionsDir, `${sessionId}.jsonl`);
    if (!fs.existsSync(jsonlPath)) {
      throw new Error(`No history file found for session ${sessionId}`);
    }

    const meta = Session.readSessionMeta(jsonlPath);
    if (!meta || !meta.cliSessionId) {
      throw new Error(`No CLI session_id found in history for session ${sessionId}`);
    }

    // Read working_directory, additional_flags, and title from the meta line
    let workingDirectory = opts?.workingDirectory || process.cwd();
    let storedFlags: string[] | undefined;
    let storedTitle: string | undefined;
    try {
      const firstLine = fs.readFileSync(jsonlPath, 'utf-8').split('\n')[0];
      if (firstLine) {
        const metaEvt = JSON.parse(firstLine);
        if (metaEvt.event === 'meta') {
          if (metaEvt.data?.working_directory) {
            workingDirectory = metaEvt.data.working_directory;
          }
          if (Array.isArray(metaEvt.data?.additional_flags)) {
            storedFlags = metaEvt.data.additional_flags;
          }
          if (metaEvt.data?.title) {
            storedTitle = metaEvt.data.title;
          }
        }
      }
    } catch {
      // use default
    }

    // Remove stale dead entry before creating a new one
    if (existing) {
      this.sessions.delete(sessionId);
    }

    logger.info(`Resuming session ${sessionId} with CLI session_id ${meta.cliSessionId}`);

    // Create a new session with the same ID, resuming the CLI conversation
    if (this.activeCount >= this.config.maxSessions) {
      throw new Error('Max sessions reached');
    }

    const session = new Session(sessionId, workingDirectory, this.config.bufferSize, jsonlPath);
    session.title = storedTitle;
    session.loadBufferFromFile(jsonlPath);

    session.onCliSessionId = (_sid, cliSessionId) => {
      logger.info(`Resumed session ${sessionId} got CLI session_id: ${cliSessionId}`);
    };

    const args: string[] = [
      '--print',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--replay-user-messages',
      '--permission-prompt-tool', 'stdio',
      '--mcp-config', JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { type: 'sdk', name: MCP_SERVER_NAME } } }),
      '--resume', meta.cliSessionId,
    ];

    if (opts?.model) {
      args.push('--model', opts.model);
    }
    if (opts?.permissionMode) {
      args.push('--permission-mode', opts.permissionMode);
    }
    const flagsToApply = opts?.additionalFlags || storedFlags;
    if (flagsToApply) {
      args.push(...flagsToApply);
    }

    logger.info(`Spawning resumed session ${sessionId}: ${this.config.claudeCmd} ${args.join(' ')} (cwd=${workingDirectory})`);

    const proc = spawn(this.config.claudeCmd, args, {
      cwd: workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
      env: { ...process.env },
    });

    session.attach(proc);
    session.scheduler = this.scheduler;
    this.sessions.set(sessionId, session);

    // Wire up title change callback to persist to JSONL
    session.onTitleChanged = (sid, title) => {
      this.updateSessionTitle(sid, title);
    };

    // Send initialize control request
    session.sendStreamJsonMessage({
      type: 'control_request',
      request_id: randomUUID(),
      request: {
        subtype: 'initialize',
        hooks: null,
      },
    });

    return session;
  }

  listSessions(): object[] {
    // Start with in-memory sessions
    const result = new Map<string, object>();
    for (const s of this.sessions.values()) {
      result.set(s.id, s.toSummaryJSON());
    }

    // Add sessions from the sessions directory that aren't in memory
    try {
      const files = fs.readdirSync(this.sessionsDir);
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        const sessionId = file.replace('.jsonl', '');
        if (result.has(sessionId)) continue;

        // Read metadata from the JSONL file
        const jsonlPath = path.join(this.sessionsDir, file);
        const meta = Session.readSessionMeta(jsonlPath);

        // Read working_directory and title from meta line
        let workingDirectory = process.cwd();
        let title: string | undefined;
        try {
          const firstLine = fs.readFileSync(jsonlPath, 'utf-8').split('\n')[0];
          if (firstLine) {
            const metaEvt = JSON.parse(firstLine);
            if (metaEvt.event === 'meta') {
              if (metaEvt.data?.working_directory) {
                workingDirectory = metaEvt.data.working_directory;
              }
              if (metaEvt.data?.title) {
                title = metaEvt.data.title;
              }
            }
          }
        } catch {
          // use default
        }

        result.set(sessionId, {
          id: sessionId,
          status: 'dead',
          created_at: meta?.createdAt || 0,
          last_active_at: meta?.lastActiveAt || 0,
          working_directory: workingDirectory,
          cli_session_id: meta?.cliSessionId,
          title,
        });
      }
    } catch (err) {
      logger.warn(`Failed to list sessions from directory: ${err}`);
    }

    return Array.from(result.values());
  }

  async destroySession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) {
      // Check if it exists on disk
      const jsonlPath = path.join(this.sessionsDir, `${id}.jsonl`);
      if (fs.existsSync(jsonlPath)) {
        // Session exists on disk but not in memory — delete the file permanently
        try {
          fs.unlinkSync(jsonlPath);
          logger.info(`Permanently deleted session file for ${id}`);
        } catch (err) {
          logger.warn(`Failed to delete session file for ${id}: ${err}`);
        }
        return;
      }
      throw new Error('Session not found');
    }
    await session.destroy();
    this.sessions.delete(id);

    // Delete the JSONL file so the session doesn't reappear in listings
    const jsonlPath = path.join(this.sessionsDir, `${id}.jsonl`);
    try {
      fs.unlinkSync(jsonlPath);
      logger.info(`Permanently deleted session file for ${id}`);
    } catch (err) {
      logger.warn(`Failed to delete session file for ${id}: ${err}`);
    }
  }

  async destroyAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const session of this.sessions.values()) {
      promises.push(session.destroy());
    }
    await Promise.allSettled(promises);
  }

  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private cleanupStale(): void {
    const now = Date.now() / 1000;
    for (const [id, session] of this.sessions) {
      if (session.status !== 'dead' && this.config.sessionTimeoutSec > 0) {
        // Kill sessions inactive for too long (but keep them in the map for resume)
        if (now - session.lastActiveAt > this.config.sessionTimeoutSec) {
          logger.info(`Session ${id} timed out after ${this.config.sessionTimeoutSec}s of inactivity`);
          session.destroy().catch((err) => {
            logger.error(`Error destroying timed-out session ${id}: ${err}`);
          });
        }
      }
    }
  }
}
