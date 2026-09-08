import type { WalletData, Transaction, ChatMessage, SendTxIntent, MarketData } from '../types/index.js'

const BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001') + '/api'

export type FetchWalletResult = {
  wallet: WalletData
  snapshotUpdatedAt: string | null
  hydratedFromIndexer?: boolean
}

export interface WalletPreset {
  label: string
  address: string
}

export async function fetchWallet(address: string): Promise<FetchWalletResult> {
  const res = await fetch(`${BASE}/wallet/${address}`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error ?? 'Failed to fetch wallet')
  return {
    wallet: json.wallet,
    snapshotUpdatedAt: json.snapshotUpdatedAt ?? null,
    hydratedFromIndexer: json.hydratedFromIndexer,
  }
}

export async function refreshWallet(address: string): Promise<FetchWalletResult> {
  const res = await fetch(`${BASE}/wallet/${address}/refresh`, { method: 'POST' })
  const json = await res.json()
  if (res.status === 429) {
    throw new Error(`Wait ${Math.ceil((json.retryAfterMs ?? 30000) / 1000)}s before refreshing again`)
  }
  if (!json.success) throw new Error(json.error ?? 'Failed to refresh wallet')
  return {
    wallet: json.wallet,
    snapshotUpdatedAt: json.snapshotUpdatedAt ?? null,
  }
}

export async function fetchTransactions(
  address: string,
  offset?: string,
  limit = 10
): Promise<{ transactions: Transaction[]; nextCursor: string | null; hasMore: boolean }> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (offset) params.set('offset', offset)
  const res = await fetch(`${BASE}/wallet/${address}/transactions?${params}`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error ?? 'Failed to fetch transactions')
  return { transactions: json.transactions, nextCursor: json.nextCursor, hasMore: json.hasMore }
}

export async function sendChat(
  address: string,
  messages: Omit<ChatMessage, 'id' | 'timestamp'>[],
  threadId?: string | null
): Promise<{ reply: string; txIntent?: SendTxIntent; remainingCredits?: number; threadId?: string }> {
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, messages, threadId: threadId ?? undefined }),
  })
  const json = await res.json()
  if (!json.success) {
    const error = new Error(json.error ?? 'AI error') as Error & { code?: string; remainingCredits?: number }
    error.code = String(res.status)
    error.remainingCredits = typeof json.remainingCredits === 'number' ? json.remainingCredits : undefined
    throw error
  }
  return {
    reply: json.reply,
    txIntent: json.txIntent,
    remainingCredits: typeof json.remainingCredits === 'number' ? json.remainingCredits : undefined,
    threadId: json.threadId,
  }
}

export async function fetchMarket(address: string): Promise<MarketData> {
  const res = await fetch(`${BASE}/market/${address}`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error ?? 'Failed to fetch market data')
  return {
    fearGreed: json.fearGreed,
    portfolioImpact: json.portfolioImpact ?? [],
    relevantNews: json.relevantNews ?? [],
    latestNewsInsights: json.latestNewsInsights ?? [],
    fetchedAt: json.fetchedAt ?? Date.now(),
  }
}

export async function fetchWalletPresets(): Promise<WalletPreset[]> {
  const res = await fetch(`${BASE}/wallet-presets`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error ?? 'Failed to fetch wallet presets')
  return Array.isArray(json.wallets) ? json.wallets : []
}

export async function fetchChatHistory(address: string): Promise<{
  threadId: string | null
  messages: Array<{ role: 'user' | 'assistant'; content: string; createdAt: string }>
  remainingCredits?: number
}> {
  const res = await fetch(`${BASE}/chat/${address}/history`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error ?? 'Failed to fetch chat history')
  return {
    threadId: json.threadId ?? null,
    messages: Array.isArray(json.messages) ? json.messages : [],
    remainingCredits: typeof json.remainingCredits === 'number' ? json.remainingCredits : undefined,
  }
}

export async function fetchChatHistoryByThread(address: string, threadId: string): Promise<{
  threadId: string | null
  messages: Array<{ role: 'user' | 'assistant'; content: string; createdAt: string }>
  remainingCredits?: number
}> {
  const params = new URLSearchParams({ threadId })
  const res = await fetch(`${BASE}/chat/${address}/history?${params}`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error ?? 'Failed to fetch chat history')
  return {
    threadId: json.threadId ?? null,
    messages: Array.isArray(json.messages) ? json.messages : [],
    remainingCredits: typeof json.remainingCredits === 'number' ? json.remainingCredits : undefined,
  }
}

export async function fetchChatThreads(address: string): Promise<Array<{ id: string; title: string | null; updatedAt: string }>> {
  const res = await fetch(`${BASE}/chat/${address}/threads`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error ?? 'Failed to fetch chat threads')
  return Array.isArray(json.threads) ? json.threads : []
}

export async function createChatThread(address: string, title?: string): Promise<{ id: string; title: string | null; updatedAt: string }> {
  const res = await fetch(`${BASE}/chat/${address}/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title ?? null }),
  })
  const json = await res.json()
  if (!json.success) throw new Error(json.error ?? 'Failed to create chat thread')
  return json.thread
}

export async function renameChatThread(address: string, threadId: string, title: string): Promise<void> {
  const res = await fetch(`${BASE}/chat/${address}/threads/${threadId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  const json = await res.json()
  if (!json.success) throw new Error(json.error ?? 'Failed to rename chat thread')
}

export async function fetchCredits(address: string): Promise<{ creditsTotal: number; creditsUsed: number; remainingCredits: number }> {
  const res = await fetch(`${BASE}/credits/${address}`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error ?? 'Failed to fetch credits')
  return {
    creditsTotal: Number(json.creditsTotal ?? 0),
    creditsUsed: Number(json.creditsUsed ?? 0),
    remainingCredits: Number(json.remainingCredits ?? 0),
  }
}
