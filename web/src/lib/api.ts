import type { Settings, Session, BufferedEvent } from './types';

function getHeaders(settings: Settings): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (settings.authToken) h['Authorization'] = `Bearer ${settings.authToken}`;
  return h;
}

function baseUrl(settings: Settings): string {
  return settings.apiUrl.replace(/\/+$/, '');
}

export async function healthCheck(settings: Settings) {
  const res = await fetch(`${baseUrl(settings)}/health`);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}

export async function listSessions(settings: Settings): Promise<Session[]> {
  const res = await fetch(`${baseUrl(settings)}/sessions`, { headers: getHeaders(settings) });
  if (!res.ok) throw new Error(`List sessions failed: ${res.status}`);
  const data = await res.json();
  return data.sessions;
}

export async function createSession(
  settings: Settings,
  opts: {
    working_directory?: string;
    model?: string;
    resume_conversation_id?: string;
    dangerously_skip_permissions?: boolean;
    additional_flags?: string[];
    backend?: string;
  },
): Promise<Session> {
  const res = await fetch(`${baseUrl(settings)}/sessions`, {
    method: 'POST',
    headers: getHeaders(settings),
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Create session failed: ${res.status}`);
  }
  return res.json();
}

export async function getSession(
  settings: Settings,
  id: string,
  historyLines = 200,
): Promise<Session & { history: BufferedEvent[] }> {
  const res = await fetch(`${baseUrl(settings)}/sessions/${id}?history_lines=${historyLines}`, {
    headers: getHeaders(settings),
  });
  if (!res.ok) throw new Error(`Get session failed: ${res.status}`);
  return res.json();
}

export async function deleteSession(settings: Settings, id: string): Promise<void> {
  const res = await fetch(`${baseUrl(settings)}/sessions/${id}`, {
    method: 'DELETE',
    headers: getHeaders(settings),
  });
  if (!res.ok) throw new Error(`Delete session failed: ${res.status}`);
}

export async function updateSessionTitle(settings: Settings, id: string, title: string): Promise<void> {
  const res = await fetch(`${baseUrl(settings)}/sessions/${id}`, {
    method: 'PATCH',
    headers: getHeaders(settings),
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`Update session failed: ${res.status}`);
}

export async function sendInput(
  settings: Settings,
  id: string,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`${baseUrl(settings)}/sessions/${id}/input`, {
    method: 'POST',
    headers: getHeaders(settings),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Send input failed: ${res.status}`);
}
