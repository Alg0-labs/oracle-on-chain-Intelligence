import { useState, useRef, useEffect } from 'react'
import {
  createChatThread,
  fetchChatHistory,
  fetchChatHistoryByThread,
  fetchChatThreads,
  fetchCredits,
  renameChatThread,
  sendChat,
} from '../lib/api.js'
import { SendConfirmModal } from './SendConfirmModal.js'
import { useIsMobile } from '../lib/mobile.js'
import type { ChatMessage, WalletData, SendTxIntent } from '../types/index.js'

function cleanAssistantText(text: string): string {
  return text.replace(/\*\*/g, '').replace(/__+/g, '')
}

function renderInlineLinks(text: string) {
  const normalized = cleanAssistantText(text)
  const parts = normalized.split(/(https?:\/\/[^\s]+)/g)
  return parts.map((part, idx) => {
    if (/^https?:\/\/[^\s]+$/.test(part)) {
      return (
        <a key={`${part}-${idx}`} href={part} target="_blank" rel="noreferrer" style={msgLink}>
          {part}
        </a>
      )
    }
    return <span key={`txt-${idx}`}>{part}</span>
  })
}

function renderStructuredMessage(text: string) {
  const normalized = cleanAssistantText(text)
  const lines = normalized.split('\n').map(l => l.trim()).filter(l => l.length > 0)

  return lines.map((line, idx) => {
    const isHeader = line.endsWith(':') && !line.startsWith('•') && !line.startsWith('-')
    const isBullet = line.startsWith('•') || line.startsWith('-')
    const content = isBullet ? line.slice(1).trim() : line

    if (isHeader) {
      return (
        <div key={`h-${idx}`} style={sectionHeader}>
          {renderInlineLinks(line.slice(0, -1))}
        </div>
      )
    }
    if (isBullet) {
      return (
        <div key={`b-${idx}`} style={bulletRow}>
          <span style={bulletDot}>·</span>
          <span style={{ flex: 1 }}>{renderInlineLinks(content)}</span>
        </div>
      )
    }
    return (
      <div key={`p-${idx}`} style={paragraphRow}>
        {renderInlineLinks(line)}
      </div>
    )
  })
}

const PROMPTS = [
  'What is my net worth?',
  'Where is most of my money?',
  'Am I overexposed?',
  'What did I do recently?',
  'Analyze my risk profile',
  'Send 10 USDC to 0x...',
]

interface Props {
  wallet: WalletData
  address: string
  snapshotUpdatedAt?: string | null
  onWalletRefresh?: () => void
  canChat?: boolean
  anonymousMode?: boolean
}

