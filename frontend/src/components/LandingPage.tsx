import { useState, useEffect } from 'react'
import {
  NetworkEthereum,
  NetworkArbitrumOne,
  NetworkPolygon,
  NetworkOptimism,
  NetworkBase,
  NetworkAvalanche,
  NetworkBinanceSmartChain,
  NetworkFantom,
  NetworkZksync,
  NetworkLinea,
  NetworkScroll,
  NetworkBlast,
  NetworkMantle,
  NetworkCelo,
  NetworkGnosis,
  NetworkMoonbeam,
} from '@web3icons/react'
import { useTheme } from '../lib/theme.js'

// ── Icons ─────────────────────────────────────────────────────────────────────

const SunIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M8 1.5V3M8 13V14.5M14.5 8H13M3 8H1.5M12.4 3.6L11.3 4.7M4.7 11.3L3.6 12.4M12.4 12.4L11.3 11.3M4.7 4.7L3.6 3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)
const MoonIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
    <path d="M13.5 9A5.5 5.5 0 0 1 7 2.5c0-.28.02-.56.06-.83A6.5 6.5 0 1 0 13.83 9.44 5.5 5.5 0 0 1 13.5 9Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)

// ── Dashboard preview mockup ───────────────────────────────────────────────────

const MOCK_TOKENS = [
  { sym: 'ETH',  name: 'Ethereum',  val: '$3,821',  pct: '61.4%', chg: '+2.4%',  up: true,  color: '#627EEA' },
  { sym: 'USDC', name: 'USD Coin',  val: '$1,200',  pct: '19.3%', chg: '+0.01%', up: true,  color: '#2775CA' },
  { sym: 'ARB',  name: 'Arbitrum',  val: '$540',    pct: '8.7%',  chg: '-1.2%',  up: false, color: '#12AAFF' },
  { sym: 'UNI',  name: 'Uniswap',   val: '$260',    pct: '4.2%',  chg: '+5.1%',  up: true,  color: '#FF007A' },
]

const MOCK_CHAINS = [
  { name: 'Ethereum', pct: 61, color: '#627EEA' },
  { name: 'Arbitrum', pct: 22, color: '#12AAFF' },
  { name: 'Base',     pct: 10, color: '#0052FF' },
  { name: 'Other',    pct: 7,  color: '#8247E5' },
]

function DashboardPreview() {
  return (
    <div style={previewOuter}>
      {/* Glow behind card */}
      <div style={previewGlow} />

      <div style={previewCard}>
        {/* Card top bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', letterSpacing: '-0.02em' }}>Ø</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em' }}>RACLE</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 999, padding: '2px 8px' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#22C55E', boxShadow: '0 0 4px #22C55E', animation: 'pulse-dot 2s ease-in-out infinite', display: 'inline-block' }} />
            <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.1em', color: '#22C55E' }}>LIVE</span>
          </div>
        </div>

        {/* Net worth */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-5)', letterSpacing: '0.12em', marginBottom: 4 }}>TOTAL NET WORTH</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
            $6,228<span style={{ fontSize: 16, color: 'var(--text-4)' }}>.40</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: '#22C55E', background: 'rgba(34,197,94,0.1)', borderRadius: 999, padding: '1px 7px', letterSpacing: 0.5 }}>● LOW RISK</span>
            <span style={{ fontSize: 10, color: 'var(--text-5)' }}>4 chains · 12 tokens</span>
          </div>
        </div>

        {/* Chain allocation bar */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ height: 4, borderRadius: 2, display: 'flex', overflow: 'hidden', gap: 1, marginBottom: 8 }}>
            {MOCK_CHAINS.map(c => (
              <div key={c.name} style={{ width: `${c.pct}%`, background: c.color, height: '100%' }} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {MOCK_CHAINS.map(c => (
              <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: c.color }} />
                <span style={{ fontSize: 9, color: 'var(--text-5)' }}>{c.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'var(--border)', marginBottom: 12 }} />

        {/* Token rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {MOCK_TOKENS.map(t => (
            <div key={t.sym} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px', borderRadius: 7 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                background: `${t.color}20`, border: `1px solid ${t.color}40`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: t.color }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', lineHeight: 1.2 }}>{t.sym}</div>
                <div style={{ fontSize: 9, color: 'var(--text-5)' }}>{t.name}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{t.val}</div>
                <div style={{ fontSize: 9, color: t.up ? '#22C55E' : '#EF4444', fontWeight: 600 }}>{t.chg}</div>
              </div>
            </div>
          ))}
        </div>

        {/* AI hint */}
        <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 8, background: 'var(--accent-glow)', border: '1px solid var(--accent-bd)' }}>
          <div style={{ fontSize: 9, color: 'var(--accent)', letterSpacing: '0.1em', fontWeight: 700, marginBottom: 4 }}>Ø ANALYSIS</div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
            Portfolio is well-diversified with low concentration risk. ETH dominance at 61% is healthy for current market conditions.
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Chain marquee ─────────────────────────────────────────────────────────────

type NetworkItem = typeof NETWORKS[number]

function NetworkPill({ name, abbr, Icon }: NetworkItem) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 9,
      padding: '7px 14px',
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 8, flexShrink: 0,
      whiteSpace: 'nowrap' as const,
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 6,
        background: 'var(--bg-muted)', border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, overflow: 'hidden',
      }}>
        <Icon variant="branded" size={18} />
      </div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text)', lineHeight: 1.2 }}>{name}</div>
        <div style={{ fontSize: 9, color: 'var(--text-5)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>{abbr}</div>
      </div>
    </div>
  )
}

