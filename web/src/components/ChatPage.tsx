import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import type { Settings, ChatMessage, SessionStatus } from '../lib/types'
import * as api from '../lib/api'
import { connectSse } from '../lib/sse'
import { parseEvent } from '../lib/parse'
import AnsiText from './AnsiText'

interface Props {
  settings: Settings
  onBack: () => void
}

export default function ChatPage({ settings, onBack }: Props) {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [status, setStatus] = useState<SessionStatus>('starting')
  const [input, setInput] = useState('')
  const [cost, setCost] = useState(0)
  const [sseError, setSseError] = useState('')
  const [pendingResponses, setPendingResponses] = useState<Set<string>>(new Set())
  const [resolvedRequests, setResolvedRequests] = useState<Map<string, boolean>>(new Map())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const lastEventIdRef = useRef(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  // Load history + connect SSE
  useEffect(() => {
    if (!sessionId) return

    let sseCleanup: (() => void) | undefined

    ;(async () => {
      try {
        const data = await api.getSession(settings, sessionId, 1000)
        setStatus(data.status)
        if (data.total_cost_usd) setCost(data.total_cost_usd)

        // Parse history
        const historyMsgs: ChatMessage[] = []
        const historyResolved = new Map<string, boolean>()
        for (const evt of data.history) {
          if (evt.id > lastEventIdRef.current) lastEventIdRef.current = evt.id
          const msg = parseEvent(evt)
          if (msg) {
            if (msg.kind === 'status') {
              setStatus(msg.status as SessionStatus)
            } else if (msg.kind === 'result' && msg.total_cost_usd) {
              setCost(msg.total_cost_usd)
            } else if (msg.kind === 'control_response') {
              historyResolved.set(msg.request_id, msg.approved)
            } else {
              historyMsgs.push(msg)
            }
          }
        }
        setResolvedRequests(historyResolved)
        setMessages(historyMsgs)
      } catch {
        setSseError('Failed to load session')
      }

      // Connect SSE
      sseCleanup = connectSse(
        settings,
        sessionId,
        lastEventIdRef.current,
        (evt) => {
          lastEventIdRef.current = evt.id
          const msg = parseEvent(evt)
          if (!msg) return
          if (msg.kind === 'status') {
            setStatus(msg.status as SessionStatus)
            return
          }
          if (msg.kind === 'result' && msg.total_cost_usd) {
            setCost(msg.total_cost_usd)
          }
          if (msg.kind === 'control_response') {
            setResolvedRequests((prev) => new Map(prev).set(msg.request_id, msg.approved))
            setPendingResponses((prev) => { const next = new Set(prev); next.delete(msg.request_id); return next })
            return
          }
          // For assistant messages: replace last if streaming, else append
          setMessages((prev) => {
            if (msg.kind === 'assistant') {
              const last = prev[prev.length - 1]
              if (last?.kind === 'assistant' && last.streaming) {
                return [...prev.slice(0, -1), msg]
              }
            }
            return [...prev, msg]
          })
        },
        (err) => {
          setSseError(err instanceof Error ? err.message : 'SSE connection lost')
        },
      )
    })()

    return () => { sseCleanup?.() }
  }, [sessionId, settings])

  // Auto-scroll on new messages
  useEffect(() => { scrollToBottom() }, [messages, scrollToBottom])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || !sessionId) return
    setInput('')
    setMessages((prev) => [...prev, { kind: 'user', content: text }])
    try {
      await api.sendInput(settings, sessionId, { type: 'user_message', content: text })
    } catch (err) {
      setMessages((prev) => [...prev, { kind: 'error', message: err instanceof Error ? err.message : 'Send failed' }])
    }
  }

  const sendInterrupt = async () => {
    if (!sessionId) return
    try {
      await api.sendInput(settings, sessionId, { type: 'interrupt' })
    } catch { /* ignore */ }
  }

  const approveRequest = async (requestId: string) => {
    if (!sessionId) return
    setPendingResponses((prev) => new Set(prev).add(requestId))
    try {
      await api.sendInput(settings, sessionId, {
        type: 'control_response',
        request_id: requestId,
        response: { subtype: 'approve' },
      })
    } catch {
      setPendingResponses((prev) => { const next = new Set(prev); next.delete(requestId); return next })
    }
  }

  const denyRequest = async (requestId: string) => {
    if (!sessionId) return
    setPendingResponses((prev) => new Set(prev).add(requestId))
    try {
      await api.sendInput(settings, sessionId, {
        type: 'control_response',
        request_id: requestId,
        response: { subtype: 'deny' },
      })
    } catch {
      setPendingResponses((prev) => { const next = new Set(prev); next.delete(requestId); return next })
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const isBusy = status === 'busy' || status === 'starting'
  const statusBadgeStyle: React.CSSProperties = {
    background: status === 'ready' ? 'var(--green)' : status === 'busy' || status === 'starting' ? 'var(--orange)' : status === 'waiting_for_input' ? 'var(--blue)' : 'var(--red)',
    color: '#000',
  }

  return (
    <div className="chat-page">
      <div className="chat-header">
        <button className="back" onClick={onBack}>&larr;</button>
        <div className="session-info">
          <div className="title">{sessionId}</div>
          <div className="subtitle">{cost > 0 ? `$${cost.toFixed(4)}` : ''}</div>
        </div>
        <span className="status-badge" style={statusBadgeStyle}>{status}</span>
        {isBusy && <button className="danger" onClick={sendInterrupt} style={{ padding: '4px 10px', fontSize: 12 }}>Interrupt</button>}
      </div>

      {sseError && <div style={{ padding: '6px 16px', color: 'var(--red)', fontSize: 12 }}>{sseError}</div>}

      <div className="messages">
        {messages.map((msg, i) => (
          <MessageView key={i} msg={msg} onApprove={approveRequest} onDeny={denyRequest} pendingResponses={pendingResponses} resolvedRequests={resolvedRequests} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-bar">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={status === 'dead' ? 'Session ended' : 'Send a message...'}
          disabled={status === 'dead'}
          rows={1}
        />
        <div className="btn-group">
          <button className="primary" onClick={sendMessage} disabled={!input.trim() || status === 'dead'}>
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

function MessageView({ msg, onApprove, onDeny, pendingResponses, resolvedRequests }: {
  msg: ChatMessage
  onApprove: (id: string) => void
  onDeny: (id: string) => void
  pendingResponses: Set<string>
  resolvedRequests: Map<string, boolean>
}) {
  switch (msg.kind) {
    case 'user':
      return (
        <div className="message user-msg">
          <div className="bubble">{msg.content}</div>
        </div>
      )

    case 'assistant':
      return (
        <div className="message assistant-msg">
          <div className="content-blocks">
            {msg.content.map((block, i) => (
              <ContentBlockView key={i} block={block} />
            ))}
          </div>
        </div>
      )

    case 'result':
      return msg.content && msg.content.length > 0 ? (
        <div className="message assistant-msg">
          <div className="content-blocks">
            {msg.content.map((block, i) => (
              <ContentBlockView key={i} block={block} />
            ))}
          </div>
          {msg.cost_usd != null && (
            <div className="message result-msg">Cost: ${msg.cost_usd.toFixed(4)}</div>
          )}
        </div>
      ) : msg.cost_usd != null ? (
        <div className="message result-msg">Cost: ${msg.cost_usd.toFixed(4)}</div>
      ) : null

    case 'control_request': {
      const resolved = resolvedRequests.get(msg.request_id)
      const isPending = pendingResponses.has(msg.request_id)
      return (
        <div className="message">
          <div className={`control-request${resolved !== undefined ? ' resolved' : ''}`}>
            <div className="cr-header">Permission Required</div>
            <div className="cr-tool">{msg.tool_name}</div>
            <div className="cr-input">{formatInput(msg.input)}</div>
            {msg.blocked_path && (
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>
                Path: {msg.blocked_path}
              </div>
            )}
            <div className="cr-actions">
              {resolved === true ? (
                <span className="cr-status allowed">Allowed</span>
              ) : resolved === false ? (
                <span className="cr-status denied">Denied</span>
              ) : isPending ? (
                <span className="cr-status pending">Sending...</span>
              ) : (
                <>
                  <button className="approve" onClick={() => onApprove(msg.request_id)}>Allow</button>
                  <button className="danger" onClick={() => onDeny(msg.request_id)}>Deny</button>
                </>
              )}
            </div>
          </div>
        </div>
      )
    }

    case 'system':
      return (
        <div className="message system-msg">
          {msg.data.type === 'system' && msg.data.session_id
            ? `Session: ${String(msg.data.session_id)}`
            : String(msg.data.text ?? JSON.stringify(msg.data))}
        </div>
      )

    case 'status':
      return <div className="message status-msg">Status: {msg.status}</div>

    case 'error':
      return <div className="message error-msg">{msg.message}</div>

    case 'exit':
      return <div className="message exit-msg">Session exited (code: {msg.code ?? '?'})</div>

    default:
      return null
  }
}

function ContentBlockView({ block }: { block: import('../lib/types').ContentBlock }) {
  switch (block.type) {
    case 'text':
      return <div className="text-block"><AnsiText text={block.text} /></div>
    case 'tool_use':
      return (
        <div className="tool-use-block">
          <div className="tool-name">{block.name}</div>
          <div className="tool-input">{formatInput(block.input)}</div>
        </div>
      )
    case 'tool_result':
      return (
        <div className={`tool-result-block ${block.is_error ? 'error' : ''}`}>
          <AnsiText text={block.content} />
        </div>
      )
    default:
      return null
  }
}

function formatInput(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}