export function ChatPanel({
  wallet,
  address,
  snapshotUpdatedAt,
  onWalletRefresh,
  canChat = true,
  anonymousMode = false,
}: Props) {
  const isMobile = useIsMobile()
  const [threads, setThreads] = useState<Array<{ id: string; title: string | null; updatedAt: string }>>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: '0', role: 'assistant', content: buildWelcome(wallet), timestamp: new Date() },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [pendingTx, setPendingTx] = useState<SendTxIntent | null>(null)
  const [remainingCredits, setRemainingCredits] = useState<number | null>(null)
  const [creditsTotal, setCreditsTotal] = useState<number | null>(null)
  const [creditsUsed, setCreditsUsed] = useState<number | null>(null)
  const [threadPanelOpen, setThreadPanelOpen] = useState(false)
  const [creditsPopoverOpen, setCreditsPopoverOpen] = useState(false)
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null)
  const [editingThreadTitle, setEditingThreadTitle] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    setMessages([{ id: '0', role: 'assistant', content: buildWelcome(wallet), timestamp: new Date() }])
    setRemainingCredits(null)
  }, [address])

  useEffect(() => {
    if (snapshotUpdatedAt == null) return
    setMessages(prev => {
      if (prev.length !== 1) return prev
      return [{ id: '0', role: 'assistant', content: buildWelcome(wallet), timestamp: new Date() }]
    })
  }, [snapshotUpdatedAt, wallet])

  useEffect(() => {
    if (!canChat || anonymousMode) return
    let cancelled = false

    Promise.all([fetchChatThreads(address), fetchChatHistory(address), fetchCredits(address)])
      .then(([threadList, history, creditSummary]) => {
        if (cancelled) return
        setThreads(threadList)
        setActiveThreadId(history.threadId ?? null)
        setRemainingCredits(
          typeof history.remainingCredits === 'number' ? history.remainingCredits : null
        )
        setCreditsTotal(creditSummary.creditsTotal)
        setCreditsUsed(creditSummary.creditsUsed)
        if (history.messages.length === 0) return
        setMessages(
          history.messages.map((message, index) => ({
            id: `h-${index}`,
            role: message.role,
            content: message.content,
            timestamp: new Date(message.createdAt),
          }))
        )
      })
      .catch((err: any) => {
        if (cancelled) return
        setMessages((prev) => [
          ...prev,
          {
            id: `hist-err-${Date.now()}`,
            role: 'assistant',
            content: `Unable to load previous chat history: ${err.message ?? 'Unknown error'}`,
            timestamp: new Date(),
          },
        ])
      })

    return () => {
      cancelled = true
    }
  }, [address, canChat, anonymousMode])

  const loadThread = async (threadId: string) => {
    const history = await fetchChatHistoryByThread(address, threadId)
    setActiveThreadId(history.threadId)
    setRemainingCredits(typeof history.remainingCredits === 'number' ? history.remainingCredits : null)
    setMessages(
      history.messages.map((message, index) => ({
        id: `h-${threadId}-${index}`,
        role: message.role,
        content: message.content,
        timestamp: new Date(message.createdAt),
      }))
    )
  }

  const startNewChat = async () => {
    if (anonymousMode) {
      setActiveThreadId(null)
      setMessages([{ id: '0', role: 'assistant', content: buildWelcome(wallet), timestamp: new Date() }])
      return
    }
    const thread = await createChatThread(address, 'New chat')
    setThreads((prev) => [thread, ...prev])
    setActiveThreadId(thread.id)
    setMessages([{ id: '0', role: 'assistant', content: buildWelcome(wallet), timestamp: new Date() }])
  }

  const beginRenameThread = (threadId: string, currentTitle: string | null) => {
    setEditingThreadId(threadId)
    setEditingThreadTitle(currentTitle ?? 'Untitled chat')
  }

  const saveRenameThread = async () => {
    if (!editingThreadId) return
    const nextTitle = editingThreadTitle.trim()
    if (!nextTitle) return
    await renameChatThread(address, editingThreadId, nextTitle)
    const refreshedThreads = await fetchChatThreads(address)
    setThreads(refreshedThreads)
    setEditingThreadId(null)
    setEditingThreadTitle('')
  }

  const send = async (text?: string) => {
    const q = (text ?? input).trim()
    if (!q || loading || !canChat) return
    setInput('')

    const userMsg: ChatMessage = {
      id: Date.now().toString(), role: 'user', content: q, timestamp: new Date(),
    }
    const updated = [...messages, userMsg]
    setMessages(updated)
    setLoading(true)

    try {
      const apiMessages = updated.map(m => ({ role: m.role, content: m.content }))
      const { reply, txIntent, remainingCredits: updatedCredits, threadId } = await sendChat(
        address,
        apiMessages,
        activeThreadId
      )
      if (threadId && !activeThreadId) {
        setActiveThreadId(threadId)
      }
      setMessages(prev => [
        ...prev,
        { id: Date.now().toString() + 'r', role: 'assistant', content: reply, timestamp: new Date() },
      ])
      if (typeof updatedCredits === 'number') {
        setRemainingCredits(updatedCredits)
        if (creditsTotal != null) {
          setCreditsUsed(Math.max(0, creditsTotal - updatedCredits))
        }
      }
      if (txIntent) setPendingTx(txIntent)

      if (!anonymousMode) {
        const refreshedThreads = await fetchChatThreads(address)
        setThreads(refreshedThreads)
      }
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        { id: 'err', role: 'assistant', content: `Error: ${err.message ?? 'Backend unreachable'}`, timestamp: new Date() },
      ])
      if (typeof err?.remainingCredits === 'number') {
        setRemainingCredits(err.remainingCredits)
      }
    }
    setLoading(false)
  }

  return (
    <div style={pane}>
      {/* Page header */}
      <header style={{ height: 52, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', flexShrink: 0, background: 'var(--bg)', transition: 'background 0.2s ease' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'relative' }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.02em', margin: 0 }}>AI Assistant</h1>
          <span
            style={infoIcon}
            onMouseEnter={() => setCreditsPopoverOpen(true)}
            onMouseLeave={() => setCreditsPopoverOpen(false)}
            onClick={() => setCreditsPopoverOpen((v) => !v)}
          >
            i
          </span>
          {creditsPopoverOpen && (
            <div
              style={creditsPopover}
              onMouseEnter={() => setCreditsPopoverOpen(true)}
              onMouseLeave={() => setCreditsPopoverOpen(false)}
            >
              <div style={creditsHeading}>Your credit usage</div>
              {anonymousMode ? (
                <div style={creditsLine}>Anonymous mode: session-only chat, no saved credits.</div>
              ) : remainingCredits == null || creditsUsed == null || creditsTotal == null ? (
                <div style={creditsLine}>Loading credits...</div>
              ) : (
                <>
                  <div style={creditsLine}>Total: {creditsTotal}</div>
                  <div style={creditsLine}>Used: {creditsUsed}</div>
                  <div style={creditsLine}>Remaining: {remainingCredits}</div>
                </>
              )}
            </div>
          )}
        </div>
        <span />
      </header>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {!anonymousMode && (
          <aside
            style={{ ...threadPanel, ...(threadPanelOpen ? threadPanelExpanded : threadPanelCollapsed) }}
            onMouseEnter={() => setThreadPanelOpen(true)}
            onMouseLeave={() => setThreadPanelOpen(false)}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 24 }}>
              {threadPanelOpen && <span style={threadPanelTitle}>Chats</span>}
            </div>
            <button style={newChatBtn} onClick={startNewChat} title="New chat">+</button>
            <div style={threadList}>
              {threads.map((thread) => (
                <div key={thread.id} style={threadRow}>
                  {editingThreadId === thread.id && threadPanelOpen ? (
                    <input
                      value={editingThreadTitle}
                      onChange={(event) => setEditingThreadTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void saveRenameThread()
                        if (event.key === 'Escape') {
                          setEditingThreadId(null)
                          setEditingThreadTitle('')
                        }
                      }}
                      style={threadEditInput}
                      autoFocus
                    />
                  ) : (
                    <button
                      style={{
                        ...threadItem,
                        ...(activeThreadId === thread.id ? threadItemActive : {}),
                      }}
                      onClick={() => loadThread(thread.id)}
                      title={thread.title ?? 'Untitled chat'}
                    >
                      {threadPanelOpen ? (thread.title ?? 'Untitled chat') : '•'}
                    </button>
                  )}
                  {threadPanelOpen && (
                    editingThreadId === thread.id ? (
                      <button style={renameBtn} onClick={() => void saveRenameThread()} title="Save">✓</button>
                    ) : (
                      <button style={renameBtn} onClick={() => beginRenameThread(thread.id, thread.title)} title="Rename">✎</button>
                    )
                  )}
                </div>
              ))}
            </div>
          </aside>
        )}

      {/* Messages */}
      <div style={{ ...msgArea, padding: isMobile ? '16px 14px 8px' : '24px 24px 8px' }}>
        {messages.map(m => (
          <div key={m.id} style={{
            display: 'flex', flexDirection: 'column',
            alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
            marginBottom: 20, animation: 'fadeIn 0.2s ease',
          }}>
            <div style={m.role === 'user' ? userBubble : aiBubble}>
              {m.role === 'assistant' && (
                <span style={aiLabel}>ØRACLE</span>
              )}
              <div style={msgText}>
                {m.role === 'assistant'
                  ? renderStructuredMessage(m.content)
                  : renderInlineLinks(m.content)
                }
              </div>
            </div>
            <span style={ts}>
              {m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0 10px 4px' }}>
            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              {[0, 1, 2].map(i => (
                <span key={i} style={{ ...dot, animationDelay: `${i * 0.18}s` }} />
              ))}
            </div>
            <span style={{ color: 'var(--c-text-6)', fontSize: 11, fontFamily: 'var(--font-data)' }}>
              analyzing chain data…
            </span>
          </div>
        )}
        <div ref={bottomRef} />
      </div></div>

      {/* Suggested prompts (shown initially) */}
      {messages.length <= 1 && (
        <div style={{ ...promptsRow, padding: isMobile ? '8px 14px 4px' : '10px 24px 6px' }}>
          {PROMPTS.map(p => (
            <button key={p} style={chip} onClick={() => send(p)}>{p}</button>
          ))}
        </div>
      )}

      {/* Input bar */}
      <div style={{ ...inputRow, padding: isMobile ? '10px 12px' : '14px 20px' }}>
        <input
          style={inputStyle}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="Ask anything, or 'send 0.5 ETH / 50 USDC to 0x...'"
          disabled={loading}
        />
        <button
          style={{ ...sendBtn, opacity: loading || !input.trim() ? 0.35 : 1 }}
          onClick={() => send()}
          disabled={loading || !input.trim() || !canChat}
        >
          ↑
        </button>
      </div>
      {!canChat && (
        <div style={chatDisabledNotice}>
          Connect your wallet to use the AI assistant. In anonymous mode you can explore portfolio, market, and transactions only.
        </div>
      )}

      {/* Send confirmation modal */}
      {pendingTx && (
        <SendConfirmModal
          intent={pendingTx}
          onClose={() => setPendingTx(null)}
          onSuccess={hash => {
            setPendingTx(null)
            onWalletRefresh?.()
            setMessages(prev => [
              ...prev,
              {
                id: Date.now().toString() + 'tx',
                role: 'assistant',
                content: `Transaction submitted.\nHash: ${hash}`,
                timestamp: new Date(),
              },
            ])
          }}
        />
      )}
    </div>
  )
}

