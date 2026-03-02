import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { Settings, Session, Backend } from '../lib/types'
import * as api from '../lib/api'

function formatElapsed(epochSec: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - epochSec))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

interface Props {
  settings: Settings
  onUpdateSettings: (s: Settings) => void
  onOpenChat: (sessionId: string) => void
  onOpenSettings: () => void
}

export default function SessionsPage({ settings, onUpdateSettings, onOpenChat, onOpenSettings }: Props) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const editRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    try {
      setError('')
      const list = await api.listSessions(settings)
      list.sort((a, b) => b.last_active_at - a.last_active_at)
      setSessions(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions')
    } finally {
      setLoading(false)
    }
  }, [settings])

  useEffect(() => { refresh() }, [refresh])

  // Tick every second to update elapsed times
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus()
      editRef.current.select()
    }
  }, [editingId])

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (!confirm('Delete this session?')) return
    try {
      await api.deleteSession(settings, id)
      setSessions((s) => s.filter((x) => x.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const startEditing = (e: React.MouseEvent, s: Session) => {
    e.stopPropagation()
    setEditingId(s.id)
    setEditValue(s.title || '')
  }

  const commitTitle = async (id: string) => {
    const trimmed = editValue.trim()
    setEditingId(null)
    try {
      await api.updateSessionTitle(settings, id, trimmed)
      setSessions((prev) => prev.map((s) => s.id === id ? { ...s, title: trimmed || undefined } : s))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed')
    }
  }

  const handleEditKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter') {
      commitTitle(id)
    } else if (e.key === 'Escape') {
      setEditingId(null)
    }
  }

  const statusColor = (s: string) => `status-${s}`

  const { teams, standalone } = useMemo(() => {
    const teamMap = new Map<string, Session[]>()
    const standalone: Session[] = []
    for (const s of sessions) {
      if (s.team_id) {
        const arr = teamMap.get(s.team_id) || []
        arr.push(s)
        teamMap.set(s.team_id, arr)
      } else {
        standalone.push(s)
      }
    }
    // Sort teams by lead's last_active_at descending
    const teams = Array.from(teamMap.entries()).map(([teamId, members]) => {
      const lead = members.find((m) => m.id === teamId)
      const others = members.filter((m) => m.id !== teamId)
      return { teamId, lead, members: others, lastActive: lead?.last_active_at ?? Math.max(...members.map((m) => m.last_active_at)) }
    })
    teams.sort((a, b) => b.lastActive - a.lastActive)
    return { teams, standalone }
  }, [sessions])

  const renderSessionCard = (s: Session, indent = false) => (
    <div key={s.id} className="session-card" onClick={() => onOpenChat(s.id)} style={indent ? { marginLeft: 24, borderLeft: '2px solid var(--border)', opacity: 0.92 } : undefined}>
      <div className={`status-dot ${statusColor(s.status)}`} />
      <div className="info">
        {editingId === s.id ? (
          <input
            ref={editRef}
            className="title-edit"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => commitTitle(s.id)}
            onKeyDown={(e) => handleEditKeyDown(e, s.id)}
            onClick={(e) => e.stopPropagation()}
            placeholder="Untitled"
          />
        ) : (
          <div className="title" onClick={(e) => startEditing(e, s)}>
            {s.title || <span className="title-placeholder">Untitled</span>}
            {s.description && <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 8 }}>{s.description}</span>}
          </div>
        )}
        <div className="dir">{s.working_directory || '~'}</div>
        <div className="id">{s.id}</div>
      </div>
      <div className="meta">
        <div>
          {s.status}
          {s.backend === 'codex' ? ' · Codex' : s.backend === 'claude' ? ' · Claude' : ''}
          {s.persistent ? ' · Persistent' : ''}
        </div>
        {s.persistent && (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            cooldown {s.persistent_cooldown_sec ?? 900}s
          </div>
        )}
        {(s.total_cost_usd ?? 0) > 0 && <div>${s.total_cost_usd!.toFixed(4)}</div>}
        <div style={{ fontSize: 11 }}>
          {s.last_user_message_at ? `👤 ${formatElapsed(s.last_user_message_at)}` : ''}
          {s.last_user_message_at && s.last_assistant_message_at ? ' · ' : ''}
          {s.last_assistant_message_at ? `🤖 ${formatElapsed(s.last_assistant_message_at)}` : ''}
        </div>
      </div>
      <button className="danger" onClick={(e) => handleDelete(e, s.id)} style={{ padding: '4px 10px', fontSize: 12 }}>
        Delete
      </button>
    </div>
  )

  return (
    <div className="sessions-page">
      <div className="header">
        <h1>AI Code</h1>
        <div className="spacer" />
        <button onClick={refresh} disabled={loading}>Refresh</button>
        <button onClick={onOpenSettings}>Settings</button>
        <button className="primary" onClick={() => setShowCreate(true)}>New Session</button>
      </div>

      {error && <div style={{ padding: '8px 16px', color: 'var(--red)', fontSize: 13 }}>{error}</div>}

      <div className="sessions-list">
        {loading && <div className="empty-state">Loading...</div>}
        {!loading && sessions.length === 0 && (
          <div className="empty-state">
            <div>No sessions</div>
            <div style={{ fontSize: 12 }}>Create a new session to get started</div>
          </div>
        )}
        {teams.map(({ teamId, lead, members }) => (
          <div key={teamId} className="team-group" style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', padding: '6px 12px 2px', fontWeight: 500 }}>Team</div>
            {lead && renderSessionCard(lead)}
            {members.map((m) => renderSessionCard(m, true))}
          </div>
        ))}
        {standalone.map((s) => renderSessionCard(s))}
      </div>

      {showCreate && (
        <CreateSessionDialog
          settings={settings}
          onUpdateSettings={onUpdateSettings}
          onCreated={(s) => { setShowCreate(false); onOpenChat(s.id) }}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  )
}

function CreateSessionDialog({ settings, onUpdateSettings, onCreated, onClose }: {
  settings: Settings
  onUpdateSettings: (s: Settings) => void
  onCreated: (s: Session) => void
  onClose: () => void
}) {
  const [workDir, setWorkDir] = useState(settings.defaultWorkingDirectory)
  const [model, setModel] = useState(settings.defaultModel)
  const [backend, setBackend] = useState<Backend>(settings.defaultBackend)
  const [skipPerms, setSkipPerms] = useState(false)
  const [flags, setFlags] = useState('')
  const [persistentPrompt, setPersistentPrompt] = useState('')
  const [cooldownSec, setCooldownSec] = useState('900')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (workDir === settings.defaultWorkingDirectory) return
    onUpdateSettings({ ...settings, defaultWorkingDirectory: workDir })
  }, [workDir, onUpdateSettings, settings])

  const handleCreate = async () => {
    setCreating(true)
    setError('')
    try {
      const session = await api.createSession(settings, {
        working_directory: workDir || undefined,
        model: model || undefined,
        dangerously_skip_permissions: skipPerms,
        additional_flags: flags ? flags.split(/\s+/).filter(Boolean) : undefined,
        backend,
        persistent_prompt: persistentPrompt.trim() || undefined,
        cooldown_timeout_sec: persistentPrompt.trim()
          ? Math.max(1, parseInt(cooldownSec || '900', 10) || 900)
          : undefined,
      })
      onCreated(session)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
      setCreating(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New Session</h2>
        <div className="field">
          <label>Backend</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className={backend === 'codex' ? 'primary' : ''}
              onClick={() => { setBackend('codex'); if (!model || model === 'claude-opus-4-6' || model === 'claude-sonnet-4-6') setModel('gpt-5.3-codex'); }}
              style={{ flex: 1, padding: '6px 12px', fontSize: 13 }}
            >
              Codex
            </button>
            <button
              className={backend === 'claude' ? 'primary' : ''}
              onClick={() => { setBackend('claude'); if (!model || model === 'gpt-5.3-codex') setModel(''); }}
              style={{ flex: 1, padding: '6px 12px', fontSize: 13 }}
            >
              Claude
            </button>
          </div>
        </div>
        <div className="field">
          <label>Working Directory</label>
          <input value={workDir} onChange={(e) => setWorkDir(e.target.value)} placeholder="/path/to/project" />
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
            Auto-saved and shared for Codex and Claude.
          </div>
        </div>
        <div className="field">
          <label>Model</label>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={backend === 'codex' ? 'gpt-5.3-codex' : 'claude-opus-4-6'} />
        </div>
        <div className="field">
          <label>Extra Flags</label>
          <input value={flags} onChange={(e) => setFlags(e.target.value)} placeholder="--flag1 --flag2" />
        </div>
        <div className="field">
          <label>Persistent Prompt (optional)</label>
          <textarea
            value={persistentPrompt}
            onChange={(e) => setPersistentPrompt(e.target.value)}
            placeholder="If set, this session will auto-run this prompt repeatedly. Manual user messages are disabled."
            rows={4}
            style={{ width: '100%', resize: 'vertical' }}
          />
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
            Session will run immediately once ready, then restart after cooldown whenever it returns to ready.
          </div>
        </div>
        <div className="field">
          <label>Cooldown Seconds</label>
          <input
            value={cooldownSec}
            onChange={(e) => setCooldownSec(e.target.value.replace(/[^\d]/g, ''))}
            placeholder="900"
            disabled={!persistentPrompt.trim()}
          />
        </div>
        {backend === 'claude' && (
          <div className="field">
            <div className="checkbox-row">
              <input type="checkbox" checked={skipPerms} onChange={(e) => setSkipPerms(e.target.checked)} id="skip-perms" />
              <label htmlFor="skip-perms" style={{ color: 'var(--text)' }}>Skip permissions</label>
            </div>
          </div>
        )}
        {error && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 8 }}>{error}</div>}
        <div className="actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={handleCreate} disabled={creating}>
            {creating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
