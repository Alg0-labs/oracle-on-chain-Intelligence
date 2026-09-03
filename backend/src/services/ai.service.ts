import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam, Tool, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages'
import type { ChatMessage, ChatResponse, SendTxIntent, MarketContext, WalletData } from '../types/index.js'
import { fetchMarketContext } from './market.service.js'
import { isValidEvmAddress, isPositiveDecimal } from '../utils/tx-builder.js'
import { buildSystemPrompt } from '../prompts/system-prompt.js'
import { SEND_ETH_TOOL, SEND_TOKEN_TOOL } from '../prompts/tools.js'
import dotenv from 'dotenv'

dotenv.config({ override: true })

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const GET_WALLET_SUMMARY_TOOL = {
  name: 'get_wallet_summary',
  description:
    'Returns a compact snapshot: net worth, ETH, risk, top tokens (by USD), chain breakdown, NFT count, tx count loaded, snapshot time. Call for portfolio / risk / net worth questions.',
  input_schema: { type: 'object', properties: {} },
} as const satisfies Tool

const GET_TOKEN_HOLDINGS_TOOL = {
  name: 'get_token_holdings',
  description: 'List ERC-20 holdings with balances and USD values. Optional chain filter and limit.',
  input_schema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Max tokens to return (default 25, max 40)' },
      chain: { type: 'string', description: 'Optional chain name filter, e.g. Ethereum' },
    },
  },
} as const satisfies Tool

const GET_RECENT_TX_TOOL = {
  name: 'get_recent_transactions',
  description: 'Recent transactions from the indexed snapshot (not full chain history).',
  input_schema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Max txs (default 10, max 20)' },
    },
  },
} as const satisfies Tool

const GET_MARKET_CONTEXT_TOOL = {
  name: 'get_market_context',
  description:
    'Fear & Greed, ETH portfolio impact, and ETH-relevant news headlines with URLs. Call for market sentiment or news questions.',
  input_schema: { type: 'object', properties: {} },
} as const satisfies Tool

const WALLET_TOOLS = [
  GET_WALLET_SUMMARY_TOOL,
  GET_TOKEN_HOLDINGS_TOOL,
  GET_RECENT_TX_TOOL,
  GET_MARKET_CONTEXT_TOOL,
] as const satisfies readonly Tool[]

const ALL_TOOLS: Tool[] = [...WALLET_TOOLS, SEND_ETH_TOOL, SEND_TOKEN_TOOL]

function buildMinimalSystemPrompt(address: string, snapshotIso: string): string {
  return `You are ØRACLE — a sharp, precise on-chain financial AI assistant.

Wallet address: ${address}
Indexed snapshot as of (UTC): ${snapshotIso}

Data policy:
- Never invent balances, prices, or transactions. Use the tools to read the user's indexed wallet and market context.
- Tool outputs are authoritative. If earlier messages in the thread disagree with a tool result, trust the tool.
- Balances reflect indexer state (Zerion), not mempool.

RESPONSE RULES:
1. Be concise, direct, and insightful. No fluff. No emojis. Do not use markdown formatting symbols like **, __, or bullet markdown syntax.
2. For portfolio questions, call get_wallet_summary and/or get_token_holdings as needed.
3. For recent activity, call get_recent_transactions.
4. For market sentiment or news, call get_market_context. When citing news, include the source URL on the same line.
5. Only call send_eth or send_token when the user gives a clear, direct command to send/transfer now with all required details.
6. For token sends: use exact tokenAddress and decimals from get_token_holdings. Never guess a contract address.
7. If the transfer request is uncertain or missing info, do NOT call send_eth/send_token. Say: "Whenever you are ready to transfer funds, come back and I will help you do it safely."
8. For "what can you do" — wallet analysis, cross-chain balances, risk checks, tx history, send ETH, send ERC-20 tokens.`
}