function buildWelcome(w: WalletData): string {
  const topToken = w.tokens.length > 0
    ? `Top token: ${w.tokens[0].symbol} (${w.tokens[0].chain}) — $${w.tokens[0].usdValue.toLocaleString()}`
    : 'No ERC-20 tokens found.'
  const chainCount = (w.chainBreakdown ?? []).length
  return `Wallet indexed${w.ensName ? ` · ${w.ensName}` : ''}.

Net Worth:  $${w.netWorthUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })} across ${chainCount} chain${chainCount !== 1 ? 's' : ''}
Native:     ${w.ethBalance} ETH ($${w.ethBalanceUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })})
${topToken}
Risk Level: ${w.riskLevel} — ${w.riskReason}

Ask me anything about your wallet. To send tokens:
"send 0.1 ETH to 0x..."     — native transfer
"send 50 USDC to 0x..."     — ERC-20 transfer
"send 100 USDC to 0x... on Arbitrum" — specify chain`
}

// ── Styles ────────────────────────────────────────────────────────────────────

const pane: React.CSSProperties = {
  flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
  background: 'var(--bg)',
  transition: 'background 0.2s ease',
}
const infoIcon: React.CSSProperties = {
  width: 16,
  height: 16,
  borderRadius: '50%',
  border: '1px solid var(--border-sub)',
  color: 'var(--text-5)',
  fontSize: 11,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  userSelect: 'none',
}
const creditsPopover: React.CSSProperties = {
  position: 'absolute',
  top: 28,
  left: 0,
  minWidth: 180,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg-card)',
  padding: '8px 10px',
  boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
  zIndex: 30,
}
const creditsLine: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-4)',
  lineHeight: 1.6,
}
const creditsHeading: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-5)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  marginBottom: 6,
}
const threadPanel: React.CSSProperties = {
  width: 220,
  borderRight: '1px solid var(--border)',
  background: 'var(--bg-card)',
  padding: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  transition: 'width 0.2s ease, padding 0.2s ease',
  overflow: 'hidden',
}
const threadPanelCollapsed: React.CSSProperties = {
  width: 46,
  padding: '10px 6px',
}
const threadPanelExpanded: React.CSSProperties = {
  width: 250,
  padding: 10,
}
const threadPanelTitle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-5)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
}
const newChatBtn: React.CSSProperties = {
  height: 32,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg)',
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: 18,
  lineHeight: 1,
  fontWeight: 500,
}
const threadList: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  overflowY: 'auto',
}
const threadRow: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
}
const threadItem: React.CSSProperties = {
  textAlign: 'left',
  border: '1px solid var(--border-sub)',
  borderRadius: 8,
  background: 'transparent',
  color: 'var(--text-4)',
  padding: '8px 10px',
  cursor: 'pointer',
  fontSize: 12,
}
const threadItemActive: React.CSSProperties = {
  borderColor: 'var(--accent)',
  color: 'var(--text)',
}
const renameBtn: React.CSSProperties = {
  border: '1px solid var(--border-sub)',
  background: 'transparent',
  color: 'var(--text-5)',
  borderRadius: 6,
  fontSize: 12,
  width: 28,
  height: 28,
  padding: 0,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
}
const threadEditInput: React.CSSProperties = {
  flex: 1,
  border: '1px solid var(--accent)',
  borderRadius: 8,
  background: 'var(--bg)',
  color: 'var(--text)',
  padding: '8px 10px',
  fontSize: 12,
}

