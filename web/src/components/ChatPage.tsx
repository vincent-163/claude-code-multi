import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import type { Settings, ChatMessage, SessionStatus, ContentBlock, Backend } from '../lib/types'
import * as api from '../lib/api'
import { connectSse } from '../lib/sse'
import { parseEvents } from '../lib/parse'
import AnsiText from './AnsiText'

/** Append a tool_result content block to the assistant message that contains the matching tool_use. */
function pairToolResult(msgs: ChatMessage[], toolUseId: string, content: string, isError: boolean): ChatMessage[] {
  const result: ContentBlock = { type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }
  let idx = -1
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m.kind === 'assistant' && m.content.some((b: ContentBlock) => b.type === 'tool_use' && b.id === toolUseId)) {
      idx = i
      break
    }
  }
  if (idx < 0) return msgs
  const updated = [...msgs]
  const assistant = updated[idx] as ChatMessage & { kind: 'assistant' }
  updated[idx] = { ...assistant, content: [...assistant.content, result] }
  return updated
}

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
  const [answeredQuestions, setAnsweredQuestions] = useState<Set<string>>(new Set())
  const [resolvedPlanExits, setResolvedPlanExits] = useState<Set<string>>(new Set())
  const [title, setTitle] = useState<string | undefined>(undefined)
  const [sessionBackend, setSessionBackend] = useState<Backend | undefined>(undefined)
  const [persistentPrompt, setPersistentPrompt] = useState<string | undefined>(undefined)
  const [persistentCooldownSec, setPersistentCooldownSec] = useState<number>(900)
  const [persistentNextRunAt, setPersistentNextRunAt] = useState<number | undefined>(undefined)
  const [editingTitle, setEditingTitle] = useState(false)
  const [editTitleValue, setEditTitleValue] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const lastEventIdRef = useRef(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isNearBottomRef = useRef(true)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current
    if (!el) return
    const threshold = 80
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold
  }, [])

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus()
      titleInputRef.current.select()
    }
  }, [editingTitle])

  const startEditingTitle = () => {
    setEditTitleValue(title || '')
    setEditingTitle(true)
  }

  const commitTitle = async () => {
    const trimmed = editTitleValue.trim()
    setEditingTitle(false)
    if (!sessionId) return
    try {
      await api.updateSessionTitle(settings, sessionId, trimmed)
      setTitle(trimmed || undefined)
    } catch { /* ignore */ }
  }

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitTitle()
    else if (e.key === 'Escape') setEditingTitle(false)
  }

  // Load history + connect SSE
  useEffect(() => {
    if (!sessionId) return

    setPersistentPrompt(undefined)
    setPersistentCooldownSec(900)
    setPersistentNextRunAt(undefined)

    let sseCleanup: (() => void) | undefined

      ; (async () => {
        try {
          const data = await api.getSession(settings, sessionId, 1000)
          setStatus(data.status)
          if (data.title) setTitle(data.title)
          if (data.backend) setSessionBackend(data.backend as Backend)
          setPersistentPrompt(data.persistent_prompt)
          setPersistentCooldownSec(data.persistent_cooldown_sec ?? 900)
          setPersistentNextRunAt(data.persistent_next_run_at)
          if (data.total_cost_usd) setCost(data.total_cost_usd)

          // Parse history
          const historyMsgs: ChatMessage[] = []
          const historyResolved = new Map<string, boolean>()
          const historyAnswered = new Set<string>()
          const historyPlanExits = new Set<string>()
          for (const evt of data.history) {
            if (evt.id > lastEventIdRef.current) lastEventIdRef.current = evt.id

            // Handle title_changed in history
            if (evt.event === 'title_changed') {
              const d = evt.data as Record<string, unknown>
              if (typeof d.title === 'string') setTitle(d.title)
              continue
            }

            const msgs = parseEvents(evt)
            for (const msg of msgs) {
              if (msg.kind === 'status') {
                setStatus(msg.status as SessionStatus)
              } else if (msg.kind === 'result' && msg.total_cost_usd) {
                setCost(msg.total_cost_usd)
              } else if (msg.kind === 'control_response') {
                historyResolved.set(msg.request_id, msg.approved)
              } else if (msg.kind === 'tool_result_event') {
                // Check if this is an AskUserQuestion response
                const matchingAuq = historyMsgs.find(
                  (m) => m.kind === 'ask_user_question' && m.tool_use_id === msg.tool_use_id
                )
                if (matchingAuq) {
                  historyAnswered.add(msg.tool_use_id)
                }
                // Check if this is a plan_mode_exit response
                const matchingPlanExit = historyMsgs.find(
                  (m) => m.kind === 'plan_mode_exit' && m.tool_use_id === msg.tool_use_id
                )
                if (matchingPlanExit) {
                  historyPlanExits.add(msg.tool_use_id)
                }
                historyMsgs.splice(0, historyMsgs.length, ...pairToolResult(historyMsgs, msg.tool_use_id, msg.content, msg.is_error))
              } else {
                historyMsgs.push(msg)
              }
            }
          }
          setResolvedRequests(historyResolved)
          setAnsweredQuestions(historyAnswered)
          setResolvedPlanExits(historyPlanExits)
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

            // Handle title_changed event from MCP tool
            if (evt.event === 'title_changed') {
              const d = evt.data as Record<string, unknown>
              if (typeof d.title === 'string') setTitle(d.title)
              return
            }
            if (evt.event === 'session_reset') {
              setMessages([])
              setCost(0)
              setResolvedRequests(new Map())
              setPendingResponses(new Set())
              setAnsweredQuestions(new Set())
              setResolvedPlanExits(new Set())
              return
            }

            const msgs = parseEvents(evt)
            for (const msg of msgs) {
              if (!msg) continue
              if (msg.kind === 'status') {
                setStatus(msg.status as SessionStatus)
                continue
              }
              if (msg.kind === 'result' && msg.total_cost_usd) {
                setCost(msg.total_cost_usd)
              }
              if (msg.kind === 'control_response') {
                setResolvedRequests((prev) => new Map(prev).set(msg.request_id, msg.approved))
                setPendingResponses((prev) => { const next = new Set(prev); next.delete(msg.request_id); return next })
                continue
              }
              // Skip server-echoed user text messages during live SSE (we already added them locally on send)
              if (msg.kind === 'user') continue
              // For tool_result_event, check if it's an AskUserQuestion or plan_mode_exit response
              if (msg.kind === 'tool_result_event') {
                setAnsweredQuestions((prev) => {
                  const next = new Set(prev)
                  next.add(msg.tool_use_id)
                  return next
                })
                setResolvedPlanExits((prev) => {
                  const next = new Set(prev)
                  next.add(msg.tool_use_id)
                  return next
                })
              }
              // For assistant messages: replace last if streaming, else append
              setMessages((prev) => {
                if (msg.kind === 'tool_result_event') {
                  return pairToolResult(prev, msg.tool_use_id, msg.content, msg.is_error)
                }
                if (msg.kind === 'assistant') {
                  const last = prev[prev.length - 1]
                  if (last?.kind === 'assistant' && last.streaming) {
                    return [...prev.slice(0, -1), msg]
                  }
                }
                return [...prev, msg]
              })
            }
          },
          (err) => {
            setSseError(err instanceof Error ? err.message : 'SSE connection lost')
          },
        )
      })()

    return () => { sseCleanup?.() }
  }, [sessionId, settings])

  // Auto-scroll on new messages only when user is near the bottom
  useEffect(() => {
    if (isNearBottomRef.current) scrollToBottom()
  }, [messages, scrollToBottom])

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
    // Find the original control_request to get the input for updatedInput
    const controlMsg = messages.find(
      (m) => m.kind === 'control_request' && m.request_id === requestId
    ) as (ChatMessage & { kind: 'control_request' }) | undefined
    setPendingResponses((prev) => new Set(prev).add(requestId))
    try {
      await api.sendInput(settings, sessionId, {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: requestId,
          response: {
            behavior: 'allow',
            updatedInput: controlMsg?.input || {},
          },
        },
      })
      // Optimistically mark as resolved since CLI may not echo back a confirmation
      setPendingResponses((prev) => { const next = new Set(prev); next.delete(requestId); return next })
      setResolvedRequests((prev) => new Map(prev).set(requestId, true))
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
        response: {
          subtype: 'success',
          request_id: requestId,
          response: {
            behavior: 'deny',
            message: 'User denied permission',
          },
        },
      })
      // Optimistically mark as resolved
      setPendingResponses((prev) => { const next = new Set(prev); next.delete(requestId); return next })
      setResolvedRequests((prev) => new Map(prev).set(requestId, false))
    } catch {
      setPendingResponses((prev) => { const next = new Set(prev); next.delete(requestId); return next })
    }
  }

  const answerQuestion = async (toolUseId: string, answers: Record<string, string>) => {
    if (!sessionId) return
    setAnsweredQuestions((prev) => new Set(prev).add(toolUseId))
    try {
      await api.sendInput(settings, sessionId, {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: JSON.stringify({ answers }),
      })
    } catch (err) {
      setAnsweredQuestions((prev) => { const next = new Set(prev); next.delete(toolUseId); return next })
      setMessages((prev) => [...prev, { kind: 'error', message: err instanceof Error ? err.message : 'Failed to send answer' }])
    }
  }

  const approvePlanExit = async (toolUseId: string) => {
    if (!sessionId) return
    setResolvedPlanExits((prev) => new Set(prev).add(toolUseId))
    try {
      await api.sendInput(settings, sessionId, {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: JSON.stringify({}),
      })
    } catch (err) {
      setResolvedPlanExits((prev) => { const next = new Set(prev); next.delete(toolUseId); return next })
      setMessages((prev) => [...prev, { kind: 'error', message: err instanceof Error ? err.message : 'Failed to approve plan exit' }])
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const isBusy = status === 'busy' || status === 'starting'
  const isPersistent = !!persistentPrompt
  const statusBadgeStyle: React.CSSProperties = {
    background: status === 'ready' ? 'var(--green)' : status === 'busy' || status === 'starting' ? 'var(--orange)' : status === 'waiting_for_input' ? 'var(--blue)' : 'var(--red)',
    color: '#000',
  }

  return (
    <div className="chat-page">
      <div className="chat-header">
        <button className="back" onClick={onBack}>&larr;</button>
        <div className="session-info">
          {editingTitle ? (
            <input
              ref={titleInputRef}
              className="title-edit"
              value={editTitleValue}
              onChange={(e) => setEditTitleValue(e.target.value)}
              onKeyDown={handleTitleKeyDown}
              onBlur={commitTitle}
            />
          ) : (
            <div className="title" onClick={startEditingTitle} style={{ cursor: 'pointer' }} title="Click to rename">
              {title || sessionId}
            </div>
          )}
          <div className="subtitle">{cost > 0 ? `$${cost.toFixed(4)}` : ''}</div>
          {isPersistent && (
            <div className="subtitle">
              persistent · cooldown {persistentCooldownSec}s
              {persistentNextRunAt ? ` · next ${Math.max(0, Math.ceil(persistentNextRunAt - Date.now() / 1000))}s` : ''}
            </div>
          )}
        </div>
        {sessionBackend && <span className="status-badge" style={{ background: sessionBackend === 'codex' ? 'var(--blue)' : 'var(--green)', color: '#000', marginRight: 4 }}>{sessionBackend === 'codex' ? 'Codex' : 'Claude'}</span>}
        <span className="status-badge" style={statusBadgeStyle}>{status}</span>
        {isBusy && <button className="danger" onClick={sendInterrupt} style={{ padding: '4px 10px', fontSize: 12 }}>Interrupt</button>}
      </div>

      {sseError && <div style={{ padding: '6px 16px', color: 'var(--red)', fontSize: 12 }}>{sseError}</div>}

      <div className="messages" ref={messagesContainerRef} onScroll={handleMessagesScroll}>
        {messages.map((msg, i) => (
          <MessageView key={i} msg={msg} onApprove={approveRequest} onDeny={denyRequest} onAnswer={answerQuestion} onApprovePlanExit={approvePlanExit} pendingResponses={pendingResponses} resolvedRequests={resolvedRequests} answeredQuestions={answeredQuestions} resolvedPlanExits={resolvedPlanExits} />
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

function MessageView({ msg, onApprove, onDeny, onAnswer, onApprovePlanExit, pendingResponses, resolvedRequests, answeredQuestions, resolvedPlanExits }: {
  msg: ChatMessage
  onApprove: (id: string) => void
  onDeny: (id: string) => void
  onAnswer: (toolUseId: string, answers: Record<string, string>) => void
  onApprovePlanExit: (toolUseId: string) => void
  pendingResponses: Set<string>
  resolvedRequests: Map<string, boolean>
  answeredQuestions: Set<string>
  resolvedPlanExits: Set<string>
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

    case 'ask_user_question':
      return <AskUserQuestionView msg={msg} onAnswer={onAnswer} isAnswered={answeredQuestions.has(msg.tool_use_id)} />

    case 'plan_mode_exit': {
      const resolved = resolvedPlanExits.has(msg.tool_use_id)
      return (
        <div className="message">
          <div className={`control-request${resolved ? ' resolved' : ''}`}>
            <div className="cr-header">Exit Plan Mode</div>
            <div style={{ fontSize: 13, margin: '6px 0' }}>Claude wants to exit plan mode and begin implementation.</div>
            <div className="cr-actions">
              {resolved ? (
                <span className="cr-status allowed">Approved</span>
              ) : (
                <button className="approve" onClick={() => onApprovePlanExit(msg.tool_use_id)}>Approve</button>
              )}
            </div>
          </div>
        </div>
      )
    }

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
      return <ToolUseBlock block={block} />
    case 'tool_result':
      return <ToolResultBlock block={block} />
    default:
      return null
  }
}

function isLongContent(text: string): boolean {
  return text.length > 200 || text.split('\n').length > 5
}

function ToolUseBlock({ block }: { block: import('../lib/types').ContentBlock & { type: 'tool_use' } }) {
  const inputText = formatInput(block.input)
  const isLong = isLongContent(inputText)
  const [expanded, setExpanded] = useState(!isLong)

  return (
    <div className="tool-use-block">
      <div
        className={`tool-use-header${isLong ? ' clickable' : ''}`}
        onClick={() => isLong && setExpanded(!expanded)}
      >
        <span className="tool-name">{block.name}</span>
        {isLong && <span className="chevron">{expanded ? '\u25B2' : '\u25BC'}</span>}
      </div>
      <div className={`tool-input${!expanded ? ' collapsed' : ''}`}>
        {inputText}
      </div>
    </div>
  )
}

function ToolResultBlock({ block }: { block: import('../lib/types').ContentBlock & { type: 'tool_result' } }) {
  const isLong = isLongContent(block.content)
  const [expanded, setExpanded] = useState(!isLong)

  return (
    <div
      className={`tool-result-block${block.is_error ? ' error' : ''}${isLong ? ' clickable' : ''}`}
      onClick={() => isLong && setExpanded(!expanded)}
    >
      <div className="tool-result-header">
        <span className={block.is_error ? 'result-error' : 'result-ok'}>
          {block.is_error ? '\u2717 Error' : '\u2713 Result'}
        </span>
        {isLong && <span className="chevron">{expanded ? '\u25B2' : '\u25BC'}</span>}
      </div>
      <div className={`tool-result-content${!expanded ? ' collapsed' : ''}`}>
        <AnsiText text={block.content} />
      </div>
      {!expanded && isLong && (
        <div className="expand-hint">Click to show more...</div>
      )}
    </div>
  )
}

function AskUserQuestionView({ msg, onAnswer, isAnswered }: {
  msg: ChatMessage & { kind: 'ask_user_question' }
  onAnswer: (toolUseId: string, answers: Record<string, string>) => void
  isAnswered: boolean
}) {
  const [selections, setSelections] = useState<Record<string, string | string[]>>({})
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(isAnswered)

  const handleSelect = (qIdx: number, label: string, multiSelect: boolean) => {
    setSelections((prev) => {
      const key = String(qIdx)
      if (multiSelect) {
        const current = (prev[key] as string[]) || []
        if (current.includes(label)) {
          return { ...prev, [key]: current.filter((l) => l !== label) }
        }
        return { ...prev, [key]: [...current, label] }
      }
      // For single-select, if selecting "Other", keep the value as-is (will use custom input)
      return { ...prev, [key]: label }
    })
  }

  const handleSubmit = () => {
    const answers: Record<string, string> = {}
    for (let i = 0; i < msg.questions.length; i++) {
      const key = String(i)
      const sel = selections[key]
      if (sel === '__other__') {
        answers[key] = customInputs[key] || ''
      } else if (Array.isArray(sel)) {
        const resolved = sel.map((s) => s === '__other__' ? (customInputs[key] || '') : s)
        answers[key] = resolved.join(', ')
      } else {
        answers[key] = (sel as string) || ''
      }
    }
    setSubmitted(true)
    onAnswer(msg.tool_use_id, answers)
  }

  const allAnswered = msg.questions.every((_, i) => {
    const sel = selections[String(i)]
    if (!sel) return false
    if (Array.isArray(sel)) return sel.length > 0
    return true
  })

  return (
    <div className="message">
      <div className={`ask-user-question${submitted ? ' resolved' : ''}`}>
        <div className="auq-header">Question</div>
        {msg.questions.map((q, qi) => (
          <div key={qi} className="auq-question">
            <div className="auq-question-text">
              {q.header && <span className="auq-tag">{q.header}</span>}
              {q.question}
            </div>
            <div className="auq-options">
              {q.options.map((opt, oi) => {
                const key = String(qi)
                const sel = selections[key]
                const isSelected = Array.isArray(sel) ? sel.includes(opt.label) : sel === opt.label
                return (
                  <button
                    key={oi}
                    className={`auq-option${isSelected ? ' selected' : ''}`}
                    onClick={() => !submitted && handleSelect(qi, opt.label, q.multiSelect)}
                    disabled={submitted}
                  >
                    <div className="auq-option-label">{opt.label}</div>
                    {opt.description && <div className="auq-option-desc">{opt.description}</div>}
                  </button>
                )
              })}
              <button
                className={`auq-option${(Array.isArray(selections[String(qi)]) ? (selections[String(qi)] as string[]).includes('__other__') : selections[String(qi)] === '__other__') ? ' selected' : ''}`}
                onClick={() => !submitted && handleSelect(qi, '__other__', q.multiSelect)}
                disabled={submitted}
              >
                <div className="auq-option-label">Other</div>
              </button>
              {(Array.isArray(selections[String(qi)]) ? (selections[String(qi)] as string[]).includes('__other__') : selections[String(qi)] === '__other__') && (
                <input
                  type="text"
                  className="auq-custom-input"
                  placeholder="Type your answer..."
                  value={customInputs[String(qi)] || ''}
                  onChange={(e) => setCustomInputs((prev) => ({ ...prev, [String(qi)]: e.target.value }))}
                  disabled={submitted}
                />
              )}
            </div>
          </div>
        ))}
        <div className="auq-actions">
          {submitted ? (
            <span className="auq-status answered">Answered</span>
          ) : (
            <button className="approve" onClick={handleSubmit} disabled={!allAnswered}>Submit</button>
          )}
        </div>
      </div>
    </div>
  )
}

function formatInput(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}