function compactSummary(wallet: WalletData, snapshotIso: string): object {
  const topTokens = wallet.tokens.slice(0, 8).map((t) => ({
    symbol: t.symbol,
    chain: t.chain,
    balance: t.balance,
    usdValue: t.usdValue,
    contractAddress: t.contractAddress,
    decimals: t.decimals,
  }))
  return {
    snapshotAsOf: snapshotIso,
    ensName: wallet.ensName,
    netWorthUsd: wallet.netWorthUsd,
    ethBalance: wallet.ethBalance,
    ethBalanceUsd: wallet.ethBalanceUsd,
    riskLevel: wallet.riskLevel,
    riskReason: wallet.riskReason,
    stablecoinPct: wallet.stablecoinPct,
    topHoldingPct: wallet.topHoldingPct,
    chainBreakdown: wallet.chainBreakdown,
    nativeBalancesPositive: (wallet.nativeBalances ?? [])
      .filter((n) => parseFloat(n.balance) > 0)
      .map((n) => ({
        chain: n.chain,
        symbol: n.symbol,
        balance: n.balance,
        balanceUsd: n.balanceUsd,
      })),
    topTokens,
    nftCount: wallet.nfts.length,
    transactionsLoaded: wallet.transactions.length,
  }
}

function compactMarket(m: MarketContext): object {
  const eth = m.portfolioImpact[0]
  return {
    fetchedAt: new Date(m.fetchedAt).toISOString(),
    fearGreed: m.fearGreed,
    ethImpact: eth
      ? {
          holdingUsd: eth.holdingUsd,
          percentOfPortfolio: eth.percentOfPortfolio,
          sentiment: eth.sentiment,
          priceChange24h: eth.priceChange24h,
          relatedNewsCount: eth.relatedNewsCount,
        }
      : null,
    relevantNews: m.relevantNews.slice(0, 6).map((n) => ({
      title: n.title,
      sentiment: n.sentiment,
      source: n.source,
      url: n.url,
    })),
  }
}

// ─── Parse transaction intent from tool use ───────────────────────────────────
function parseToolTxIntent(content: unknown[]): SendTxIntent | undefined {
  const toolUse = content.find(
    (block: any) =>
      block?.type === 'tool_use' && (block?.name === 'send_eth' || block?.name === 'send_token')
  ) as any

  if (!toolUse?.input || typeof toolUse.input !== 'object') return undefined
  const input = toolUse.input as Record<string, unknown>

  const to = typeof input.to === 'string' ? input.to.trim() : ''
  const amount = typeof input.amount === 'string' ? input.amount.trim() : ''
  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''

  if (!isValidEvmAddress(to) || !isPositiveDecimal(amount)) return undefined

  if (toolUse.name === 'send_token') {
    const tokenAddress = typeof input.tokenAddress === 'string' ? input.tokenAddress.trim() : ''
    const tokenSymbol = typeof input.tokenSymbol === 'string' ? input.tokenSymbol.trim() : '?'
    const tokenName = typeof input.tokenName === 'string' ? input.tokenName.trim() : tokenSymbol
    const decimals = typeof input.decimals === 'number' ? input.decimals : 18
    const chainId = typeof input.chainId === 'number' ? input.chainId : 1

    if (!isValidEvmAddress(tokenAddress)) return undefined

    return {
      type: 'SEND_TOKEN',
      to,
      amount,
      tokenSymbol,
      tokenName,
      tokenAddress,
      decimals,
      chainId,
      reason: reason || `Send ${tokenSymbol} transfer`,
    }
  }

  const chainId = typeof input.chainId === 'number' ? input.chainId : 1
  return {
    type: 'SEND_ETH',
    to,
    amount,
    chainId,
    reason: reason || 'User requested ETH transfer',
  }
}

