import type {
  WalletData,
  TokenBalance,
  NativeBalance,
  ChainBreakdown,
  Transaction,
  DecodedTransfer,
  NFT,
} from '../types/index.js'
import { buildTransactionDescription, classifyActivity } from '../utils/transaction-decode.js'
import { getAddress } from 'viem'
import dotenv from 'dotenv'

dotenv.config()

const MORALIS_API_KEY = process.env.MORALIS_API_KEY ?? ''
const ZERION_API_KEY = process.env.ZERION_API_KEY ?? ''
const MORALIS_BASE = 'https://deep-index.moralis.io/api/v2.2'
const ZERION_BASE = 'https://api.zerion.io'

const NATIVE_ETH_PLACEHOLDER = '0x0000000000000000000000000000000000000000' as const

// ─── Zerion chain slug mapping ────────────────────────────────────────────────
// Zerion identifies chains by slug rather than numeric chain_id.
// https://developers.zerion.io/reference/listwalletpositions

const ZERION_CHAIN: Record<string, { chainId: number; display: string }> = {
  ethereum:               { chainId: 1,     display: 'Ethereum' },
  polygon:                { chainId: 137,   display: 'Polygon' },
  'binance-smart-chain':  { chainId: 56,    display: 'BSC' },
  arbitrum:               { chainId: 42161, display: 'Arbitrum' },
  optimism:               { chainId: 10,    display: 'Optimism' },
  base:                   { chainId: 8453,  display: 'Base' },
  avalanche:              { chainId: 43114, display: 'Avalanche' },
}

const ZERION_CHAIN_SLUGS = Object.keys(ZERION_CHAIN).join(',')

// ─── Moralis helpers (balance, tokens, NFTs, metadata) ──────────────────────

async function moralisFetch(path: string) {
  if (!MORALIS_API_KEY) throw new Error('MORALIS_API_KEY not set')
  const res = await fetch(`${MORALIS_BASE}${path}`, {
    headers: { 'X-API-Key': MORALIS_API_KEY, accept: 'application/json' },
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Moralis ${path}: ${res.status} ${txt}`)
  }
  return res.json()
}

// ─── Zerion helpers ───────────────────────────────────────────────────────────
// Zerion uses HTTP Basic auth: base64("<api-key>:") — no password.

async function zerionFetch(path: string): Promise<any> {
  if (!ZERION_API_KEY) throw new Error('ZERION_API_KEY not set')
  const token = Buffer.from(`${ZERION_API_KEY}:`).toString('base64')
  const res = await fetch(`${ZERION_BASE}${path}`, {
    headers: { Authorization: `Basic ${token}`, accept: 'application/json' },
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Zerion ${path}: ${res.status} ${txt}`)
  }
  return res.json()
}

// ─── ENS Name ───────────────────────────────────────────────────────────────

async function getEnsName(address: string): Promise<string | undefined> {
  try {
    const data = await moralisFetch(`/resolve/${address}/reverse`)
    return data?.name
  } catch {
    return undefined
  }
}

// ─── Zerion: all-chain balances in one call ──────────────────────────────────
// Replaces the retired Dune Sim balances endpoint.
// https://developers.zerion.io/reference/listwalletpositions

async function getZerionBalances(address: string): Promise<{
  nativeBalances: NativeBalance[]
  tokens: TokenBalance[]
  ethPriceUsd: number
}> {
  const qs = new URLSearchParams({
    currency: 'usd',
    'filter[positions]': 'only_simple',
    'filter[chain_ids]': ZERION_CHAIN_SLUGS,
  })
  const data = await zerionFetch(`/v1/wallets/${address}/positions/?${qs}`)

  const positions: any[] = data.data ?? []
  const nativeBalances: NativeBalance[] = []
  const tokens: TokenBalance[] = []
  let ethPriceUsd = 2500

  for (const pos of positions) {
    const attr = pos.attributes
    const fungible = attr?.fungible_info
    const slug = pos.relationships?.chain?.data?.id
    if (!attr || !fungible || !slug) continue

    const mapped = ZERION_CHAIN[slug as string]
    if (!mapped) continue // unsupported chain — dropped

    const chainDisplay = mapped.display
    const chainId = mapped.chainId
    const decimals: number = attr.quantity?.decimals ?? 18
    const balance = Number(attr.quantity?.float ?? 0).toFixed(6)
    const balanceUsd: number = attr.value ?? 0
    const priceUsd: number | undefined = attr.price ?? undefined
    const change24h: number | undefined = attr.changes?.percent_1d ?? undefined

    const impls = fungible.implementations ?? []
    const impl = impls.find((i: any) => i.chain_id === slug) ?? impls[0]
    // A null implementation address denotes the chain's native coin.
    const tokenAddress: string = impl?.address ?? 'native'

    if (tokenAddress === 'native') {
      if (chainId === 1 && priceUsd) ethPriceUsd = priceUsd
      nativeBalances.push({
        chain: chainDisplay,
        chainId,
        symbol: fungible.symbol ?? '?',
        name: chainDisplay,
        balance,
        balanceUsd,
      })
    } else {
      tokens.push({
        symbol: fungible.symbol ?? 'UNKNOWN',
        name: fungible.name ?? fungible.symbol ?? 'Unknown Token',
        balance,
        decimals,
        usdValue: balanceUsd,
        contractAddress: tokenAddress,
        logo: fungible.icon?.url ?? undefined,
        change24h,
        chain: chainDisplay,
        chainId,
      })
    }
  }

  console.log(`[zerion-balances] ${nativeBalances.length} native, ${tokens.length} ERC-20 tokens, ETH=$${ethPriceUsd}`)

  return {
    nativeBalances,
    tokens: tokens.sort((a, b) => b.usdValue - a.usdValue),
    ethPriceUsd,
  }
}

