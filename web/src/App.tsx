import { useState, useCallback } from 'react'
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom'
import type { Settings } from './lib/types'
import { loadSettings, saveSettings } from './lib/settings'
import SessionsPage from './components/SessionsPage'
import ChatPage from './components/ChatPage'
import SettingsPage from './components/SettingsPage'

function AppRoutes() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const navigate = useNavigate()

  const updateSettings = useCallback((s: Settings) => {
    saveSettings(s)
    setSettings(s)
  }, [])

  return (
    <div className="app">
      <Routes>
        <Route
          path="/"
          element={
            <SessionsPage
              settings={settings}
              onUpdateSettings={updateSettings}
              onOpenChat={(id) => navigate(`/chat/${id}`)}
              onOpenSettings={() => navigate('/settings')}
            />
          }
        />
        <Route
          path="/chat/:sessionId"
          element={
            <ChatPage
              settings={settings}
              onBack={() => navigate('/')}
            />
          }
        />
        <Route
          path="/settings"
          element={
            <SettingsPage
              settings={settings}
              onSave={(s) => { updateSettings(s); navigate('/'); }}
              onBack={() => navigate('/')}
            />
          }
        />
      </Routes>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
