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
}

export function loadConfig(): Config {
  const tokensRaw = process.env.CC_AUTH_TOKENS || '';
  const authTokens = tokensRaw
    ? tokensRaw.split(',').map((t) => t.trim()).filter(Boolean)
    : [];

  return {
    host: process.env.CC_HOST || '127.0.0.1',
    port: parseInt(process.env.CC_PORT || '8080', 10),
    maxSessions: parseInt(process.env.CC_MAX_SESSIONS || '10', 10),
    claudeCmd: process.env.CC_CLAUDE_CMD || 'claude',
    authTokens,
    bufferSize: parseInt(process.env.CC_BUFFER_SIZE || '1000', 10),
    sessionTimeoutSec: parseInt(process.env.CC_SESSION_TIMEOUT || '3600000', 10),
    logLevel: process.env.CC_LOG_LEVEL || 'info',
    sessionsDir: process.env.CC_SESSIONS_DIR || 'sessions',
  };
}
