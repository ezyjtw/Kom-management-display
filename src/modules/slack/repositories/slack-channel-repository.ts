/**
 * SlackChannel repository — data access layer for the SlackChannel model.
 */
import { prisma } from "@/lib/prisma";
import type { SlackChannel } from "@prisma/client";

export async function findByChannelId(channelId: string): Promise<SlackChannel | null> {
  return prisma.slackChannel.findUnique({
    where: { channelId },
  });
}

export async function findAllActive(): Promise<SlackChannel[]> {
  return prisma.slackChannel.findMany({
    where: { isActive: true },
    orderBy: { channelName: "asc" },
  });
}

export async function updateCursor(channelId: string, cursor: string): Promise<void> {
  await prisma.slackChannel.update({
    where: { channelId },
    data: {
      syncCursor: cursor,
      lastSyncedAt: new Date(),
    },
  });
}

/** Default purpose for a legacy channelType (spec §8.4 purposes). */
export function purposeForType(channelType: string): string {
  return channelType === "client" ? "client" : channelType === "service_provider" ? "vendor" : "internal_ops";
}

export async function upsertChannel(data: {
  channelId: string;
  channelName: string;
  channelType: string;
  linkedEntityId?: string | null;
  isActive?: boolean;
  purpose?: string;
  clientId?: string | null;
}): Promise<SlackChannel> {
  const purpose = data.purpose ?? purposeForType(data.channelType);
  return prisma.slackChannel.upsert({
    where: { channelId: data.channelId },
    create: {
      channelId: data.channelId,
      channelName: data.channelName,
      channelType: data.channelType,
      linkedEntityId: data.linkedEntityId ?? null,
      isActive: data.isActive ?? true,
      purpose,
      clientId: data.clientId ?? null,
    },
    update: {
      channelName: data.channelName,
      channelType: data.channelType,
      linkedEntityId: data.linkedEntityId ?? null,
      isActive: data.isActive ?? true,
      purpose,
      clientId: data.clientId ?? null,
    },
  });
}

export async function findAll(): Promise<SlackChannel[]> {
  return prisma.slackChannel.findMany({
    orderBy: { channelName: "asc" },
  });
}

export async function findById(id: string): Promise<SlackChannel | null> {
  return prisma.slackChannel.findUnique({
    where: { id },
  });
}

export async function updateChannel(
  id: string,
  data: {
    channelType?: string;
    linkedEntityId?: string | null;
    isActive?: boolean;
    purpose?: string;
    clientId?: string | null;
  },
): Promise<SlackChannel> {
  return prisma.slackChannel.update({
    where: { id },
    data,
  });
}
