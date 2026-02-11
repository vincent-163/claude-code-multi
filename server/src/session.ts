import { ChildProcess, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { createInterface, Interface } from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { Config } from './config';
import { logger } from './logger';

export type SessionStatus = 'starting' | 'ready' | 'busy' | 'waiting_for_input' | 'dead';

export interface BufferedEvent {
  id: number;
  event: string;
  data: unknown;
  timestamp: number;
}

export type SSESubscriber = (event: BufferedEvent) => void;

export class Session {
  id: string;
  readonly createdAt: number;
  readonly workingDirectory: string;
  status: SessionStatus = 'starting';
  lastActiveAt: number;
  pid: number | undefined;
  cliSessionId: string | undefined;

  totalCostUsd: number = 0;

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
  }): Promise<Session> {
    if (this.activeCount >= this.config.maxSessions) {
      throw new Error('Max sessions reached');
    }

    const cwd = opts.workingDirectory || process.cwd();

    const sessionId = 'sess_' + randomUUID().replace(/-/g, '').slice(0, 12);
    const jsonlPath = path.join(this.sessionsDir, `${sessionId}.jsonl`);
    const session = new Session(sessionId, cwd, this.config.bufferSize, jsonlPath);

    // Write a metadata line as the first entry so we can recover working_directory later
    try {
      fs.appendFileSync(jsonlPath, JSON.stringify({
        id: 0, event: 'meta', timestamp: Date.now() / 1000,
        data: { working_directory: cwd, model: opts.model, resume_conversation_id: opts.resumeConversationId },
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
    if (opts.systemPrompt) {
      args.push('--system-prompt', opts.systemPrompt);
    }
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
    this.sessions.set(sessionId, session);

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

    // Read working_directory from the meta line
    let workingDirectory = opts?.workingDirectory || process.cwd();
    try {
      const firstLine = fs.readFileSync(jsonlPath, 'utf-8').split('\n')[0];
      if (firstLine) {
        const metaEvt = JSON.parse(firstLine);
        if (metaEvt.event === 'meta' && metaEvt.data?.working_directory) {
          workingDirectory = metaEvt.data.working_directory;
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

    // Load all history from JSONL into the buffer so SSE clients get full history
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
      '--resume', meta.cliSessionId,
    ];

    if (opts?.model) {
      args.push('--model', opts.model);
    }
    if (opts?.permissionMode) {
      args.push('--permission-mode', opts.permissionMode);
    }
    if (opts?.additionalFlags) {
      args.push(...opts.additionalFlags);
    }

    logger.info(`Spawning resumed session ${sessionId}: ${this.config.claudeCmd} ${args.join(' ')} (cwd=${workingDirectory})`);

    const proc = spawn(this.config.claudeCmd, args, {
      cwd: workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
      env: { ...process.env },
    });

    session.attach(proc);
    this.sessions.set(sessionId, session);

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

        // Read working_directory from meta line
        let workingDirectory = process.cwd();
        try {
          const firstLine = fs.readFileSync(jsonlPath, 'utf-8').split('\n')[0];
          if (firstLine) {
            const metaEvt = JSON.parse(firstLine);
            if (metaEvt.event === 'meta' && metaEvt.data?.working_directory) {
              workingDirectory = metaEvt.data.working_directory;
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