function MarqueeRow({ items, duration, reverse }: { items: NetworkItem[]; duration: number; reverse: boolean }) {
  return (
    <div style={{ position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 60, background: 'linear-gradient(90deg, var(--bg) 0%, transparent 100%)', zIndex: 2, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 60, background: 'linear-gradient(270deg, var(--bg) 0%, transparent 100%)', zIndex: 2, pointerEvents: 'none' }} />
      <div style={{ display: 'flex', overflow: 'hidden' }}>
        <div style={{
          display: 'flex', gap: 8,
          animation: `networks-scroll ${duration}s linear infinite${reverse ? ' reverse' : ''}`,
          willChange: 'transform',
        }}>
          {items.map((n, i) => <NetworkPill key={i} {...n} />)}
        </div>
      </div>
    </div>
  )
}

// ── Features ──────────────────────────────────────────────────────────────────

const FEATURES = [
  { icon: '◈', label: 'Multi-Chain Portfolio' },
  { icon: '◎', label: 'AI Assistant' },
  { icon: '⇄', label: 'Intent Transfers' },
  { icon: '◐', label: 'Market Intelligence' },
  { icon: '⬡', label: 'Risk Analysis' },
  { icon: '◷', label: 'Transaction History' },
]

const NETWORKS = [
  { name: 'Ethereum',   abbr: 'ETH',    Icon: NetworkEthereum          },
  { name: 'Arbitrum',   abbr: 'ARB',    Icon: NetworkArbitrumOne       },
  { name: 'Polygon',    abbr: 'MATIC',  Icon: NetworkPolygon           },
  { name: 'Optimism',   abbr: 'OP',     Icon: NetworkOptimism          },
  { name: 'Base',       abbr: 'BASE',   Icon: NetworkBase              },
  { name: 'Avalanche',  abbr: 'AVAX',   Icon: NetworkAvalanche         },
  { name: 'BNB Chain',  abbr: 'BNB',    Icon: NetworkBinanceSmartChain },
  { name: 'Fantom',     abbr: 'FTM',    Icon: NetworkFantom            },
  { name: 'zkSync Era', abbr: 'ZK',     Icon: NetworkZksync            },
  { name: 'Linea',      abbr: 'LINEA',  Icon: NetworkLinea             },
  { name: 'Scroll',     abbr: 'SCROLL', Icon: NetworkScroll            },
  { name: 'Blast',      abbr: 'BLAST',  Icon: NetworkBlast             },
  { name: 'Mantle',     abbr: 'MNT',    Icon: NetworkMantle            },
  { name: 'Celo',       abbr: 'CELO',   Icon: NetworkCelo              },
  { name: 'Gnosis',     abbr: 'GNO',    Icon: NetworkGnosis            },
  { name: 'Moonbeam',   abbr: 'GLMR',   Icon: NetworkMoonbeam          },
]

const ROW1 = [...NETWORKS.slice(0, 8),  ...NETWORKS.slice(0, 8)]
const ROW2 = [...NETWORKS.slice(8, 16), ...NETWORKS.slice(8, 16)]

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  onConnect: () => void
  whaleWallets: Array<{ label: string; address: string }>
  onExploreWallet: (address: string) => void
}

