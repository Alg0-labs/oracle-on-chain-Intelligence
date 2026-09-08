export interface TokenBalance {
  symbol: string
  name: string
  balance: string
  decimals: number
  usdValue: number
  contractAddress?: string
  logo?: string
  change24h?: number
  chain: string       // e.g. "Ethereum", "Polygon", "BSC"
  chainId?: number
}

export interface NativeBalance {
  chain: string
  chainId: number
  symbol: string
  name: string
  balance: string
  balanceUsd: number
}

export type TransactionActivity = 'swap' | 'send' | 'receive' | 'contract'

export interface DecodedTransfer {
  tokenAddress: string
  symbol: string
  name: string
  decimals: number
  logo?: string
  from: string
  to: string
  amountRaw: string
  amountFormatted: string
  direction: 'in' | 'out'
}

export interface Transaction {
  hash: string
  from: string
  to: string
  value: string // native ETH attached to tx (may be 0 for pure token flows)
  valueUsd: number
  timestamp: number
  description: string
  gasUsed?: string
  gasPrice?: string
  status: 'success' | 'failed'
  method?: string
  /** swap = traded one asset for another; send / receive = one-way flow */
  activityType: TransactionActivity
  /** ERC-20 + native ETH legs (same spirit as decode.js), enriched from token contract */
  transfers: DecodedTransfer[]
  feeNativeEth?: number
  feeUsd?: number
}

export interface NFT {
  name: string
  collection: string
  tokenId: string
  imageUrl?: string
}

export interface ChainBreakdown {
  chain: string
  chainId: number
  usdValue: number
  nativeSymbol: string
}

export interface WalletData {
  address: string
  ensName?: string
  ethBalance: string
  ethBalanceUsd: number
  netWorthUsd: number
  tokens: TokenBalance[]
  nativeBalances: NativeBalance[]
  chainBreakdown: ChainBreakdown[]
  transactions: Transaction[]
  nfts: NFT[]
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'
  riskReason: string
  topHoldingPct: number
  stablecoinPct: number
  chain: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  address: string
  messages: ChatMessage[]
  walletData?: WalletData // cached on frontend
}

export interface SendEthIntent {
  type: 'SEND_ETH'
  to: string
  amount: string   // human-readable ETH (e.g. "0.1")
  reason: string
  chainId?: number // defaults to 1 (Ethereum mainnet)
}

export interface SendTokenIntent {
  type: 'SEND_TOKEN'
  to: string           // recipient address
  amount: string       // human-readable token amount (e.g. "100")
  tokenSymbol: string  // e.g. "USDC"
  tokenName: string    // e.g. "USD Coin"
  tokenAddress: string // ERC-20 contract address
  decimals: number     // token decimals
  chainId: number      // EVM chain ID
  reason: string
}

export type SendTxIntent = SendEthIntent | SendTokenIntent

export interface ChatResponse {
  reply: string
  txIntent?: SendTxIntent // if user wants to send funds
  threadId?: string
  remainingCredits?: number
}

export interface FearGreedData {
  value: number
  label: 'Extreme Fear' | 'Fear' | 'Neutral' | 'Greed' | 'Extreme Greed'
  timestamp: number
  trend: string
  history: Array<{ value: number; timestamp: number }>
}

export interface NewsItem {
  id: string
  title: string
  summary: string
  url: string
  source: string
  publishedAt: number
  sentiment: 'bullish' | 'bearish' | 'neutral'
  relatedTokens: string[]
  importance: 'high' | 'medium' | 'low'
}

export interface PortfolioImpact {
  token: 'ETH'
  holdingUsd: number
  percentOfPortfolio: number
  priceChange24h: number
  relatedNewsCount: number
  sentiment: 'bullish' | 'bearish' | 'mixed' | 'neutral'
  topNewsItem?: NewsItem
}

export interface MarketContext {
  fearGreed: FearGreedData
  allNews: NewsItem[]
  relevantNews: NewsItem[]
  portfolioImpact: PortfolioImpact[]
  latestNewsInsights: MarketNewsInsight[]
  fetchedAt: number
}

export interface MarketNewsInsight {
  id: string
  title: string
  summary: string
  sentiment: 'bullish' | 'bearish' | 'neutral'
  aiReasoning: string
  fearGreedConnection: string
  url: string
  source: string
  publishedAt: number
}
