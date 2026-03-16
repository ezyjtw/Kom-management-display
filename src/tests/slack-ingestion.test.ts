import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───

const mockConversationsHistory = vi.fn();
const mockConversationsReplies = vi.fn();

vi.mock("@/lib/integrations/slack", () => ({
  getSlackClient: vi.fn(() => ({
    conversations: {
      history: mockConversationsHistory,
      replies: mockConversationsReplies,
    },
  })),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    integration: vi.fn(),
    job: vi.fn(),
    security: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => {
  return {
    prisma: {
      commsThread: {
        upsert: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      commsMessage: {
        upsert: vi.fn(),
      },
      slackChannel: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    },
  };
});

const mockEnqueueJob = vi.fn().mockResolvedValue("job-123");
vi.mock("@/lib/background-jobs", () => ({
  enqueueJob: (...args: any[]) => mockEnqueueJob(...args),
}));

vi.mock("@/lib/slack-rate-limiter", () => ({
  acquireSlackToken: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/circuit-breaker", () => ({
  CircuitBreaker: {
    for: () => ({
      execute: (fn: () => Promise<any>) => fn(),
    }),
  },
}));

vi.mock("@/modules/slack/repositories/slack-channel-repository", () => ({
  findByChannelId: vi.fn(),
  updateCursor: vi.fn(),
}));

vi.mock("@/lib/sanitize", () => ({
  sanitiseSlackMessage: (text: string) => text || "",
}));

vi.mock("@/lib/thread-utils", () => ({
  normaliseSubject: (text: string) => text?.substring(0, 200) || "No Subject",
  deriveAutoPriority: () => "P2",
}));

vi.mock("@/lib/sla", () => ({
  computeTtoDeadline: (date: Date) => new Date(date.getTime() + 120 * 60000),
}));

// Import AFTER mocks are set up
import { syncChannelMessages, syncThreadReplies } from "@/modules/slack/services/slack-ingestion-service";
import * as slackChannelRepo from "@/modules/slack/repositories/slack-channel-repository";
import { prisma } from "@/lib/prisma";

// ─── Fixtures ───

const CHANNEL_ID = "C01234ABCDE";
const SLACK_CHANNEL_RECORD = {
  id: "cuid-channel-1",
  channelId: CHANNEL_ID,
  channelName: "test-channel",
  channelType: "internal",
  linkedEntityId: null,
  isActive: true,
  syncCursor: null,
  lastSyncedAt: null,
  createdAt: new Date(),
};

function makeSlackMessage(overrides: Record<string, any> = {}) {
  return {
    ts: "1700000001.000001",
    text: "Hello world",
    user: "U12345",
    ...overrides,
  };
}

// ─── Tests ───

describe("syncChannelMessages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SLACK_BOT_TOKEN = "xoxb-test-token";

    vi.mocked(slackChannelRepo.findByChannelId).mockResolvedValue(SLACK_CHANNEL_RECORD as any);
    vi.mocked(slackChannelRepo.updateCursor).mockResolvedValue(undefined);

    vi.mocked(prisma.commsThread.upsert).mockResolvedValue({ id: "thread-1" } as any);
    vi.mocked(prisma.commsThread.findUnique).mockResolvedValue({ id: "thread-1" } as any);
    vi.mocked(prisma.commsMessage.upsert).mockResolvedValue({ id: "msg-1" } as any);
  });

  it("creates a CommsThread for a root message", async () => {
    const rootMsg = makeSlackMessage({ ts: "1700000001.000001" });
    mockConversationsHistory.mockResolvedValue({ messages: [rootMsg] });

    const result = await syncChannelMessages(CHANNEL_ID);

    expect(result.threadsUpserted).toBe(1);
    expect(prisma.commsThread.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          slackChannelId_slackRootTs: {
            slackChannelId: "cuid-channel-1",
            slackRootTs: "1700000001.000001",
          },
        },
        create: expect.objectContaining({
          source: "slack",
          slackRootTs: "1700000001.000001",
          isSlackThread: false,
        }),
      }),
    );
  });

  it("skips reply messages (thread_ts !== ts)", async () => {
    const replyMsg = makeSlackMessage({
      ts: "1700000002.000001",
      thread_ts: "1700000001.000001",
    });
    mockConversationsHistory.mockResolvedValue({ messages: [replyMsg] });

    const result = await syncChannelMessages(CHANNEL_ID);

    expect(result.threadsUpserted).toBe(0);
    expect(prisma.commsThread.upsert).not.toHaveBeenCalled();
  });

  it("skips channel_join and bot_message subtypes", async () => {
    const joinMsg = makeSlackMessage({ subtype: "channel_join" });
    const botMsg = makeSlackMessage({ subtype: "bot_message", ts: "1700000003.000001" });
    mockConversationsHistory.mockResolvedValue({ messages: [joinMsg, botMsg] });

    const result = await syncChannelMessages(CHANNEL_ID);

    expect(result.threadsUpserted).toBe(0);
  });

  it("enqueues sync_slack_replies job when reply_count > 0", async () => {
    const threadRoot = makeSlackMessage({
      ts: "1700000001.000001",
      thread_ts: "1700000001.000001",
      reply_count: 5,
      latest_reply: "1700000001.000099",
    });
    mockConversationsHistory.mockResolvedValue({ messages: [threadRoot] });

    const result = await syncChannelMessages(CHANNEL_ID);

    expect(result.repliesEnqueued).toBe(1);
    expect(mockEnqueueJob).toHaveBeenCalledWith(
      "sync_slack_replies",
      { channelId: CHANNEL_ID, threadTs: "1700000001.000001" },
      { deduplicationKey: `slack_replies_${CHANNEL_ID}_1700000001.000001` },
    );
  });

  it("does not enqueue reply job when reply_count is 0", async () => {
    const rootMsg = makeSlackMessage({ reply_count: 0 });
    mockConversationsHistory.mockResolvedValue({ messages: [rootMsg] });

    await syncChannelMessages(CHANNEL_ID);

    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });

  it("updates syncCursor after processing messages", async () => {
    const msg1 = makeSlackMessage({ ts: "1700000001.000001" });
    const msg2 = makeSlackMessage({ ts: "1700000002.000001" });
    mockConversationsHistory.mockResolvedValue({ messages: [msg1, msg2] });

    await syncChannelMessages(CHANNEL_ID);

    expect(slackChannelRepo.updateCursor).toHaveBeenCalledWith(
      CHANNEL_ID,
      "1700000002.000001",
    );
  });

  it("returns early when channel is not active", async () => {
    vi.mocked(slackChannelRepo.findByChannelId).mockResolvedValue({
      ...SLACK_CHANNEL_RECORD,
      isActive: false,
    } as any);

    const result = await syncChannelMessages(CHANNEL_ID);

    expect(result.threadsUpserted).toBe(0);
    expect(mockConversationsHistory).not.toHaveBeenCalled();
  });

  it("handles dedup - upserting same slackTs twice uses same unique key", async () => {
    const rootMsg = makeSlackMessage({ ts: "1700000001.000001" });
    mockConversationsHistory.mockResolvedValue({ messages: [rootMsg] });

    await syncChannelMessages(CHANNEL_ID);
    await syncChannelMessages(CHANNEL_ID);

    // upsert handles dedup at DB level via unique constraint
    expect(prisma.commsThread.upsert).toHaveBeenCalledTimes(2);
    const firstCall = vi.mocked(prisma.commsThread.upsert).mock.calls[0][0];
    const secondCall = vi.mocked(prisma.commsThread.upsert).mock.calls[1][0];
    expect(firstCall.where).toEqual(secondCall.where);
  });
});