const msgArea: React.CSSProperties = {
  flex: 1, overflowY: 'auto', padding: '24px 24px 8px',
}

const userBubble: React.CSSProperties = {
  background: 'rgba(99,102,241,0.1)',
  border: '1px solid rgba(99,102,241,0.2)',
  borderRadius: '12px 12px 3px 12px',
  padding: '12px 16px', maxWidth: '72%',
}

const aiBubble: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: '12px 12px 12px 3px',
  padding: '14px 18px', maxWidth: '76%',
  transition: 'background 0.2s ease, border-color 0.2s ease',
}

const aiLabel: React.CSSProperties = {
  fontSize: 8, color: '#6366F1', letterSpacing: 2.5,
  display: 'block', marginBottom: 10,
  fontFamily: 'var(--font-data)', fontWeight: 600,
}

const msgText: React.CSSProperties = {
  margin: 0, fontSize: 13, lineHeight: 1.75, color: 'var(--c-text-2)',
  fontFamily: 'var(--font-data)',
}

const msgLink: React.CSSProperties = {
  color: '#a3a6ff', textDecoration: 'underline',
}

const sectionHeader: React.CSSProperties = {
  color: 'var(--c-text)', fontSize: 12, fontWeight: 600,
  letterSpacing: 0.3, marginTop: 8, marginBottom: 6,
  fontFamily: 'var(--font-data)',
}

