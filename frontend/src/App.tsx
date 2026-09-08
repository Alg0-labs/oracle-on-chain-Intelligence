import { useState, useEffect } from 'react'
import { useAppKit } from '@reown/appkit/react'
import { useAccount } from 'wagmi'
import { ChatPanel } from './components/ChatPanel.js'
import { PortfolioPanel } from './components/PortfolioPanel.js'
import { OverviewPanel } from './components/OverviewPanel.js'
import { MarketPanel } from './components/MarketPanel.js'
import { TransactionsPanel } from './components/TransactionsPanel.js'
import { Sidebar } from './components/Sidebar.js'
import type { Page } from './components/Sidebar.js'
import { LandingPage } from './components/LandingPage.js'
import { fetchWallet, fetchMarket, refreshWallet, fetchWalletPresets } from './lib/api.js'
import { useTheme } from './lib/theme.js'
import type { WalletData, MarketData } from './types/index.js'


export default function App() {
  const { address, isConnected } = useAccount()
  const { open } = useAppKit()
  const { theme, toggle } = useTheme()

  const [wallet, setWallet]   = useState<WalletData | null>(null)
  const [market, setMarket]   = useState<MarketData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [page,    setPage]    = useState<Page>('overview')
  const [snapshotUpdatedAt, setSnapshotUpdatedAt] = useState<string | null>(null)
  const [refreshing, setRefreshing]               = useState(false)
  const [refreshError, setRefreshError]           = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [selectedPresetAddress, setSelectedPresetAddress] = useState<string | null>(null)
  const [walletPresets, setWalletPresets] = useState<Array<{ label: string; address: string }>>([])
  const isAnonymousPreset = !isConnected && !!selectedPresetAddress
  const activeAddress = isConnected ? address ?? null : selectedPresetAddress

  useEffect(() => {
    const fn = () => {
      const mobile = window.innerWidth < 768
      setIsMobile(mobile)
      if (!mobile) setSidebarOpen(false)
    }
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])

  useEffect(() => {
    if (!activeAddress) {
      setWallet(null); setMarket(null); setSnapshotUpdatedAt(null)
      setLoading(false); setError(null)
      return
    }
    let cancelled = false
    setLoading(true); setError(null)
    Promise.all([fetchWallet(activeAddress), fetchMarket(activeAddress)])
      .then(([wRes, marketData]) => {
        if (cancelled) return
        setWallet(wRes.wallet)
        setSnapshotUpdatedAt(wRes.snapshotUpdatedAt)
        setMarket(marketData)
      })
      .catch(err => { if (!cancelled) setError(err.message ?? 'Failed to load wallet') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [activeAddress])

  useEffect(() => {
    fetchWalletPresets()
      .then((wallets) => setWalletPresets(wallets))
      .catch(() => setWalletPresets([]))
  }, [])

  const handleRefresh = () => {
    if (!activeAddress || refreshing || isAnonymousPreset) return
    setRefreshing(true); setRefreshError(null)
    refreshWallet(activeAddress)
      .then(wRes => {
        setWallet(wRes.wallet)
        setSnapshotUpdatedAt(wRes.snapshotUpdatedAt)
        return fetchMarket(activeAddress)
      })
      .then(md => setMarket(md))
      .catch(err => setRefreshError(err.message ?? 'Refresh failed'))
      .finally(() => setRefreshing(false))
  }

  // ── Landing ──────────────────────────────────────────────────────────────────
  if (!isConnected && !selectedPresetAddress) {
    return (
      <LandingPage
        onConnect={() => open()}
        whaleWallets={walletPresets}
        onExploreWallet={(walletAddress) => setSelectedPresetAddress(walletAddress)}
      />
    )
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={stateRoot}>
        <div style={loadingCenter}>
          <div style={spinner} />
          <p style={loadTitle}>Indexing {activeAddress?.slice(0, 10)}…</p>
          <p style={loadSub}>Fetching balances, tokens & transactions</p>
        </div>
      </div>
    )
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div style={stateRoot}>
        <div style={loadingCenter}>
          <div style={errorCard}>
            <p style={{ fontSize: 13, color: '#EF4444', margin: 0 }}>{error}</p>
          </div>
          <button
            style={{ background: 'var(--accent-dim)', color: '#fff', border: 'none', borderRadius: 8, height: 36, padding: '0 16px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
            onClick={() => open()}
          >
            Retry / Switch Wallet
          </button>
        </div>
      </div>
    )
  }

  if (!wallet) return null

  // ── Main app ─────────────────────────────────────────────────────────────────
  return (
    <div style={appRoot}>
      {/* Mobile overlay backdrop */}
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 9, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
        />
      )}

      {/* Fixed sidebar */}
      <Sidebar
        page={page}
        setPage={(p) => { setPage(p); if (isMobile) setSidebarOpen(false) }}
        wallet={wallet}
        address={activeAddress ?? undefined}
        theme={theme}
        onToggleTheme={toggle}
        isMobile={isMobile}
        isOpen={sidebarOpen}
      />

      {/* Fixed top-right action bar: refresh + wallet modal */}
      <div style={walletTopRight}>
        {isMobile && (
          <button
            onClick={() => setSidebarOpen(v => !v)}
            style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 32, height: 32, padding: '6px 5px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', justifyContent: 'center' }}
            aria-label="Toggle sidebar"
          >
            <span style={{ width: '100%', height: 2, background: 'var(--text-3)', borderRadius: 1, display: 'block' }} />
            <span style={{ width: '100%', height: 2, background: 'var(--text-3)', borderRadius: 1, display: 'block' }} />
            <span style={{ width: '100%', height: 2, background: 'var(--text-3)', borderRadius: 1, display: 'block' }} />
          </button>
        )}
        <button
          style={refreshTopBtn}
          onClick={handleRefresh}
          disabled={refreshing || isAnonymousPreset}
          title={isAnonymousPreset ? 'Refresh requires connected wallet mode' : 'Refresh portfolio data'}
        >
          <svg
            width="13" height="13" viewBox="0 0 16 16" fill="none"
            style={{ transition: 'transform 0.7s ease', transform: refreshing ? 'rotate(360deg)' : 'none' }}
          >
            <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5a5.5 5.5 0 0 1 4.5 2.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M13.5 2v3h-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          {refreshing ? 'Syncing…' : 'Refresh'}
        </button>
        {isConnected ? (
          <w3m-button size="sm" />
        ) : (
          <button
            style={refreshTopBtn}
            onClick={() => {
              setSelectedPresetAddress(null)
              open()
            }}
          >
            Connect Wallet
          </button>
        )}
      </div>

      {/* Main area (offset by sidebar) */}
      <div style={{ ...mainArea, marginLeft: isMobile ? 0 : 220 }}>
        {page === 'overview' && (
          <OverviewPanel
            wallet={wallet}
            market={market}
            snapshotUpdatedAt={snapshotUpdatedAt}
            refreshing={refreshing}
            onRefresh={handleRefresh}
            refreshError={refreshError}
          />
        )}
        {page === 'portfolio' && (
          <PortfolioPanel
            wallet={wallet}
            market={market}
            isMobile={false}
          />
        )}
        {page === 'chat' && (
          <ChatPanel
            wallet={wallet}
            address={wallet.address}
            snapshotUpdatedAt={snapshotUpdatedAt}
            onWalletRefresh={handleRefresh}
            canChat={isConnected || isAnonymousPreset}
            anonymousMode={isAnonymousPreset}
          />
        )}
        {page === 'transactions' && (
          <TransactionsPanel wallet={wallet} />
        )}
        {page === 'market' && (
          <MarketPanel
            market={market}
            wallet={wallet}
          />
        )}
      </div>

    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

// Loading / Error
const stateRoot: React.CSSProperties = {
  minHeight: '100vh',
  background: 'var(--bg)',
  color: 'var(--text)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'var(--font-body)',
}

const loadingCenter: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
}

