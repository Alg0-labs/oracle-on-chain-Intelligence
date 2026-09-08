import { Router } from 'express'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { getTransactionsPaged } from '../services/wallet.service.js'
import { prisma } from '../lib/prisma.js'
import { chat } from '../services/ai.service.js'
import { fetchMarketContext } from '../services/market.service.js'
import {
  getWalletForRead,
  refreshWalletSnapshot,
  canManualRefresh,
  markManualRefresh,
} from '../services/wallet-snapshot.service.js'
import { appendMessages, getOrCreateLatestThread, listLatestThreadMessages } from '../services/chat-history.service.js'
import {
  consumeCreditsAtomic,
  getCreditSummary,
  getChatCreditCost,
  getRemainingCredits,
  InsufficientCreditsError,
} from '../services/credit.service.js'
import { createThread, listThreadMessagesById, listThreads, renameThread } from '../services/chat-history.service.js'
import dotenv from 'dotenv'
dotenv.config()

export const router = Router()
const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
const POPULAR_WALLET_PRESETS = [
  { label: 'Vitalik Buterin', address: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045' },
  { label: 'Justin Sun', address: '0x176f3dab24a159341c0509bb36b833e7fdd0a132' },
  { label: 'Binance 8', address: '0xf977814e90da44bfa03b6295a0616a897441acec' },
  { label: 'Kraken 7', address: '0x267be1c1d684f78cb4f6a176c4911b741e4ffdc0' },
] as const
const POPULAR_WALLET_SET = new Set(POPULAR_WALLET_PRESETS.map((item) => item.address.toLowerCase()))

// ─── GET /api/wallet/:address ─────────────────────────────────────────────
router.get('/wallet-presets', (_req, res) => {
  res.json({ success: true, wallets: POPULAR_WALLET_PRESETS })
})

router.get('/wallet/:address', async (req, res) => {
  const { address } = req.params

  if (!AddressSchema.safeParse(address).success) {
    return res.status(400).json({ error: 'Invalid Ethereum address' })
  }

  try {
    const { wallet, snapshotUpdatedAt, hydratedFromIndexer } = await getWalletForRead(address)
    res.json({
      success: true,
      wallet,
      snapshotUpdatedAt: snapshotUpdatedAt.toISOString(),
      hydratedFromIndexer,
    })
  } catch (err: any) {
    console.error('[wallet]', err.message)
    res.status(500).json({ error: err.message ?? 'Failed to fetch wallet data' })
  }
})

// ─── POST /api/wallet/:address/refresh ───────────────────────────────────

router.post('/wallet/:address/refresh', async (req, res) => {
  const { address } = req.params

  if (!AddressSchema.safeParse(address).success) {
    return res.status(400).json({ error: 'Invalid Ethereum address' })
  }
  const gate = canManualRefresh(address)
  if (!gate.ok) {
    return res.status(429).json({
      error: 'Refresh cooldown',
      retryAfterMs: gate.retryAfterMs,
    })
  }

  try {
    markManualRefresh(address)
    const wallet = await refreshWalletSnapshot(address)
    const row = await prisma.walletSnapshot.findUniqueOrThrow({
      where: { address: address.toLowerCase() },
    })
    res.json({
      success: true,
      wallet,
      snapshotUpdatedAt: row.updatedAt.toISOString(),
    })
  } catch (err: any) {
    console.error('[wallet-refresh]', err.message)
    res.status(500).json({ error: err.message ?? 'Failed to refresh wallet' })
  }
})

// ─── GET /api/wallet/:address/transactions ────────────────────────────────

router.get('/wallet/:address/transactions', async (req, res) => {
  const { address } = req.params

  if (!AddressSchema.safeParse(address).success) {
    return res.status(400).json({ error: 'Invalid Ethereum address' })
  }

  const offset = typeof req.query.offset === 'string' ? req.query.offset : undefined
  const limit = Math.min(parseInt(String(req.query.limit ?? '10'), 10) || 10, 50)

  try {
    const ethPriceRes = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd'
    )
    const ethPriceJson = await ethPriceRes.json() as { ethereum?: { usd?: number } }
    const ethPrice = ethPriceJson?.ethereum?.usd ?? 2500

    const result = await getTransactionsPaged(address, ethPrice, offset, limit)
    res.json({ success: true, ...result })
  } catch (err: any) {
    console.error('[transactions]', err.message)
    res.status(500).json({ error: err.message ?? 'Failed to fetch transactions' })
  }
})