// ─── Transactions (Zerion) ────────────────────────────────────────────────────
// Zerion's transactions endpoint returns already-classified transfers with
// token metadata embedded — no raw-log decoding or separate metadata lookup
// needed. https://developers.zerion.io/reference/listwallettransactions

/**
 * Build a normalised Transaction from a Zerion transaction row.
 */
function buildTransactionFromZerion(row: any, walletLower: string, ethPrice: number): Transaction {
  const attr = row.attributes ?? {}
  const chainSlug: string | undefined = row.relationships?.chain?.data?.id

  const hash = attr.hash as string
  const from = (attr.sent_from as string) ?? ''
  const to = (attr.sent_to as string) ?? ''

  const rawTransfers: any[] = attr.transfers ?? []
  const transfers: DecodedTransfer[] = []
  let valueEth = 0

  for (const t of rawTransfers) {
    const fungible = t.fungible_info
    if (!fungible) continue // skip NFT legs — not decoded here

    const impls = fungible.implementations ?? []
    const impl = impls.find((i: any) => i.chain_id === chainSlug) ?? impls[0]
    const tokenAddress: string = impl?.address || 'native'
    const decimals: number = t.quantity?.decimals ?? impl?.decimals ?? 18
    const amountFormatted: string = t.quantity?.numeric ?? String(t.quantity?.float ?? 0)
    const direction: 'in' | 'out' = t.direction === 'out' ? 'out' : 'in'
    const isNative = tokenAddress === 'native'

    if (isNative) valueEth += Number(t.quantity?.float ?? 0) * (direction === 'out' ? 1 : 1)

    transfers.push({
      tokenAddress: isNative ? getAddress(NATIVE_ETH_PLACEHOLDER) : tokenAddress,
      symbol: fungible.symbol ?? '?',
      name: fungible.name ?? fungible.symbol ?? 'Unknown',
      decimals,
      logo: fungible.icon?.url ?? undefined,
      from: t.sender ?? from,
      to: t.recipient ?? to,
      amountRaw: t.quantity?.int ?? '0',
      amountFormatted,
      direction,
    })
  }

  const activityType = classifyActivity(transfers, attr)
  const description = buildTransactionDescription(activityType, transfers, undefined, undefined)

  const timestamp = attr.mined_at ? new Date(attr.mined_at as string).getTime() : Date.now()
  const status: 'success' | 'failed' = attr.status === 'confirmed' ? 'success' : 'failed'

  const feeNativeEth: number | undefined = attr.fee?.quantity?.float ?? undefined
  const feeUsd: number | undefined =
    attr.fee?.value ?? (feeNativeEth != null ? feeNativeEth * ethPrice : undefined)

  return {
    hash,
    from,
    to,
    value: valueEth.toFixed(6),
    valueUsd: valueEth * ethPrice,
    timestamp,
    description,
    gasUsed: undefined,
    gasPrice: undefined,
    status,
    method: undefined,
    activityType,
    transfers,
    feeNativeEth,
    feeUsd,
  }
}

export async function getTransactionsPaged(
  address: string,
  ethPrice: number,
  cursor?: string,
  limit = 10
): Promise<{ transactions: Transaction[]; nextCursor: string | null; hasMore: boolean }> {
  const qs = new URLSearchParams({
    currency: 'usd',
    'filter[chain_ids]': ZERION_CHAIN_SLUGS,
    'page[size]': String(limit),
  })
  if (cursor) qs.set('page[after]', cursor)

  const data = await zerionFetch(`/v1/wallets/${address}/transactions/?${qs}`)
  const rows = (data?.data ?? []) as any[]

  const nextLink: string | undefined = data?.links?.next
  const nextCursor = nextLink ? new URL(nextLink).searchParams.get('page[after]') : null
  const hasMore = Boolean(nextCursor)

  const walletLower = address.toLowerCase()
  const transactions = rows.map((row) => buildTransactionFromZerion(row, walletLower, ethPrice))
  return { transactions, nextCursor, hasMore }
}

// ─── NFTs ────────────────────────────────────────────────────────────────────

