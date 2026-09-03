import { prisma } from '../lib/prisma.js'
import { fetchWalletData } from './wallet.service.js'
import type { WalletData } from '../types/index.js'

function normalizeAddress(address: string): string {
  return address.toLowerCase()
}

const refreshing = new Set<string>()
const lastManualRefresh = new Map<string, number>()

const COOLDOWN_MS = Math.max(
  0,
  Number.parseInt(process.env.WALLET_REFRESH_COOLDOWN_MS ?? '30000', 10) || 30000
)

export function getSnapshotTtlMs(): number {
  const n = Number.parseInt(process.env.WALLET_SNAPSHOT_TTL_MS ?? '3600000', 10)
  return Number.isFinite(n) && n > 0 ? n : 3600000
}

export async function getSnapshotRow(address: string) {
  return prisma.walletSnapshot.findUnique({
    where: { address: normalizeAddress(address) },
  })
}

export async function getWalletFromDb(address: string): Promise<WalletData | null> {
  const row = await getSnapshotRow(address)
  if (!row) return null
  return row.payload as unknown as WalletData
}

export async function refreshWalletSnapshot(address: string): Promise<WalletData> {
  const addr = normalizeAddress(address)
  const maxWaitMs = 120_000
  const start = Date.now()
  while (refreshing.has(addr)) {
    if (Date.now() - start > maxWaitMs) {
      const stale = await getWalletFromDb(address)
      if (stale) return stale
      throw new Error('Wallet refresh timed out')
    }
    await new Promise((r) => setTimeout(r, 200))
  }

  refreshing.add(addr)
  try {
    if (process.env.WALLET_LOG_INDEXER === '1') {
      console.log('[wallet-indexer] calling Zerion/Moralis fetch for', addr)
    }
    const wallet = await fetchWalletData(address)
    await prisma.walletSnapshot.upsert({
      where: { address: addr },
      create: { address: addr, payload: wallet as object },
      update: { payload: wallet as object },
    })
    return wallet
  } finally {
    refreshing.delete(addr)
  }
}

export async function getWalletForRead(address: string): Promise<{
  wallet: WalletData
  snapshotUpdatedAt: Date
  hydratedFromIndexer: boolean
}> {
  const addr = normalizeAddress(address)

  const row = await prisma.walletSnapshot.findUnique({ where: { address: addr } })
  if (row) {
    const ttl = getSnapshotTtlMs()
    const ageMs = Date.now() - row.updatedAt.getTime()
    if (ageMs < ttl) {
      return {
        wallet: row.payload as unknown as WalletData,
        snapshotUpdatedAt: row.updatedAt,
        hydratedFromIndexer: false,
      }
    }
    const wallet = await refreshWalletSnapshot(address)
    const again = await prisma.walletSnapshot.findUniqueOrThrow({ where: { address: addr } })
    return {
      wallet,
      snapshotUpdatedAt: again.updatedAt,
      hydratedFromIndexer: true,
    }
  }

  const wallet = await refreshWalletSnapshot(address)
  const again = await prisma.walletSnapshot.findUniqueOrThrow({ where: { address: addr } })
  return {
    wallet,
    snapshotUpdatedAt: again.updatedAt,
    hydratedFromIndexer: true,
  }
}

export function canManualRefresh(address: string): { ok: true } | { ok: false; retryAfterMs: number } {
  const addr = normalizeAddress(address)
  const last = lastManualRefresh.get(addr)
  if (last == null) return { ok: true }
  const elapsed = Date.now() - last
  if (elapsed >= COOLDOWN_MS) return { ok: true }
  return { ok: false, retryAfterMs: COOLDOWN_MS - elapsed }
}

export function markManualRefresh(address: string): void {
  lastManualRefresh.set(normalizeAddress(address), Date.now())
}

