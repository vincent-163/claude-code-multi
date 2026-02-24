import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { SessionManager } from './session';
import { logger } from './logger';

export interface ScheduledTask {
  id: string;
  prompt: string;
  working_directory: string;
  scheduled_at: string;   // ISO 8601
  created_at: string;     // ISO 8601
  status: 'pending' | 'running' | 'completed' | 'failed';
  session_id: string | null;
  error: string | null;
}

export class Scheduler {
  private db: Database.Database;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private manager: SessionManager;
  private sessionOpts: { model?: string; permissionMode?: string; additionalFlags?: string[] };

  constructor(dbPath: string, manager: SessionManager, sessionOpts?: {
    model?: string;
    permissionMode?: string;
    additionalFlags?: string[];
  }) {
    this.manager = manager;
    this.sessionOpts = sessionOpts || {};

    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        working_directory TEXT NOT NULL,
        scheduled_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        status TEXT NOT NULL DEFAULT 'pending',
        session_id TEXT,
        error TEXT
      )
    `);
  }

  /** Add a new scheduled task. Returns the created task. */
  add(prompt: string, workingDirectory: string, scheduledAt: string): ScheduledTask {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO scheduled_tasks (id, prompt, working_directory, scheduled_at, created_at, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`
    ).run(id, prompt, workingDirectory, scheduledAt, now);
    return { id, prompt, working_directory: workingDirectory, scheduled_at: scheduledAt, created_at: now, status: 'pending', session_id: null, error: null };
  }

  /** List tasks whose working_directory is under the given base directory. */
  list(baseDir: string): ScheduledTask[] {
    const resolved = path.resolve(baseDir);
    const rows = this.db.prepare(
      `SELECT id, prompt, working_directory, scheduled_at, created_at, status, session_id, error
       FROM scheduled_tasks ORDER BY scheduled_at ASC`
    ).all() as ScheduledTask[];
    return rows.filter(r => {
      const rd = path.resolve(r.working_directory);
      return rd === resolved || rd.startsWith(resolved + path.sep);
    });
  }

  /** Delete a task by ID. Returns true if deleted. Only deletes pending tasks. */
  delete(id: string, baseDir: string): boolean {
    const row = this.db.prepare(
      `SELECT working_directory, status FROM scheduled_tasks WHERE id = ?`
    ).get(id) as { working_directory: string; status: string } | undefined;
    if (!row) return false;
    // Only allow deleting tasks under the base directory
    const resolved = path.resolve(baseDir);
    const rd = path.resolve(row.working_directory);
    if (rd !== resolved && !rd.startsWith(resolved + path.sep)) return false;
    if (row.status !== 'pending') return false;
    this.db.prepare(`DELETE FROM scheduled_tasks WHERE id = ?`).run(id);
    return true;
  }

  /** Start polling for due tasks. */
  start(intervalMs: number = 5000): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.pollDue(), intervalMs);
    logger.info(`Scheduler started, polling every ${intervalMs}ms`);
    // Run once immediately
    this.pollDue();
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private pollDue(): void {
    const now = new Date().toISOString();
    const dueTasks = this.db.prepare(
      `SELECT id, prompt, working_directory, scheduled_at, created_at, status, session_id, error
       FROM scheduled_tasks WHERE status = 'pending' AND scheduled_at <= ?`
    ).all(now) as ScheduledTask[];

    for (const task of dueTasks) {
      this.executeTask(task);
    }
  }

  private async executeTask(task: ScheduledTask): Promise<void> {
    // Mark as running immediately to prevent double-execution
    this.db.prepare(`UPDATE scheduled_tasks SET status = 'running' WHERE id = ? AND status = 'pending'`).run(task.id);

    try {
      const scheduledPrompt = `[Scheduled task] ${task.prompt}`;
      const session = await this.manager.createSession({
        workingDirectory: task.working_directory,
        model: this.sessionOpts.model,
        permissionMode: this.sessionOpts.permissionMode,
        additionalFlags: this.sessionOpts.additionalFlags,
        title: `Scheduled: ${task.prompt.slice(0, 60)}`,
      });

      // Wait for session to be ready before sending the prompt
      await new Promise<void>((resolve) => {
        const check = () => {
          if (session.status === 'ready' || session.status === 'waiting_for_input') {
            resolve();
          } else if (session.status === 'dead') {
            resolve();
          } else {
            setTimeout(check, 500);
          }
        };
        setTimeout(check, 1000);
      });

      if (session.status === 'dead') {
        throw new Error('Session died before becoming ready');
      }

      session.sendStreamJsonMessage({
        type: 'user',
        message: { role: 'user', content: scheduledPrompt },
      });

      this.db.prepare(
        `UPDATE scheduled_tasks SET status = 'completed', session_id = ? WHERE id = ?`
      ).run(session.id, task.id);

      logger.info(`Scheduled task ${task.id} launched as session ${session.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.db.prepare(
        `UPDATE scheduled_tasks SET status = 'failed', error = ? WHERE id = ?`
      ).run(message, task.id);
      logger.error(`Scheduled task ${task.id} failed: ${message}`);
    }
  }
}
