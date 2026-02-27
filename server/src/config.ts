export interface Config {
  host: string;
  port: number;
  maxSessions: number;
  claudeCmd: string;
  authTokens: string[];
  bufferSize: number;
  sessionTimeoutSec: number;
  logLevel: string;
  sessionsDir: string;
  /** Context window size in tokens (default 200000). Used for auto-compact percentage calculation. */
  contextWindowSize: number;
  /** Auto-compact threshold as percentage (0-100). 0 disables auto-compact. Default 80. */
  autoCompactThreshold: number;
}

export function loadConfig(): Config {
  const tokensRaw = process.env.CC_AUTH_TOKENS || '';
  const authTokens = tokensRaw
    ? tokensRaw.split(',').map((t) => t.trim()).filter(Boolean)
    : [];

  return {
    host: process.env.CC_HOST || '127.0.0.1',
    port: parseInt(process.env.CC_PORT || '8080', 10),
    maxSessions: parseInt(process.env.CC_MAX_SESSIONS || '50', 10),
    claudeCmd: process.env.CC_CLAUDE_CMD || 'claude',
    authTokens,
    bufferSize: parseInt(process.env.CC_BUFFER_SIZE || '1000', 10),
    sessionTimeoutSec: parseInt(process.env.CC_SESSION_TIMEOUT || '3600000', 10),
    logLevel: process.env.CC_LOG_LEVEL || 'info',
    sessionsDir: process.env.CC_SESSIONS_DIR || 'sessions',
    contextWindowSize: parseInt(process.env.CC_CONTEXT_WINDOW_SIZE || '200000', 10),
    autoCompactThreshold: parseInt(process.env.CC_AUTO_COMPACT_THRESHOLD || '80', 10),
  };
}
