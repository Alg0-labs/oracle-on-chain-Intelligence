import type { ChatRole } from '@prisma/client'
import { prisma } from '../lib/prisma.js'

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase()
}

async function getLatestThreadForAddress(address: string) {
  const normalizedAddress = normalizeAddress(address)
  return prisma.chatThread.findFirst({
    where: { address: normalizedAddress },
    orderBy: { updatedAt: 'desc' },
  })
}

export async function getOrCreateLatestThread(address: string) {
  const thread = await getLatestThreadForAddress(address)
  if (thread) return thread
  return prisma.chatThread.create({
    data: {
      address: normalizeAddress(address),
      title: null,
    },
  })
}

export async function createThread(address: string, title?: string | null) {
  return prisma.chatThread.create({
    data: {
      address: normalizeAddress(address),
      title: title?.trim() || null,
    },
  })
}

export async function renameThread(address: string, threadId: string, title: string) {
  const normalizedAddress = normalizeAddress(address)
  return prisma.chatThread.updateMany({
    where: { id: threadId, address: normalizedAddress },
    data: { title: title.trim() || null },
  })
}

export async function listThreads(address: string, limit = 50) {
  const normalizedAddress = normalizeAddress(address)
  const threads = await prisma.chatThread.findMany({
    where: { address: normalizedAddress },
    orderBy: { updatedAt: 'desc' },
    take: Math.max(1, Math.min(100, limit)),
  })
  return threads.map((t) => ({
    id: t.id,
    title: t.title,
    updatedAt: t.updatedAt,
    createdAt: t.createdAt,
  }))
}

export async function appendMessages(
  threadId: string,
  messages: Array<{ role: ChatRole; content: string }>
): Promise<void> {
  if (messages.length === 0) return

  await prisma.$transaction(async (tx) => {
    await tx.chatMessage.createMany({
      data: messages.map((message) => ({
        threadId,
        role: message.role,
        content: message.content,
      })),
    })
    await tx.chatThread.update({
      where: { id: threadId },
      data: { updatedAt: new Date() },
    })
  })
}

export async function listLatestThreadMessages(address: string, limit = 100) {
  const thread = await getLatestThreadForAddress(address)
  if (!thread) return { threadId: null, messages: [] as Array<{ role: ChatRole; content: string; createdAt: Date }> }

  const rows = await prisma.chatMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: 'asc' },
    take: Math.max(1, Math.min(500, limit)),
  })

  return {
    threadId: thread.id,
    messages: rows.map((row) => ({
      role: row.role,
      content: row.content,
      createdAt: row.createdAt,
    })),
  }
}

export async function listThreadMessagesById(address: string, threadId: string, limit = 100) {
  const normalizedAddress = normalizeAddress(address)
  const thread = await prisma.chatThread.findFirst({
    where: { id: threadId, address: normalizedAddress },
  })
  if (!thread) return { threadId: null, messages: [] as Array<{ role: ChatRole; content: string; createdAt: Date }> }

  const rows = await prisma.chatMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: 'asc' },
    take: Math.max(1, Math.min(500, limit)),
  })

  return {
    threadId: thread.id,
    messages: rows.map((row) => ({
      role: row.role,
      content: row.content,
      createdAt: row.createdAt,
    })),
  }
}
