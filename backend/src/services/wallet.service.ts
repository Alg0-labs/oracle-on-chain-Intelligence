import type { WalletData, TokenBalance, NativeBalance, ChainBreakdown, Transaction, NFT } from '../types/index.js'
import {
  attachTokenMeta,
  buildTransactionDescription,
  classifyActivity,
  collectRawTransferLegs,
  computeFeeEthAndUsd,
  parseWeiField,
  type TokenMeta,
} from '../utils/transaction-decode.js'
import { formatEther, getAddress } from 'viem'
import dotenv from 'dotenv'

dotenv.config()

const MORALIS_API_KEY = process.env.MORALIS_API_KEY ?? ''
const DUNE_SIM_API_KEY = process.env.DUNE_SIM_API_KEY ?? ''
const ZERION_API_KEY = process.env.ZERION_API_KEY ?? ''
const MORALIS_BASE = 'https://deep-index.moralis.io/api/v2.2'
const DUNE_SIM_BASE = 'https://api.sim.dune.com/v1/evm'
const ZERION_BASE = 'https://api.zerion.io'

const NATIVE_ETH_PLACEHOLDER = '0x0000000000000000000000000000000000000000' as const

// ─── Dune chain display name mapping (transactions only) ────────────────────

const DUNE_CHAIN_DISPLAY: Record<string, string> = {
  ethereum:    'Ethereum',
  polygon:     'Polygon',
  bsc:         'BSC',
  arbitrum:    'Arbitrum',
  optimism:    'Optimism',
  base:        'Base',
  avalanche_c: 'Avalanche',
  avalanche:   'Avalanche',
  gnosis:      'Gnosis',
  scroll:      'Scroll',
  linea:       'Linea',
  zksync:      'zkSync',
  mantle:      'Mantle',
}

// ─── Zerion chain slug mapping (balances) ────────────────────────────────────
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


function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

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

// ─── Dune SIM helpers (transactions) ────────────────────────────────────────

