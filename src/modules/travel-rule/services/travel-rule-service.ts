/**
 * Travel Rule Domain Service
 *
 * Manages the lifecycle of travel rule cases from Open through to Resolved.
 * Handles explicit workflow state transitions with validation, due date
 * management, escalation paths, counterparty communication logging,
 * and evidence attachment management.
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// ─── Constants ───

/** Default SLA deadline: 48 hours from case creation. */
const DEFAULT_SLA_HOURS = 48;

// ─── Types ───

export type CaseStatus = "Open" | "Investigating" | "PendingResponse" | "Resolved";
export type ResolutionType = "info_obtained" | "email_sent" | "not_required" | "escalated";

export interface CreateCaseInput {
  transactionId: string;
  txHash?: string;
  direction: string;
  asset: string;
  amount: number;
  senderAddress?: string;
  receiverAddress?: string;
  matchStatus: string;
  notabeneTransferId?: string;
  ownerUserId?: string;
  slaDeadline?: Date;
}

export interface TransitionInput {
  caseId: string;
  targetStatus: CaseStatus;
  performedById: string;
  note?: string;
  resolutionType?: ResolutionType;
  resolutionNote?: string;
}

export interface TransitionResult {
  success: boolean;
  case: CaseRecord;
  previousStatus: CaseStatus;
  newStatus: CaseStatus;
  error?: string;
}

export interface CaseRecord {
  id: string;
  transactionId: string;
  txHash: string;
  direction: string;
  asset: string;
  amount: number;
  senderAddress: string;
  receiverAddress: string;
  matchStatus: string;
  notabeneTransferId: string | null;
  ownerUserId: string | null;
  status: string;
  resolutionType: string | null;
  resolutionNote: string;
  emailSentTo: string | null;
  emailSentAt: Date | null;
  slaDeadline: Date | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  notes?: CaseNoteRecord[];
  alerts?: Array<{ id: string; type: string; status: string; message: string }>;
}

export interface CaseNoteRecord {
  id: string;
  caseId: string;
  authorId: string;
  content: string;
  createdAt: Date;
  author?: { id: string; name: string };
}

export interface CounterpartyLogEntry {
  type: "email_sent" | "email_received" | "response_logged" | "escalation";
  counterparty: string;
  content: string;
  timestamp: Date;
  performedById: string;
}

export interface EvidenceAttachment {
  id: string;
  filename: string;
  description: string;
  addedById: string;
  addedAt: string;
  url?: string;
}

export interface CaseFilters {
  status?: CaseStatus | CaseStatus[];
  matchStatus?: string;
  ownerUserId?: string;
  direction?: string;
  asset?: string;
  slaBreached?: boolean;
  createdAfter?: Date;
  createdBefore?: Date;
}

export interface CasePagination {
  page?: number;
  pageSize?: number;
  orderBy?: "createdAt" | "slaDeadline" | "status";
  order?: "asc" | "desc";
}

// ─── Valid state transitions ───

const VALID_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  Open: ["Investigating", "Resolved"],
  Investigating: ["PendingResponse", "Resolved", "Open"],
  PendingResponse: ["Investigating", "Resolved"],
  Resolved: [], // Terminal state
};

// ─── Service ───