export function LandingPage({ onConnect, whaleWallets, onExploreWallet }: Props) {
  const { theme, toggle } = useTheme()
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  const [selectedWallet, setSelectedWallet] = useState('')
  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])

  return (
    <div style={{ ...root, overflow: isMobile ? 'auto' : 'hidden' }}>

      {/* Background glow */}
      <div style={bgGlow} />

      {/* ── Nav ── */}
      <nav style={nav}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)', letterSpacing: '-0.02em', lineHeight: 1 }}>Ø</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em', lineHeight: 1 }}>RACLE</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={toggle} style={themeBtn} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
            <span style={{ display: 'flex', color: 'var(--text-4)' }}>
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </span>
          </button>
          <button style={connectBtnNav} onClick={onConnect}>
            Connect Wallet
          </button>
        </div>
      </nav>

      {/* ── Main split layout ── */}
      <div style={{
        ...main,
        flexDirection: isMobile ? 'column' : 'row',
        padding: isMobile ? '24px 20px' : '0 40px 0 60px',
        alignItems: isMobile ? 'flex-start' : 'center',
        overflowY: isMobile ? 'auto' : 'hidden',
      }}>

        {/* ── LEFT: Hero content ── */}
        <div style={{ ...leftCol, ...(isMobile ? { width: '100%' } : {}) }}>

          {/* Live badge */}
          <div style={badge}>
            <span style={badgeDot} />
            <span>LIVE ON MAINNET</span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>BLOCKCHAIN INTELLIGENCE</span>
          </div>

          {/* Headline */}
          <h1 style={{ ...headline, fontSize: isMobile ? 'clamp(36px, 10vw, 52px)' : 'clamp(38px, 4vw, 58px)' }}>
            Your wallet.<br />
            <span style={headlineAccent}>Understood.</span>
          </h1>

          {/* Subtitle */}
          <p style={{ ...subtitle, maxWidth: isMobile ? '100%' : 440 }}>
            Connect once. See everything — balances, risk, transactions,
            market context, and an AI that actually knows your on-chain history.
          </p>

          {/* CTA */}
          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'flex-start' : 'center', gap: 12, marginBottom: 20 }}>
            <button style={ctaBtn} onClick={onConnect}>
              Connect Wallet
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <span style={{ fontSize: 11, color: 'var(--text-5)' }}>
              Non-custodial · Read-only
            </span>
          </div>

          <div style={exploreCard}>
            <div style={{ fontSize: 11, color: 'var(--text-5)', marginBottom: 6, letterSpacing: '0.03em' }}>
              EXPLORE POPULAR WALLETS
            </div>
            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 8 }}>
              <select
                value={selectedWallet}
                onChange={(event) => setSelectedWallet(event.target.value)}
                style={presetSelect}
              >
                <option value="">Select a whale wallet</option>
                {whaleWallets.map((wallet) => (
                  <option key={wallet.address} value={wallet.address}>
                    {wallet.label} ({wallet.address.slice(0, 6)}...{wallet.address.slice(-4)})
                  </option>
                ))}
              </select>
              <button
                style={{ ...connectBtnNav, opacity: selectedWallet ? 1 : 0.45 }}
                disabled={!selectedWallet}
                onClick={() => selectedWallet && onExploreWallet(selectedWallet)}
              >
                Explore
              </button>
            </div>
          </div>

          {/* Feature pills */}
          <div style={featurePills}>
            {FEATURES.map(f => (
              <div key={f.label} style={pill}>
                <span style={{ color: 'var(--accent)', fontSize: 10 }}>{f.icon}</span>
                <span>{f.label}</span>
              </div>
            ))}
          </div>

          {/* Chain marquee */}
          <div style={{ width: '100%', maxWidth: isMobile ? '100%' : 500 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-6)', letterSpacing: '0.1em' }}>16+ EVM CHAINS</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', background: 'var(--accent-glow)', border: '1px solid var(--accent-bd)', borderRadius: 999, fontSize: 9, color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.08em' }}>
                <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', animation: 'pulse-dot 2s ease-in-out infinite' }} />
                MORE COMING
              </span>
            </div>
            <MarqueeRow items={ROW1} duration={28} reverse={false} />
            <div style={{ height: 6 }} />
            <MarqueeRow items={ROW2} duration={34} reverse={true} />
          </div>

        </div>

        {/* ── RIGHT: Dashboard preview ── */}
        <div style={{ ...rightCol, display: isMobile ? 'none' : 'flex' }}>
          <DashboardPreview />
        </div>

      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const root: React.CSSProperties = {
  height: '100vh',
  overflow: 'hidden',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontFamily: 'var(--font-body)',
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  transition: 'background 0.2s ease, color 0.2s ease',
}

const bgGlow: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  background: 'radial-gradient(ellipse 900px 700px at 30% 60%, rgba(99,102,241,0.1) 0%, transparent 70%)',
  zIndex: 0,
}