async function runWalletTool(
  name: string,
  input: unknown,
  wallet: WalletData,
  snapshotIso: string
): Promise<string> {
  const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}

  switch (name) {
    case 'get_wallet_summary':
      return JSON.stringify(compactSummary(wallet, snapshotIso))
    case 'get_token_holdings': {
      const limit = typeof obj.limit === 'number' ? Math.min(40, Math.max(1, obj.limit)) : 25
      const chain = typeof obj.chain === 'string' ? obj.chain.trim() : ''
      let list = wallet.tokens
      if (chain) list = list.filter((t) => t.chain.toLowerCase().includes(chain.toLowerCase()))
      list = list.slice(0, limit)
      return JSON.stringify({ tokens: list, count: list.length })
    }
    case 'get_recent_transactions': {
      const lim = typeof obj.limit === 'number' ? Math.min(20, Math.max(1, obj.limit)) : 10
      const txs = wallet.transactions.slice(0, lim).map((tx) => ({
        hash: tx.hash,
        timestamp: tx.timestamp,
        activityType: tx.activityType,
        status: tx.status,
        description: tx.description,
        value: tx.value,
        valueUsd: tx.valueUsd,
        transfers: tx.transfers,
      }))
      return JSON.stringify({ transactions: txs })
    }
    default:
      return JSON.stringify({ error: 'unknown tool' })
  }
}

export async function chat(
  messages: ChatMessage[],
  wallet: WalletData,
  snapshotUpdatedAt: Date
): Promise<ChatResponse> {
  const snapshotIso = snapshotUpdatedAt.toISOString()
  const systemPrompt = buildMinimalSystemPrompt(wallet.address, snapshotIso)

  const apiMessages: MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }))

  let lastContent: unknown[] = []
  let pendingSendIntent: SendTxIntent | undefined
  const maxRounds = 8

  for (let round = 0; round < maxRounds; round++) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: systemPrompt,
      messages: apiMessages,
      tools: ALL_TOOLS,
    })

    lastContent = response.content as unknown[]

    if (response.stop_reason !== 'tool_use') {
      const reply = (response.content as Array<{ type: string; text?: string }>)
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('')
        .trim()

      const txIntent = parseToolTxIntent(lastContent) ?? pendingSendIntent
      const fallbackReply = txIntent
        ? txIntent.type === 'SEND_TOKEN'
          ? `Ready to send ${txIntent.amount} ${txIntent.tokenSymbol} to ${txIntent.to}. Please confirm.`
          : `Ready to send ${txIntent.amount} ETH to ${txIntent.to}. Please confirm.`
        : ''

      return {
        reply: reply || fallbackReply,
        txIntent,
      }
    }

    apiMessages.push({
      role: 'assistant',
      content: response.content as MessageParam['content'],
    })

    const toolUses = (response.content as Array<{ type: string; id?: string; name?: string; input?: unknown }>).filter(
      (b) => b.type === 'tool_use'
    )

    const results: ToolResultBlockParam[] = []

    for (const tu of toolUses) {
      const id = tu.id ?? ''
      const name = tu.name ?? ''
      try {
        let out: string
        if (name === 'get_market_context') {
          const market = await fetchMarketContext(wallet)
          out = JSON.stringify(compactMarket(market))
        } else if (
          name === 'get_wallet_summary' ||
          name === 'get_token_holdings' ||
          name === 'get_recent_transactions'
        ) {
          out = await runWalletTool(name, tu.input, wallet, snapshotIso)
        } else if (name === 'send_eth' || name === 'send_token') {
          const intent = parseToolTxIntent([
            { type: 'tool_use', name: tu.name, input: tu.input },
          ] as unknown[])
          if (intent) pendingSendIntent = intent
          out = JSON.stringify({ ok: true, note: 'Transfer intent recorded; user will confirm in the app.' })
        } else {
          out = JSON.stringify({ error: `Unknown tool: ${name}` })
        }
        results.push({ type: 'tool_result', tool_use_id: id, content: out })
      } catch (e: any) {
        results.push({
          type: 'tool_result',
          tool_use_id: id,
          is_error: true,
          content: e?.message ?? 'Tool error',
        })
      }
    }

    apiMessages.push({ role: 'user', content: results })
  }

  const txIntent = parseToolTxIntent(lastContent) ?? pendingSendIntent
  return {
    reply: 'Too many tool rounds; try a simpler question.',
    txIntent,
  }
}