const spinner: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: '50%',
  border: '2px solid var(--border)',
  borderTopColor: 'var(--accent)',
  animation: 'spin 0.8s linear infinite',
}

const loadTitle: React.CSSProperties = {
  fontSize: 14,
  color: 'var(--text-3)',
  fontFamily: 'var(--font-mono)',
}

const loadSub: React.CSSProperties = { fontSize: 12, color: 'var(--text-5)' }

const errorCard: React.CSSProperties = {
  background: 'rgba(239,68,68,0.06)',
  border: '1px solid rgba(239,68,68,0.2)',
  borderRadius: 8,
  padding: '14px 20px',
  maxWidth: 360,
}

// Main app
const appRoot: React.CSSProperties = {
  height: '100vh',
  display: 'flex',
  background: 'var(--bg)',
  overflow: 'hidden',
  position: 'relative',
  transition: 'background 0.2s ease',
}

const mainArea: React.CSSProperties = {
  flex: 1,
  marginLeft: 220,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  minWidth: 0,
}

const walletTopRight: React.CSSProperties = {
  position: 'fixed',
  top: 10,
  right: 16,
  zIndex: 200,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}

const refreshTopBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 36,
  padding: '0 12px',
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text-4)',
  fontSize: 13,
  fontWeight: 500,
  fontFamily: 'var(--font-body)',
  cursor: 'pointer',
  transition: 'border-color 0.15s, color 0.15s',
  whiteSpace: 'nowrap' as const,
}

