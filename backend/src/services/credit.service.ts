import { prisma } from '../lib/prisma.js'

const DEFAULT_LIFETIME_CREDITS = Number(process.env.DEFAULT_LIFETIME_CREDITS ?? 100)
const CHAT_CREDIT_COST = Number(process.env.CHAT_CREDIT_COST ?? 1)

export class InsufficientCreditsError extends Error {
  remainingCredits: number

  constructor(remainingCredits: number) {
    super('Insufficient credits')
    this.name = 'InsufficientCreditsError'
    this.remainingCredits = remainingCredits
  }
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase()
}

function clampNonNegativeInt(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 0) return fallback
  return Math.floor(value)
}

export async function getOrCreateCreditAccount(address: string) {
  const normalizedAddress = normalizeAddress(address)
  const defaultTotal = clampNonNegativeInt(DEFAULT_LIFETIME_CREDITS, 100)
  return prisma.userCredit.upsert({
    where: { address: normalizedAddress },
    update: {},
    create: {
      address: normalizedAddress,
      creditsTotal: defaultTotal,
      creditsUsed: 0,
    },
  })
}

export async function getRemainingCredits(address: string): Promise<number> {
  const account = await getOrCreateCreditAccount(address)
  return Math.max(0, account.creditsTotal - account.creditsUsed)
}

export async function getCreditSummary(address: string): Promise<{
  creditsTotal: number
  creditsUsed: number
  remainingCredits: number
}> {
  const account = await getOrCreateCreditAccount(address)
  return {
    creditsTotal: account.creditsTotal,
    creditsUsed: account.creditsUsed,
    remainingCredits: Math.max(0, account.creditsTotal - account.creditsUsed),
  }
}

export async function consumeCreditsAtomic(input: {
  address: string
  cost: number
  reason: string
  requestId: string
}): Promise<{ remainingCredits: number; alreadyProcessed: boolean }> {
  const normalizedAddress = normalizeAddress(input.address)
  const cost = Math.max(0, Math.floor(input.cost))

  return prisma.$transaction(async (tx) => {
    const existing = await tx.creditUsageEvent.findUnique({
      where: { requestId: input.requestId },
      include: { account: true },
    })
    if (existing) {
      return {
        remainingCredits: Math.max(0, existing.account.creditsTotal - existing.account.creditsUsed),
        alreadyProcessed: true,
      }
    }

    const defaultTotal = clampNonNegativeInt(DEFAULT_LIFETIME_CREDITS, 100)
    const account = await tx.userCredit.upsert({
      where: { address: normalizedAddress },
      update: {},
      create: {
        address: normalizedAddress,
        creditsTotal: defaultTotal,
        creditsUsed: 0,
      },
    })

    const remaining = Math.max(0, account.creditsTotal - account.creditsUsed)
    if (cost > remaining) {
      throw new InsufficientCreditsError(remaining)
    }

    const updated = await tx.userCredit.update({
      where: { address: normalizedAddress },
      data: { creditsUsed: { increment: cost } },
    })

    await tx.creditUsageEvent.create({
      data: {
        address: normalizedAddress,
        cost,
        reason: input.reason,
        requestId: input.requestId,
      },
    })

    return {
      remainingCredits: Math.max(0, updated.creditsTotal - updated.creditsUsed),
      alreadyProcessed: false,
    }
  })
}

export function getChatCreditCost(): number {
  return Math.max(0, Math.floor(CHAT_CREDIT_COST))
}