const bulletRow: React.CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 5,
}

const bulletDot: React.CSSProperties = {
  color: '#8B5CF6', lineHeight: 1.75, fontWeight: 700, marginTop: 0,
}

const paragraphRow: React.CSSProperties = { marginBottom: 7 }

const ts: React.CSSProperties = {
  fontSize: 10, color: 'var(--c-text-7)', marginTop: 5,
  fontFamily: 'var(--font-data)',
}

const dot: React.CSSProperties = {
  width: 5, height: 5, borderRadius: '50%',
  background: '#6366F1', display: 'inline-block',
  animation: 'pulse 1.4s ease-in-out infinite',
}

const promptsRow: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: 7, padding: '10px 24px 6px',
}

const chip: React.CSSProperties = {
  padding: '5px 12px',
  background: 'transparent',
  border: '1px solid var(--border-sub)',
  borderRadius: 6,
  color: 'var(--text-4)', fontSize: 11,
  fontFamily: 'var(--font-body)', fontWeight: 400,
  cursor: 'pointer', transition: 'all 0.15s',
  whiteSpace: 'nowrap' as const,
}

const inputRow: React.CSSProperties = {
  display: 'flex', gap: 10, padding: '12px 20px',
  borderTop: '1px solid var(--border)',
  background: 'var(--bg-subtle)',
  flexShrink: 0,
  transition: 'background 0.2s ease, border-color 0.2s ease',
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: 'var(--bg-card)',
  border: '1px solid var(--border-sub)',
  borderRadius: 8, padding: '10px 16px',
  color: 'var(--text)', fontSize: 14,
  fontFamily: 'var(--font-body)',
  transition: 'border-color 0.15s, background 0.2s ease',
}

const sendBtn: React.CSSProperties = {
  width: 40, height: 40,
  background: 'var(--accent-dim)',
  border: 'none', borderRadius: 8, color: '#fff',
  fontSize: 16, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  flexShrink: 0,
  transition: 'opacity 0.15s',
}

const chatDisabledNotice: React.CSSProperties = {
  borderTop: '1px solid var(--border)',
  color: 'var(--text-5)',
  padding: '8px 20px 12px',
  fontSize: 12,
}