async function duneFetch(path: string): Promise<any> {
  if (!DUNE_SIM_API_KEY) throw new Error('DUNE_SIM_API_KEY not set')
  const res = await fetch(`${DUNE_SIM_BASE}${path}`, {
    headers: { 'X-Sim-Api-Key': DUNE_SIM_API_KEY, accept: 'application/json' },
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Dune SIM ${path}: ${res.status} ${txt}`)
  }
  return res.json()
}

// ─── Zerion helpers (balances) ───────────────────────────────────────────────
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

// ─── Transactions (decode via ../utils/transaction-decode.ts) ─────────────────

async function fetchTokenMetadataMap(addresses: string[]): Promise<Map<string, TokenMeta>> {
  const map = new Map<string, TokenMeta>()
  if (addresses.length === 0) return map

  for (const group of chunk(addresses, 20)) {
    const params = new URLSearchParams({ chain: 'eth' })
    let appended = 0
    for (const a of group) {
      try {
        params.append('addresses', getAddress(a as `0x${string}`))
        appended++
      } catch {
        continue
      }
    }
    if (appended === 0) continue

    try {
      const data = await moralisFetch(`/erc20/metadata?${params.toString()}`)
      const arr = Array.isArray(data) ? data : []
      for (const t of arr) {
        const addr = (t.token_address ?? t.address ?? '') as string
        if (!addr) continue
        const key = addr.toLowerCase()
        map.set(key, {
          symbol: (t.symbol as string) ?? '?',
          name: (t.name as string) ?? (t.symbol as string) ?? 'Unknown',
          decimals: parseInt(String(t.decimals ?? '18'), 10) || 18,
          logo: t.logo as string | undefined,
        })
      }
    } catch {
      /* non-fatal */
    }
  }
  return map
}

/**
 * Build a normalised Transaction from a Dune SIM transaction row.
 * Dune fields: from, to, data (calldata), value (hex), gas_used (hex),
 * gas_price (hex), effective_gas_price (hex), success (bool), block_time (ISO).
 * Logs are already embedded: [{ address, data, topics[] }]
 */
function buildTransactionFromDune(
  row: any,
  walletLower: string,
  ethPrice: number,
  metaMap: Map<string, TokenMeta>
): Transaction {
  const tx = row as Record<string, unknown>

  const hash = tx.hash as string
  const from = (tx.from as string) ?? ''
  const to = (tx.to as string) ?? ''
  const fromL = from.toLowerCase()
  const toL = to.toLowerCase()

  const valueWei = parseWeiField(tx.value)
  const valueEth = Number(valueWei) / 1e18

  // Dune logs are already clean — normalizeTxLogs picks them up via `tx.logs`
  const rawTokenLegs = collectRawTransferLegs(tx, walletLower)
  const transfers = rawTokenLegs.map((r) => attachTokenMeta(r, metaMap))

  if (valueWei > 0n) {
    const direction: 'in' | 'out' = fromL === walletLower ? 'out' : toL === walletLower ? 'in' : 'out'
    transfers.unshift({
      tokenAddress: getAddress(NATIVE_ETH_PLACEHOLDER),
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18,
      from,
      to,
      amountRaw: valueWei.toString(),
      amountFormatted: formatEther(valueWei),
      direction,
    })
  }

  const activityType = classifyActivity(transfers, tx)
  const { feeNativeEth, feeUsd } = computeFeeEthAndUsd(tx, tx, ethPrice)
  const description = buildTransactionDescription(activityType, transfers, feeNativeEth, feeUsd)

  const ts = tx.block_time as string | undefined
  const timestamp = ts ? new Date(ts).getTime() : Date.now()

  const status: 'success' | 'failed' = tx.success === true ? 'success' : 'failed'

  // Dune: gas_used / gas_price are hex strings — convert to decimal strings for display
  const gasUsedBig = parseWeiField(tx.gas_used)
  const gasPriceBig = parseWeiField(tx.gas_price)

  return {
    hash,
    from,
    to,
    value: valueEth.toFixed(6),
    valueUsd: valueEth * ethPrice,
    timestamp,
    description,
    gasUsed: gasUsedBig > 0n ? gasUsedBig.toString() : undefined,
    gasPrice: gasPriceBig > 0n ? gasPriceBig.toString() : undefined,
    status,
    method: undefined,
    activityType,
    transfers,
    feeNativeEth,
    feeUsd,
  }
}

async function decodeDuneTxBatch(
  rows: any[],
  walletLower: string,
  ethPrice: number
): Promise<Transaction[]> {
  if (rows.length === 0) return []

  // Dune already embeds logs in each row — no per-tx verbose fetch needed.
  const tokenAddrs = new Set<string>()
  for (const row of rows) {
    for (const leg of collectRawTransferLegs(row as Record<string, unknown>, walletLower)) {
      tokenAddrs.add(leg.tokenAddress.toLowerCase())
    }
  }

  const metaMap = await fetchTokenMetadataMap([...tokenAddrs])
  return rows.map((row) => buildTransactionFromDune(row, walletLower, ethPrice, metaMap))
}

async function getTransactions(address: string, ethPrice: number): Promise<Transaction[]> {
  try {
    const qs = new URLSearchParams({ limit: '20', decode: 'false' })
    const data = await duneFetch(`/transactions/${address}?${qs}`)
    const rows = (data?.transactions ?? []) as any[]
    return decodeDuneTxBatch(rows, address.toLowerCase(), ethPrice)
  } catch (err: any) {
    console.error('[getTransactions]', err.message)
    return []
  }
}

export async function getTransactionsPaged(
  address: string,
  ethPrice: number,
  offset?: string,
  limit = 10
): Promise<{ transactions: Transaction[]; nextCursor: string | null; hasMore: boolean }> {
  const qs = new URLSearchParams({ limit: String(limit), decode: 'false' })
  if (offset) qs.set('offset', offset)

  const data = await duneFetch(`/transactions/${address}?${qs}`)
  const rows = (data?.transactions ?? []) as any[]
  const nextCursor = (data?.next_offset as string | undefined) ?? null
  const hasMore = Boolean(nextCursor && rows.length === limit)

  const transactions = await decodeDuneTxBatch(rows, address.toLowerCase(), ethPrice)
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

  // Fetch transactions (Dune SIM) with the live ETH price from Zerion
  const transactions = await getTransactions(address, ethPriceUsd)

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