export const travelRuleService = {
  // ──────────────────────────────
  // Case CRUD
  // ──────────────────────────────

  /**
   * List travel rule cases with filtering and pagination.
   */
  async getCases(
    filters: CaseFilters = {},
    pagination: CasePagination = {},
  ): Promise<{ cases: CaseRecord[]; total: number }> {
    const where = buildCaseWhere(filters);
    const page = Math.max(1, pagination.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, pagination.pageSize ?? 25));

    const [cases, total] = await Promise.all([
      prisma.travelRuleCase.findMany({
        where,
        include: {
          notes: {
            orderBy: { createdAt: "desc" },
            take: 5,
            include: { author: { select: { id: true, name: true } } },
          },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { [pagination.orderBy ?? "createdAt"]: pagination.order ?? "desc" },
      }),
      prisma.travelRuleCase.count({ where }),
    ]);

    return { cases: cases as unknown as CaseRecord[], total };
  },

  /**
   * Get a single case by ID with all notes and alerts.
   */
  async getCaseById(id: string): Promise<CaseRecord | null> {
    const caseRecord = await prisma.travelRuleCase.findUnique({
      where: { id },
      include: {
        notes: {
          orderBy: { createdAt: "asc" },
          include: { author: { select: { id: true, name: true } } },
        },
        alerts: {
          orderBy: { createdAt: "desc" },
          select: { id: true, type: true, status: true, message: true },
        },
      },
    });
    return caseRecord as unknown as CaseRecord | null;
  },

  /**
   * Create a new travel rule case. Automatically sets an SLA deadline
   * if one is not provided (default: 48 hours from now).
   */
  async createCase(input: CreateCaseInput): Promise<CaseRecord> {
    const slaDeadline = input.slaDeadline ?? new Date(Date.now() + DEFAULT_SLA_HOURS * 60 * 60 * 1000);

    const caseRecord = await prisma.travelRuleCase.create({
      data: {
        transactionId: input.transactionId,
        txHash: input.txHash ?? "",
        direction: input.direction,
        asset: input.asset,
        amount: input.amount,
        senderAddress: input.senderAddress ?? "",
        receiverAddress: input.receiverAddress ?? "",
        matchStatus: input.matchStatus,
        notabeneTransferId: input.notabeneTransferId ?? null,
        ownerUserId: input.ownerUserId ?? null,
        status: "Open",
        slaDeadline,
      },
    });

    logger.info("travelRuleService.createCase", {
      id: caseRecord.id,
      transactionId: input.transactionId,
      matchStatus: input.matchStatus,
    });

    return caseRecord as unknown as CaseRecord;
  },

  // ──────────────────────────────
  // Workflow state transitions
  // ──────────────────────────────

  /**
   * Transition a case through the workflow with validation.
   *
   * Valid transitions:
   *   Open -> Investigating | Resolved
   *   Investigating -> PendingResponse | Resolved | Open
   *   PendingResponse -> Investigating | Resolved
   *   Resolved -> (none, terminal)
   *
   * Resolving a case requires a resolutionType.
   */
  async transitionCase(input: TransitionInput): Promise<TransitionResult> {
    const caseRecord = await prisma.travelRuleCase.findUnique({ where: { id: input.caseId } });
    if (!caseRecord) {
      throw new Error(`Case ${input.caseId} not found`);
    }

    const currentStatus = caseRecord.status as CaseStatus;
    const targetStatus = input.targetStatus;

    // Validate transition
    if (!VALID_TRANSITIONS[currentStatus]?.includes(targetStatus)) {
      return {
        success: false,
        case: caseRecord as unknown as CaseRecord,
        previousStatus: currentStatus,
        newStatus: currentStatus,
        error: `Invalid transition: ${currentStatus} -> ${targetStatus}. Valid: ${VALID_TRANSITIONS[currentStatus]?.join(", ") || "none"}`,
      };
    }

    // Resolving requires a resolution type
    if (targetStatus === "Resolved" && !input.resolutionType) {
      return {
        success: false,
        case: caseRecord as unknown as CaseRecord,
        previousStatus: currentStatus,
        newStatus: currentStatus,
        error: "Resolution type is required when resolving a case",
      };
    }

    const updateData: Record<string, unknown> = {
      status: targetStatus,
    };

    if (targetStatus === "Resolved") {
      updateData.resolvedAt = new Date();
      updateData.resolutionType = input.resolutionType;
      if (input.resolutionNote) updateData.resolutionNote = input.resolutionNote;
    }

    const updated = await prisma.travelRuleCase.update({
      where: { id: input.caseId },
      data: updateData,
    });

    // Add a note recording the transition
    if (input.note) {
      await prisma.caseNote.create({
        data: {
          caseId: input.caseId,
          authorId: input.performedById,
          content: `[${currentStatus} -> ${targetStatus}] ${input.note}`,
        },
      });
    }

    await writeAuditLog("case_transition", "travel_rule_case", input.caseId, input.performedById, {
      from: currentStatus,
      to: targetStatus,
      resolutionType: input.resolutionType,
    });

    logger.info("travelRuleService.transitionCase", {
      caseId: input.caseId,
      from: currentStatus,
      to: targetStatus,
    });

    return {
      success: true,
      case: updated as unknown as CaseRecord,
      previousStatus: currentStatus,
      newStatus: targetStatus,
    };
  },

  // ──────────────────────────────
  // Due dates & escalation
  // ──────────────────────────────

  /**
   * Get all cases that are past their SLA deadline and not yet resolved.
   */
  async getOverdueCases(): Promise<CaseRecord[]> {
    const now = new Date();
    const cases = await prisma.travelRuleCase.findMany({
      where: {
        status: { not: "Resolved" },
        slaDeadline: { lt: now },
      },
      include: {
        notes: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { author: { select: { id: true, name: true } } },
        },
      },
      orderBy: { slaDeadline: "asc" },
    });
    return cases as unknown as CaseRecord[];
  },

  /**
   * Extend the SLA deadline for a case.
   */
  async extendSlaDeadline(
    caseId: string,
    newDeadline: Date,
    reason: string,
    performedById: string,
  ): Promise<CaseRecord> {
    const updated = await prisma.travelRuleCase.update({
      where: { id: caseId },
      data: { slaDeadline: newDeadline },
    });

    await prisma.caseNote.create({
      data: {
        caseId,
        authorId: performedById,
        content: `[SLA Extended] New deadline: ${newDeadline.toISOString()}. Reason: ${reason}`,
      },
    });

    logger.info("travelRuleService.extendSlaDeadline", { caseId, newDeadline, reason });
    return updated as unknown as CaseRecord;
  },

  /**
   * Escalate a case. Transitions to Investigating if not already,
   * and records an escalation note.
   */
  async escalateCase(
    caseId: string,
    escalationPath: string,
    reason: string,
    performedById: string,
  ): Promise<CaseRecord> {
    const caseRecord = await prisma.travelRuleCase.findUnique({ where: { id: caseId } });
    if (!caseRecord) throw new Error(`Case ${caseId} not found`);

    const updateData: Record<string, unknown> = {};
    if (caseRecord.status === "Open") {
      updateData.status = "Investigating";
    }

    const updated = await prisma.travelRuleCase.update({
      where: { id: caseId },
      data: updateData,
    });

    await prisma.caseNote.create({
      data: {
        caseId,
        authorId: performedById,
        content: `[ESCALATION to ${escalationPath}] ${reason}`,
      },
    });

    await writeAuditLog("case_escalated", "travel_rule_case", caseId, performedById, {
      escalationPath,
      reason,
    });

    logger.info("travelRuleService.escalateCase", { caseId, escalationPath });
    return updated as unknown as CaseRecord;
  },

  // ──────────────────────────────
  // Counterparty communication log
  // ──────────────────────────────

  /**
   * Log a counterparty communication event (email sent, response received, etc.).
   * This creates a case note with a structured prefix for filtering.
   */
  async logCounterpartyCommunication(
    caseId: string,
    entry: CounterpartyLogEntry,
  ): Promise<void> {
    const prefix = `[COMMS:${entry.type.toUpperCase()}]`;
    const content = `${prefix} To/From: ${entry.counterparty}. ${entry.content}`;

    await prisma.caseNote.create({
      data: {
        caseId,
        authorId: entry.performedById,
        content,
      },
    });

    // If this was an email, update the case email fields
    if (entry.type === "email_sent") {
      await prisma.travelRuleCase.update({
        where: { id: caseId },
        data: {
          emailSentTo: entry.counterparty,
          emailSentAt: entry.timestamp,
          status: "PendingResponse",
        },
      });
    }

    logger.info("travelRuleService.logCounterpartyCommunication", {
      caseId,
      type: entry.type,
      counterparty: entry.counterparty,
    });
  },

  // ──────────────────────────────
  // Evidence attachment management
  // ──────────────────────────────

  /**
   * Add an evidence attachment reference to a case.
   * Evidence is stored as a JSON array in a case note with a special prefix.
   */
  async addEvidence(
    caseId: string,
    attachment: Omit<EvidenceAttachment, "id" | "addedAt">,
    performedById: string,
  ): Promise<void> {
    const content = `[EVIDENCE] ${attachment.filename}: ${attachment.description}${attachment.url ? ` (${attachment.url})` : ""}`;

    await prisma.caseNote.create({
      data: {
        caseId,
        authorId: performedById,
        content,
      },
    });

    logger.info("travelRuleService.addEvidence", {
      caseId,
      filename: attachment.filename,
    });
  },

  /**
   * Get all evidence attachments for a case by parsing structured notes.
   */
  async getEvidence(caseId: string): Promise<EvidenceAttachment[]> {
    const notes = await prisma.caseNote.findMany({
      where: {
        caseId,
        content: { startsWith: "[EVIDENCE]" },
      },
      include: { author: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });

    return notes.map((note) => {
      const content = note.content.replace("[EVIDENCE] ", "");
      const colonIdx = content.indexOf(":");
      const filename = colonIdx > 0 ? content.substring(0, colonIdx).trim() : content;
      const rest = colonIdx > 0 ? content.substring(colonIdx + 1).trim() : "";

      // Extract URL from parentheses at end if present
      const urlMatch = rest.match(/\(([^)]+)\)$/);
      const url = urlMatch?.[1];
      const description = url ? rest.replace(urlMatch[0], "").trim() : rest;

      return {
        id: note.id,
        filename,
        description,
        addedById: note.authorId,
        addedAt: note.createdAt.toISOString(),
        url,
      };
    });
  },

  // ──────────────────────────────
  // Case notes
  // ──────────────────────────────

  /**
   * Add a note to a case.
   */
  async addNote(caseId: string, authorId: string, content: string): Promise<CaseNoteRecord> {
    const note = await prisma.caseNote.create({
      data: { caseId, authorId, content },
      include: { author: { select: { id: true, name: true } } },
    });
    return note as unknown as CaseNoteRecord;
  },

  /**
   * Get VASP contact information for counterparty communication.
   */
  async getVaspContact(vaspDid: string): Promise<{
    vaspName: string;
    email: string;
    notes: string;
  } | null> {
    const contact = await prisma.vaspContact.findUnique({
      where: { vaspDid },
      select: { vaspName: true, email: true, notes: true },
    });
    return contact;
  },
};

// ─── Internal Helpers ───

function buildCaseWhere(filters: CaseFilters): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  if (filters.status) {
    where.status = Array.isArray(filters.status) ? { in: filters.status } : filters.status;
  }
  if (filters.matchStatus) where.matchStatus = filters.matchStatus;
  if (filters.ownerUserId) where.ownerUserId = filters.ownerUserId;
  if (filters.direction) where.direction = filters.direction;
  if (filters.asset) where.asset = filters.asset;

  if (filters.slaBreached) {
    where.slaDeadline = { lt: new Date() };
    where.status = { not: "Resolved" };
  }

  if (filters.createdAfter || filters.createdBefore) {
    const createdAt: Record<string, Date> = {};
    if (filters.createdAfter) createdAt.gte = filters.createdAfter;
    if (filters.createdBefore) createdAt.lte = filters.createdBefore;
    where.createdAt = createdAt;
  }

  return where;
}

async function writeAuditLog(
  action: string,
  entityType: string,
  entityId: string,
  userId: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        entityType,
        entityId,
        userId,
        details: JSON.stringify(details),
      },
    });
  } catch (err) {
    logger.error("Failed to write audit log", { action, entityType, entityId, error: String(err) });
  }
}