const nav: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '0 40px',
  height: 52,
  flexShrink: 0,
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg)',
  position: 'relative',
  zIndex: 10,
  transition: 'background 0.2s ease, border-color 0.2s ease',
}

const themeBtn: React.CSSProperties = {
  width: 32, height: 32,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 8,
  cursor: 'pointer',
  transition: 'border-color 0.15s',
}

const connectBtnNav: React.CSSProperties = {
  height: 32,
  padding: '0 16px',
  background: 'var(--accent)',
  border: 'none',
  borderRadius: 8,
  color: '#fff',
  fontSize: 13,
  fontWeight: 500,
  fontFamily: 'var(--font-body)',
  cursor: 'pointer',
  letterSpacing: '-0.01em',
}

const exploreCard: React.CSSProperties = {
  width: '100%',
  maxWidth: 460,
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '10px 12px',
  marginBottom: 20,
}

const presetSelect: React.CSSProperties = {
  flex: 1,
  background: 'var(--bg)',
  border: '1px solid var(--border-sub)',
  borderRadius: 8,
  color: 'var(--text)',
  fontSize: 13,
  fontFamily: 'var(--font-body)',
  padding: '0 12px',
  height: 34,
}

const main: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  padding: '0 40px 0 60px',
  gap: 60,
  position: 'relative',
  zIndex: 1,
  overflow: 'hidden',
}

const leftCol: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  justifyContent: 'center',
  minWidth: 0,
}

const rightCol: React.CSSProperties = {
  flexShrink: 0,
  width: 380,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const badge: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.1em',
  color: 'var(--accent)',
  background: 'var(--accent-glow)',
  border: '1px solid var(--accent-bd)',
  borderRadius: 999,
  padding: '4px 12px',
  marginBottom: 22,
}

const badgeDot: React.CSSProperties = {
  width: 5,
  height: 5,
  borderRadius: '50%',
  background: 'var(--accent)',
  flexShrink: 0,
  animation: 'pulse-dot 2s ease-in-out infinite',
  display: 'inline-block',
}

const headline: React.CSSProperties = {
  fontSize: 'clamp(38px, 4vw, 58px)',
  fontWeight: 700,
  color: 'var(--text)',
  letterSpacing: '-0.04em',
  lineHeight: 1.05,
  marginBottom: 16,
  margin: '0 0 16px',
}

const headlineAccent: React.CSSProperties = {
  background: 'linear-gradient(135deg, #818CF8 0%, #6366F1 50%, #A78BFA 100%)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
}

const subtitle: React.CSSProperties = {
  fontSize: 15,
  color: 'var(--text-4)',
  lineHeight: 1.7,
  maxWidth: 440,
  margin: '0 0 24px',
}

const ctaBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  height: 44,
  padding: '0 22px',
  background: 'var(--accent)',
  border: 'none',
  borderRadius: 10,
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
  fontFamily: 'var(--font-body)',
  cursor: 'pointer',
  letterSpacing: '-0.01em',
  boxShadow: '0 0 32px rgba(99,102,241,0.4), 0 0 0 1px rgba(99,102,241,0.3)',
  transition: 'box-shadow 0.2s ease, transform 0.15s ease',
}

const featurePills: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  marginBottom: 24,
}

const pill: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '5px 10px',
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontSize: 11,
  color: 'var(--text-4)',
  fontWeight: 500,
  letterSpacing: '-0.01em',
  transition: 'border-color 0.15s',
}


// Dashboard preview styles
const previewOuter: React.CSSProperties = {
  position: 'relative',
  width: '100%',
}

const previewGlow: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: 340,
  height: 340,
  background: 'radial-gradient(circle, rgba(99,102,241,0.18) 0%, transparent 70%)',
  pointerEvents: 'none',
  zIndex: 0,
}

const previewCard: React.CSSProperties = {
  position: 'relative',
  zIndex: 1,
  background: 'var(--bg-card)',
  border: '1px solid var(--border-sub)',
  borderRadius: 16,
  padding: '20px 20px',
  boxShadow: '0 0 60px rgba(99,102,241,0.15), 0 24px 80px rgba(0,0,0,0.4)',
  backdropFilter: 'blur(20px)',
}
