import { useState } from 'react'
import type { Settings, Backend, Theme } from '../lib/types'

interface Props {
  settings: Settings
  onSave: (s: Settings) => void
  onBack: () => void
}

export default function SettingsPage({ settings, onSave, onBack }: Props) {
  const [apiUrl, setApiUrl] = useState(settings.apiUrl)
  const [authToken, setAuthToken] = useState(settings.authToken)
  const [defaultModel, setDefaultModel] = useState(settings.defaultModel)
  const [defaultWorkingDirectory, setDefaultWorkingDirectory] = useState(settings.defaultWorkingDirectory)
  const [defaultBackend, setDefaultBackend] = useState<Backend>(settings.defaultBackend)
  const [theme, setTheme] = useState<Theme>(settings.theme)

  const handleSave = () => {
    onSave({ apiUrl, authToken, defaultModel, defaultWorkingDirectory, defaultBackend, theme })
  }

  return (
    <div className="settings-page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={onBack}>Back</button>
        <h2 style={{ margin: 0 }}>Settings</h2>
      </div>

      <div className="field">
        <label>API URL</label>
        <input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="http://127.0.0.1:8080" />
      </div>
      <div className="field">
        <label>Auth Token</label>
        <input type="password" value={authToken} onChange={(e) => setAuthToken(e.target.value)} placeholder="Leave empty if auth disabled" />
      </div>
      <div className="field">
        <label>Default Backend</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={defaultBackend === 'codex' ? 'primary' : ''}
            onClick={() => setDefaultBackend('codex')}
            style={{ flex: 1, padding: '6px 12px', fontSize: 13 }}
          >
            Codex
          </button>
          <button
            className={defaultBackend === 'claude' ? 'primary' : ''}
            onClick={() => setDefaultBackend('claude')}
            style={{ flex: 1, padding: '6px 12px', fontSize: 13 }}
          >
            Claude
          </button>
        </div>
      </div>
      <div className="field">
        <label>Default Model</label>
        <input value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} placeholder={defaultBackend === 'codex' ? 'gpt-5.3-codex' : 'claude-opus-4-6'} />
      </div>
      <div className="field">
        <label>Default Working Directory</label>
        <input value={defaultWorkingDirectory} onChange={(e) => setDefaultWorkingDirectory(e.target.value)} placeholder="/path/to/project" />
      </div>
      <div className="field">
        <label>Theme</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={theme === 'dark' ? 'primary' : ''}
            onClick={() => setTheme('dark')}
            style={{ flex: 1, padding: '6px 12px', fontSize: 13 }}
          >
            Dark
          </button>
          <button
            className={theme === 'light' ? 'primary' : ''}
            onClick={() => setTheme('light')}
            style={{ flex: 1, padding: '6px 12px', fontSize: 13 }}
          >
            Light
          </button>
        </div>
      </div>

      <div className="actions">
        <button onClick={onBack}>Cancel</button>
        <button className="primary" onClick={handleSave}>Save</button>
      </div>
    </div>
  )
}