// ─── POST /api/chat ───────────────────────────────────────────────────────

const ChatBodySchema = z.object({
  address: AddressSchema,
  threadId: z.string().min(1).optional(),
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
    })
  ).min(1),
})

router.post('/chat', async (req, res) => {
  const parsed = ChatBodySchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.errors })
  }

  const { address, messages, threadId } = parsed.data

  try {
    const isAnonymousPreset = POPULAR_WALLET_SET.has(address.toLowerCase())
    const { wallet, snapshotUpdatedAt } = await getWalletForRead(address)

    if (isAnonymousPreset) {
      const response = await chat(messages, wallet, snapshotUpdatedAt)
      return res.json({
        success: true,
        ...response,
        threadId: null,
      })
    }

    const chatCost = getChatCreditCost()
    const remaining = await getRemainingCredits(address)
    if (remaining < chatCost) {
      return res.status(402).json({ error: 'Insufficient credits', remainingCredits: remaining })
    }

    const response = await chat(messages, wallet, snapshotUpdatedAt)
    const thread = threadId
      ? await prisma.chatThread.findFirst({
          where: { id: threadId, address: address.toLowerCase() },
        }) ?? await getOrCreateLatestThread(address)
      : await getOrCreateLatestThread(address)
    const userMessage = messages[messages.length - 1]
    await appendMessages(thread.id, [
      { role: 'user', content: userMessage.content },
      { role: 'assistant', content: response.reply },
    ])

    const requestIdHeader = req.headers['x-request-id']
    const requestId = typeof requestIdHeader === 'string' && requestIdHeader.length > 0
      ? requestIdHeader
      : randomUUID()
    const usage = await consumeCreditsAtomic({
      address,
      cost: chatCost,
      reason: 'chat_message',
      requestId: `${address.toLowerCase()}:${requestId}`,
    })

    res.json({
      success: true,
      ...response,
      remainingCredits: usage.remainingCredits,
      threadId: thread.id,
    })
  } catch (err: any) {
    if (err instanceof InsufficientCreditsError) {
      return res.status(402).json({ error: 'Insufficient credits', remainingCredits: err.remainingCredits })
    }
    if (typeof err?.message === 'string' && err.message.includes('UserCredit') && err.message.includes('does not exist')) {
      return res.status(503).json({ error: 'Database not migrated: run Prisma migration/db push for credits tables' })
    }
    console.error('[chat]', err.message)
    res.status(500).json({ error: err.message ?? 'AI error' })
  }
})

router.get('/chat/:address/history', async (req, res) => {
  const { address } = req.params
  const threadId = typeof req.query.threadId === 'string' ? req.query.threadId : undefined
  if (!AddressSchema.safeParse(address).success) {
    return res.status(400).json({ error: 'Invalid Ethereum address' })
  }
  if (POPULAR_WALLET_SET.has(address.toLowerCase())) {
    return res.json({ success: true, threadId: null, messages: [], remainingCredits: 0 })
  }

  try {
    const history = threadId
      ? await listThreadMessagesById(address, threadId, 200)
      : await listLatestThreadMessages(address, 200)
    const remainingCredits = await getRemainingCredits(address)
    res.json({ success: true, ...history, remainingCredits })
  } catch (err: any) {
    if (typeof err?.message === 'string' && err.message.includes('UserCredit') && err.message.includes('does not exist')) {
      return res.status(503).json({ error: 'Database not migrated: run Prisma migration/db push for credits tables' })
    }
    console.error('[chat-history]', err.message)
    res.status(500).json({ error: err.message ?? 'Failed to fetch chat history' })
  }
})