describe("syncThreadReplies", () => {
  const THREAD_TS = "1700000001.000001";

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SLACK_BOT_TOKEN = "xoxb-test-token";

    vi.mocked(slackChannelRepo.findByChannelId).mockResolvedValue(SLACK_CHANNEL_RECORD as any);
    vi.mocked(prisma.commsThread.findUnique).mockResolvedValue({
      id: "thread-1",
      slackRootTs: THREAD_TS,
    } as any);
    vi.mocked(prisma.commsThread.update).mockResolvedValue({} as any);
    vi.mocked(prisma.commsMessage.upsert).mockResolvedValue({ id: "msg-1" } as any);
  });

  it("creates CommsMessage for each reply on correct parent", async () => {
    const rootMsg = makeSlackMessage({ ts: THREAD_TS, text: "Root message" });
    const reply1 = makeSlackMessage({ ts: "1700000002.000001", text: "Reply 1", thread_ts: THREAD_TS });
    const reply2 = makeSlackMessage({ ts: "1700000003.000001", text: "Reply 2", thread_ts: THREAD_TS });

    mockConversationsReplies.mockResolvedValue({
      messages: [rootMsg, reply1, reply2],
    });

    const result = await syncThreadReplies(CHANNEL_ID, THREAD_TS);

    expect(result.messagesUpserted).toBe(2);
    expect(prisma.commsMessage.upsert).toHaveBeenCalledTimes(2);

    const firstCallArgs = vi.mocked(prisma.commsMessage.upsert).mock.calls[0][0] as any;
    expect(firstCallArgs.where.threadId_slackTs.threadId).toBe("thread-1");
    expect(firstCallArgs.where.threadId_slackTs.slackTs).toBe("1700000002.000001");
  });

  it("skips the root message (first in replies array)", async () => {
    const rootMsg = makeSlackMessage({ ts: THREAD_TS, text: "Root" });
    mockConversationsReplies.mockResolvedValue({ messages: [rootMsg] });

    const result = await syncThreadReplies(CHANNEL_ID, THREAD_TS);

    expect(result.messagesUpserted).toBe(0);
    expect(prisma.commsMessage.upsert).not.toHaveBeenCalled();
  });

  it("updates parent thread slackReplyCount and slackLastReplyTs", async () => {
    const rootMsg = makeSlackMessage({ ts: THREAD_TS });
    const reply = makeSlackMessage({ ts: "1700000005.000001", text: "A reply" });

    mockConversationsReplies.mockResolvedValue({ messages: [rootMsg, reply] });

    await syncThreadReplies(CHANNEL_ID, THREAD_TS);

    expect(prisma.commsThread.update).toHaveBeenCalledWith({
      where: { id: "thread-1" },
      data: expect.objectContaining({
        slackReplyCount: 1,
        slackLastReplyTs: "1700000005.000001",
      }),
    });
  });

  it("returns 0 when parent thread not found", async () => {
    vi.mocked(prisma.commsThread.findUnique).mockResolvedValue(null);

    const result = await syncThreadReplies(CHANNEL_ID, THREAD_TS);

    expect(result.messagesUpserted).toBe(0);
    expect(mockConversationsReplies).not.toHaveBeenCalled();
  });
});
