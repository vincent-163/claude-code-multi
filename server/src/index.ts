import express from 'express';
import { loadConfig } from './config';
import { setLogLevel, logger } from './logger';
import { SessionManager } from './session';
import { Scheduler } from './scheduler';
import { authMiddleware } from './auth';
import { createRoutes } from './routes';

import * as path from 'path';

const config = loadConfig();
setLogLevel(config.logLevel);

const sessionsDir = path.resolve(config.sessionsDir);
const manager = new SessionManager(config, sessionsDir);

// Initialize scheduler with SQLite DB in sessions directory
const schedulerDbPath = path.join(sessionsDir, 'scheduler.db');
const scheduler = new Scheduler(schedulerDbPath, manager);
manager.scheduler = scheduler;
scheduler.start(5000);

const app = express();

app.use(express.json());

// Health endpoint is public
app.get('/health', (_req, res, next) => next());

// Auth middleware for all other routes
app.use('/sessions', authMiddleware(config));

// Mount routes
app.use(createRoutes(manager));

// Serve web frontend static files (built by web/ project into server/public/)
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));
// SPA fallback: serve index.html for non-API routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down...`);
  scheduler.stop();
  manager.shutdown();
  await manager.destroyAll();
  logger.info('All sessions destroyed, exiting.');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

const server = app.listen(config.port, config.host, () => {
  logger.info(`cc-server listening on http://${config.host}:${config.port}`);
  logger.info(`Auth: ${config.authTokens.length > 0 ? 'enabled' : 'disabled (no tokens configured)'}`);
  logger.info(`Max sessions: ${config.maxSessions}, buffer size: ${config.bufferSize}`);
  logger.info(`Session timeout: ${config.sessionTimeoutSec}s`);
  logger.info(`Persistent cooldown default: ${config.persistentCooldownSec}s, ready cooldown: ${config.persistentReadyCooldownSec}s`);
});

server.on('error', (err) => {
  logger.error(`Server error: ${err.message}`);
  process.exit(1);
});