async function getNFTs(address: string): Promise<NFT[]> {
  try {
    const data = await moralisFetch(`/${address}/nft?chain=eth&limit=10`)
    const results = data?.result ?? []
    return results.map((n: any) => ({
      name: n.name ?? `#${n.token_id}`,
      collection: n.token_address,
      tokenId: n.token_id,
      imageUrl: n.normalized_metadata?.image,
    }))
  } catch {
    return []
  }
}

// ─── Risk Analysis ───────────────────────────────────────────────────────────

function analyzeRisk(
  tokens: TokenBalance[],
  ethBalance: string,
  ethBalanceUsd: number,
  netWorth: number
): { riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'; riskReason: string; topHoldingPct: number; stablecoinPct: number } {
  const stableSymbols = ['USDC', 'USDT', 'DAI', 'BUSD', 'FRAX', 'LUSD', 'UST']
  
  const allAssets = [
    { symbol: 'ETH', usdValue: ethBalanceUsd },
    ...tokens,
  ]

  const totalUsd = allAssets.reduce((s, a) => s + a.usdValue, 0) || 1

  const stablecoinUsd = allAssets
    .filter(a => stableSymbols.includes(a.symbol.toUpperCase()))
    .reduce((s, a) => s + a.usdValue, 0)

  const stablecoinPct = (stablecoinUsd / totalUsd) * 100
  const topHolding = allAssets.reduce((m, a) => a.usdValue > m.usdValue ? a : m, allAssets[0] ?? { usdValue: 0, symbol: 'ETH' })
  const topHoldingPct = ((topHolding?.usdValue ?? 0) / totalUsd) * 100

  let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW'
  let riskReason = 'Diversified portfolio with reasonable stablecoin allocation.'

  if (topHoldingPct > 80) {
    riskLevel = 'HIGH'
    riskReason = `${topHolding?.symbol ?? 'One asset'} makes up ${topHoldingPct.toFixed(0)}% of portfolio — extreme concentration risk.`
  } else if (topHoldingPct > 60) {
    riskLevel = 'MEDIUM'
    riskReason = `${topHolding?.symbol ?? 'One asset'} is ${topHoldingPct.toFixed(0)}% of portfolio — moderate concentration risk.`
  } else if (stablecoinPct < 5 && netWorth > 5000) {
    riskLevel = 'MEDIUM'
    riskReason = 'Very low stablecoin allocation — limited downside protection.'
  }

  return { riskLevel, riskReason, topHoldingPct, stablecoinPct }
}

// ─── Main Export ─────────────────────────────────────────────────────────────

export async function fetchWalletData(address: string): Promise<WalletData> {
  const [ensName, balanceData, nfts] = await Promise.all([
    getEnsName(address),
    getZerionBalances(address),
    getNFTs(address),
  ])

  const { nativeBalances, tokens, ethPriceUsd } = balanceData

  // Fetch transactions with the live ETH price from Zerion
  const transactions = await getTransactionsPaged(address, ethPriceUsd, undefined, 20)
    .then((r) => r.transactions)
    .catch((err: any) => {
      console.error('[getTransactionsPaged]', err.message)
      return []
    })

  // Ethereum mainnet native balance (for backward compat fields)
  const ethNative = nativeBalances.find(n => n.chainId === 1)
  const ethBalanceStr = ethNative?.balance ?? '0'
  const ethBalanceUsd = ethNative?.balanceUsd ?? 0

  const nativeNetWorth = nativeBalances.reduce((s, n) => s + n.balanceUsd, 0)
  const tokenNetWorth = tokens.reduce((s, t) => s + t.usdValue, 0)
  const netWorthUsd = nativeNetWorth + tokenNetWorth

  // Per-chain breakdown (native + tokens)
  const chainMap = new Map<string, { chainId: number; usdValue: number; nativeSymbol: string }>()
  for (const n of nativeBalances) {
    chainMap.set(n.chain, { chainId: n.chainId, usdValue: n.balanceUsd, nativeSymbol: n.symbol })
  }
  for (const t of tokens) {
    const entry = chainMap.get(t.chain)
    if (entry) entry.usdValue += t.usdValue
  }
  const chainBreakdown: ChainBreakdown[] = [...chainMap.entries()]
    .map(([chain, v]) => ({ chain, ...v }))
    .filter(c => c.usdValue > 0.01)
    .sort((a, b) => b.usdValue - a.usdValue)

  const { riskLevel, riskReason, topHoldingPct, stablecoinPct } = analyzeRisk(
    tokens, ethBalanceStr, ethBalanceUsd, netWorthUsd
  )

  return {
    address,
    ensName,
    ethBalance: ethBalanceStr,
    ethBalanceUsd,
    netWorthUsd,
    tokens,
    nativeBalances,
    chainBreakdown,
    transactions,
    nfts,
    riskLevel,
    riskReason,
    topHoldingPct,
    stablecoinPct,
    chain: 'Ethereum',
  }
}