router.get('/chat/:address/threads', async (req, res) => {
  const { address } = req.params
  if (!AddressSchema.safeParse(address).success) {
    return res.status(400).json({ error: 'Invalid Ethereum address' })
  }
  if (POPULAR_WALLET_SET.has(address.toLowerCase())) {
    return res.json({ success: true, threads: [] })
  }

  try {
    const threads = await listThreads(address, 100)
    res.json({ success: true, threads })
  } catch (err: any) {
    console.error('[chat-threads]', err.message)
    res.status(500).json({ error: err.message ?? 'Failed to fetch chat threads' })
  }
})

router.post('/chat/:address/threads', async (req, res) => {
  const { address } = req.params
  if (!AddressSchema.safeParse(address).success) {
    return res.status(400).json({ error: 'Invalid Ethereum address' })
  }
  if (POPULAR_WALLET_SET.has(address.toLowerCase())) {
    return res.status(403).json({ error: 'Anonymous preset wallets cannot create saved threads' })
  }

  try {
    const title = typeof req.body?.title === 'string' ? req.body.title : null
    const thread = await createThread(address, title)
    res.json({ success: true, thread })
  } catch (err: any) {
    console.error('[chat-thread-create]', err.message)
    res.status(500).json({ error: err.message ?? 'Failed to create chat thread' })
  }
})

router.patch('/chat/:address/threads/:threadId', async (req, res) => {
  const { address, threadId } = req.params
  if (!AddressSchema.safeParse(address).success) {
    return res.status(400).json({ error: 'Invalid Ethereum address' })
  }
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : ''
  if (!title) {
    return res.status(400).json({ error: 'Thread title is required' })
  }

  try {
    const result = await renameThread(address, threadId, title)
    if (result.count === 0) {
      return res.status(404).json({ error: 'Thread not found' })
    }
    res.json({ success: true })
  } catch (err: any) {
    console.error('[chat-thread-rename]', err.message)
    res.status(500).json({ error: err.message ?? 'Failed to rename chat thread' })
  }
})

router.get('/credits/:address', async (req, res) => {
  const { address } = req.params
  if (!AddressSchema.safeParse(address).success) {
    return res.status(400).json({ error: 'Invalid Ethereum address' })
  }
  if (POPULAR_WALLET_SET.has(address.toLowerCase())) {
    return res.json({ success: true, creditsTotal: 0, creditsUsed: 0, remainingCredits: 0 })
  }

  try {
    const summary = await getCreditSummary(address)
    res.json({ success: true, ...summary })
  } catch (err: any) {
    console.error('[credits]', err.message)
    res.status(500).json({ error: err.message ?? 'Failed to load credits' })
  }
})

// ─── GET /api/market/:address (ETH-focused context) ───────────────────────

router.get('/market/:address', async (req, res) => {
  const { address } = req.params

  if (!AddressSchema.safeParse(address).success) {
    return res.status(400).json({ error: 'Invalid Ethereum address' })
  }

  try {
    const { wallet } = await getWalletForRead(address)
    const market = await fetchMarketContext(wallet)
    res.json({
      success: true,
      fearGreed: market.fearGreed,
      portfolioImpact: market.portfolioImpact,
      relevantNews: market.relevantNews.slice(0, 10),
      latestNewsInsights: market.latestNewsInsights,
      fetchedAt: market.fetchedAt,
    })
  } catch (err: any) {
    console.error('[market]', err.message)
    res.status(500).json({ error: err.message ?? 'Failed to fetch market data' })
  }
})

// ─── GET /api/health ─────────────────────────────────────────────────────

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})
