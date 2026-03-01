import { Router, Request, Response } from 'express';
import { SessionManager, Session, BufferedEvent } from './session';
import { logger } from './logger';

const startTime = Date.now();

export function createRoutes(manager: SessionManager): Router {
  const router = Router();

  /**
   * Try to get an existing session, or resume it if not found.
   * Returns the session or null if resume also fails.
   */
  async function getOrResumeSession(id: string): Promise<Session | null> {
    const existing = manager.getSession(id);
    if (existing && existing.status !== 'dead') return existing;

    // Session is dead or not in map — attempt to resume
    try {
      logger.info(`Session ${id} not found or dead, attempting resume`);
      return await manager.resumeSession(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`Failed to resume session ${id}: ${message}`);
      // Remove the stale entry since resume failed
      manager.removeSession(id);
      return null;
    }
  }

  // --- Health ---
  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      version: '1.0.0',
      sessions_active: manager.activeCount,
      uptime_seconds: Math.round((Date.now() - startTime) / 1000),
    });
  });

  // --- Create Session ---
  router.post('/sessions', async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const additionalFlags: string[] = [];
      if (Array.isArray(body.additional_flags)) {
        additionalFlags.push(...body.additional_flags.filter((f: unknown) => typeof f === 'string'));
      }
      if (body.dangerously_skip_permissions) {
        additionalFlags.push('--dangerously-skip-permissions');
      }
      const session = await manager.createSession({
        workingDirectory: body.working_directory,
        model: body.model,
        resumeConversationId: body.resume_conversation_id,
        permissionMode: body.permission_mode,
        systemPrompt: body.system_prompt,
        additionalFlags: additionalFlags.length > 0 ? additionalFlags : undefined,
        backend: body.backend,
      });
      res.status(201).json(session.toJSON());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'Max sessions reached') {
        res.status(503).json({ error: message });
      } else {
        res.status(400).json({ error: message });
      }
    }
  });

  // --- List Sessions ---
  router.get('/sessions', (_req: Request, res: Response) => {
    res.json({ sessions: manager.listSessions() });
  });

  // --- Get Session ---
  router.get('/sessions/:id', async (req: Request, res: Response) => {
    const session = await getOrResumeSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const historyLines = parseInt(req.query.history_lines as string, 10) || 200;
    const history = session.getHistory(historyLines);

    res.json({
      ...session.toJSON(),
      history,
    });
  });

  // --- Send Input ---
  router.post('/sessions/:id/input', async (req: Request, res: Response) => {
    const session = await getOrResumeSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (session.status === 'dead') {
      res.status(400).json({ error: 'Session is dead' });
      return;
    }

    const body = req.body || {};
    const msgType = body.type;

    if (msgType === 'interrupt') {
      const ok = session.sendInterrupt();
      res.json({ status: ok ? 'sent' : 'failed' });
      return;
    }

    if (msgType === 'user_message') {
      const content = body.content;
      if (typeof content !== 'string' || !content) {
        res.status(400).json({ error: 'content is required for user_message' });
        return;
      }
      // Claude Code stream-json expects: {"type":"user","message":{"role":"user","content":"..."}}
      const ok = session.sendStreamJsonMessage({
        type: 'user',
        message: { role: 'user', content },
      });
      res.json({ status: ok ? 'sent' : 'failed' });
      return;
    }

    if (msgType === 'tool_result') {
      const content = body.content;
      if (content === undefined) {
        res.status(400).json({ error: 'content is required for tool_result' });
        return;
      }
      // Forward tool_result as-is to Claude Code stdin
      const ok = session.sendStreamJsonMessage({
        type: 'tool_result',
        ...body,
      });
      res.json({ status: ok ? 'sent' : 'failed' });
      return;
    }

    if (msgType === 'control_response' || msgType === 'control_request') {
      // Forward control protocol messages as-is to Claude Code stdin
      const ok = session.sendStreamJsonMessage(body);
      res.json({ status: ok ? 'sent' : 'failed' });
      return;
    }

    res.status(400).json({ error: `Unknown message type: ${msgType}` });
  });

  // --- SSE Stream ---
  router.get('/sessions/:id/stream', async (req: Request, res: Response) => {
    const session = await getOrResumeSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send any missed events if last_event_id is provided
    const lastEventId = parseInt(req.query.last_event_id as string, 10) || 0;
    if (lastEventId > 0) {
      const history = session.getHistory(session.bufferLength);
      for (const evt of history) {
        if (evt.id > lastEventId) {
          writeSSE(res, evt);
        }
      }
    }

    // Subscribe to new events
    const onEvent = (evt: BufferedEvent) => {
      writeSSE(res, evt);
    };

    session.subscribe(onEvent);

    // Keepalive ping every 15 seconds
    const pingInterval = setInterval(() => {
      try {
        res.write('event: ping\ndata: {}\n\n');
      } catch {
        cleanup();
      }
    }, 15_000);

    const cleanup = () => {
      clearInterval(pingInterval);
      session.unsubscribe(onEvent);
    };

    req.on('close', cleanup);
    req.on('error', cleanup);
  });

  // --- Update Session (title, description) ---
  router.patch('/sessions/:id', (req: Request, res: Response) => {
    const { title, description } = req.body || {};
    if (typeof title !== 'string' && typeof description !== 'string') {
      res.status(400).json({ error: 'title or description must be a string' });
      return;
    }
    let found = false;
    if (typeof title === 'string') {
      found = manager.updateSessionTitle(req.params.id, title) || found;
    }
    if (typeof description === 'string') {
      found = manager.updateSessionDescription(req.params.id, description) || found;
    }
    if (!found) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ id: req.params.id, title, description });
  });

  // --- Resize ---
  router.post('/sessions/:id/resize', (req: Request, res: Response) => {
    const session = manager.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    // In stream-json mode, resize is a no-op but we accept it for API completeness
    logger.debug(`Resize request for session ${session.id}: ${JSON.stringify(req.body)}`);
    res.json({ status: 'ok' });
  });

  // --- Destroy Session ---
  router.delete('/sessions/:id', async (req: Request, res: Response) => {
    try {
      await manager.destroySession(req.params.id);
      res.json({ id: req.params.id, status: 'destroyed' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'Session not found') {
        res.status(404).json({ error: message });
      } else {
        res.status(500).json({ error: message });
      }
    }
  });

  return router;
}

function writeSSE(res: Response, evt: BufferedEvent): void {
  try {
    res.write(`event: ${evt.event}\nid: ${evt.id}\ndata: ${JSON.stringify(evt.data)}\n\n`);
  } catch {
    // Client disconnected
  }
}
