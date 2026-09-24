/**
 * Admin reference data for daily coverage (spec §12), audit-logged:
 * - team-config: team -> lead, deputy and members (teams are fixed, no rotation);
 * - asset-status: known degraded / sunset assets suppress CHK-01 tickets with a reason;
 * - approved-validators: the approved validator set, shipped empty;
 * - incident-categories: §9.7 categories and whether each is compliance-sensitive (DELETE deactivates);
 * - otc-break-types: CHK-02 break types from Confluence "2.3 OTC Break Types" (TODO(CONFIRM-OTC-BREAK-TYPES)).
 * - platform-impact-rules: §16.3 Platform impact mapping (versioned: every save bumps the version; DELETE deactivates);
 * - uat-templates: §16.5 human-authored UAT test outlines (no delete).
 * GET lists; PUT upserts one row; DELETE removes one (?key=).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { auditedAction } from "@/lib/api/audit";
import { apiNotFoundError, apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { validateBody } from "@/lib/validation";
import { auditActor } from "@/modules/core-data/audit-actor";
import { unsafeRegexReason } from "@/lib/safe-regex";

const teamConfig = z.object({
  team: z.enum(["Team 1", "Team 2", "Team 3"]),
  leadEmployeeId: z.string().min(1).max(100).nullable(),
  deputyEmployeeId: z.string().min(1).max(100).nullable(),
  memberEmployeeIds: z.array(z.string().min(1).max(100)).max(100).default([]),
});
const assetStatus = z.object({
  asset: z.string().trim().toUpperCase().regex(/^[A-Z0-9._-]{1,20}$/),
  status: z.enum(["normal", "known_degraded", "sunset"]),
  reason: z.string().trim().max(500),
}).refine((v) => v.status === "normal" || v.reason.length >= 5, { message: "A reason is required for degraded or sunset assets", path: ["reason"] });
const approvedValidator = z.object({
  chain: z.string().trim().min(1).max(40),
  validator: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(500).default(""),
});

const otcBreakType = z.object({
  code: z.string().trim().regex(/^[a-z0-9_]{2,40}$/),
  label: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).default(""),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});

const incidentCategory = z.object({
  code: z.string().trim().regex(/^[a-z_]{2,40}$/),
  label: z.string().trim().min(2).max(100),
  complianceSensitive: z.boolean(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});

type TableName = "team-config" | "asset-status" | "approved-validators" | "otc-break-types" | "incident-categories" | "platform-impact-rules" | "uat-templates";
const TABLES: TableName[] = ["team-config", "asset-status", "approved-validators", "otc-break-types", "incident-categories", "platform-impact-rules", "uat-templates"];

const codeList = z.array(z.string().trim().min(1).max(40)).max(50).default([]);
const platformImpactRule = z.object({
  id: z.string().min(1).max(100).optional(),
  name: z.string().trim().min(2).max(100),
  matchOn: z.enum(["section", "workstream", "keyword", "jira_project"]),
  pattern: z.string().min(1).max(300).superRefine((p, ctx) => { const reason = unsafeRegexReason(p, "i"); if (reason) ctx.addIssue({ code: "custom", message: reason }); }),
  taskCodes: codeList,
  alertCodes: codeList,
  controls: codeList,
  team: z.string().trim().min(1).max(60).default("All"),
  uatTemplate: z.string().trim().max(60).default(""),
  priority: z.enum(["P0", "P1", "P2", "P3"]).default("P2"),
  isActive: z.boolean().default(false),
});
const uatTemplate = z.object({
  code: z.string().trim().regex(/^[A-Z0-9-]{3,60}$/),
  title: z.string().trim().min(2).max(200),
  steps: z.string().max(20000).default(""),
  expectedResults: z.string().max(20000).default(""),
  evidenceRequired: z.string().max(5000).default(""),
});

async function guard(request: NextRequest | null, write: boolean) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "app_setting", write ? "configure" : "view");
  if (authz instanceof NextResponse) return authz;
  if (write && request) {
    const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
    if (limited) return limited;
  }
  return auth;
}

function list(table: TableName) {
  if (table === "team-config") return prisma.teamConfig.findMany({ orderBy: { team: "asc" } });
  if (table === "asset-status") return prisma.assetStatus.findMany({ orderBy: { asset: "asc" } });
  if (table === "incident-categories") return prisma.incidentCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { code: "asc" }] });
  if (table === "otc-break-types") return prisma.otcBreakType.findMany({ orderBy: [{ sortOrder: "asc" }, { code: "asc" }] });
  if (table === "platform-impact-rules") return prisma.platformImpactRule.findMany({ orderBy: { name: "asc" } });
  if (table === "uat-templates") return prisma.uatTemplate.findMany({ orderBy: { code: "asc" } });
  return prisma.approvedValidator.findMany({ orderBy: [{ chain: "asc" }, { validator: "asc" }] });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ table: string }> }) {
  const auth = await guard(null, false);
  if (auth instanceof NextResponse) return auth;
  const { table } = await params;
  if (!TABLES.includes(table as TableName)) return apiNotFoundError("Reference table");
  try {
    return apiSuccess(await list(table as TableName));
  } catch (error) {
    return handleApiError(error, "admin reference GET");
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ table: string }> }) {
  const auth = await guard(request, true);
  if (auth instanceof NextResponse) return auth;
  const { table } = await params;
  if (!TABLES.includes(table as TableName)) return apiNotFoundError("Reference table");
  const actor = auditActor(auth);
  try {
    const body = await request.json();
    // Validate first; the write itself runs inside the fail-closed audit below.
    let write: () => Promise<unknown>;
    let key: string;
    if (table === "team-config") {
      const v = validateBody(teamConfig, body);
      if (!v.success) return apiValidationError(v.error);
      for (const id of [v.data.leadEmployeeId, v.data.deputyEmployeeId, ...v.data.memberEmployeeIds].filter((x): x is string => !!x)) {
        if (!(await prisma.employee.findUnique({ where: { id }, select: { id: true } }))) return apiValidationError(`Unknown employee ${id}`);
      }
      const team = v.data.team;
      key = team;
      write = () => prisma.teamConfig.upsert({ where: { team }, update: v.data, create: v.data });
    } else if (table === "asset-status") {
      const v = validateBody(assetStatus, body);
      if (!v.success) return apiValidationError(v.error);
      key = v.data.asset;
      const data = { ...v.data, updatedById: auth.id };
      write = () => prisma.assetStatus.upsert({ where: { asset: data.asset }, update: data, create: data });
    } else if (table === "incident-categories") {
      // Spec §9.7: compliance-sensitive categories never create a client ticket without a Compliance decision.
      const v = validateBody(incidentCategory, body);
      if (!v.success) return apiValidationError(v.error);
      key = v.data.code;
      write = () => prisma.incidentCategory.upsert({ where: { code: v.data.code }, update: v.data, create: v.data });
    } else if (table === "otc-break-types") {
      const v = validateBody(otcBreakType, body);
      if (!v.success) return apiValidationError(v.error);
      key = v.data.code;
      write = () => prisma.otcBreakType.upsert({ where: { code: v.data.code }, update: v.data, create: v.data });
    } else if (table === "platform-impact-rules") {
      const v = validateBody(platformImpactRule, body);
      if (!v.success) return apiValidationError(v.error);
      const { id, ...data } = v.data;
      key = id ?? data.name;
      write = () => (id
        ? prisma.platformImpactRule.update({ where: { id }, data: { ...data, version: { increment: 1 } } })
        : prisma.platformImpactRule.create({ data }));
    } else if (table === "uat-templates") {
      const v = validateBody(uatTemplate, body);
      if (!v.success) return apiValidationError(v.error);
      key = v.data.code;
      write = () => prisma.uatTemplate.upsert({ where: { code: v.data.code }, update: v.data, create: v.data });
    } else {
      const v = validateBody(approvedValidator, body);
      if (!v.success) return apiValidationError(v.error);
      key = `${v.data.chain}:${v.data.validator}`;
      write = () => prisma.approvedValidator.upsert({
        where: { chain_validator: { chain: v.data.chain, validator: v.data.validator } },
        update: { notes: v.data.notes },
        create: { ...v.data, addedById: auth.id },
      });
    }
    const row = await auditedAction(
      { action: `reference_${table}_upserted`, entityType: "reference_data", entityId: key, userId: actor.userId, summary: `Save ${table} ${key}`, after: body as Record<string, unknown>, metadata: actor.metadata },
      write,
      (r) => r as Record<string, unknown>,
    );
    return apiSuccess(row);
  } catch (error) {
    return handleApiError(error, "admin reference PUT");
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ table: string }> }) {
  const auth = await guard(request, true);
  if (auth instanceof NextResponse) return auth;
  const { table } = await params;
  const key = new URL(request.url).searchParams.get("key");
  if (!TABLES.includes(table as TableName) || table === "team-config" || table === "uat-templates") return apiNotFoundError("Reference table");
  if (!key) return apiValidationError("key is required");
  const actor = auditActor(auth);
  try {
    const existing = table === "asset-status"
      ? await prisma.assetStatus.count({ where: { asset: key } })
      : table === "incident-categories"
        ? await prisma.incidentCategory.count({ where: { code: key } })
        : table === "otc-break-types"
        ? await prisma.otcBreakType.count({ where: { code: key } })
        : table === "platform-impact-rules"
        ? await prisma.platformImpactRule.count({ where: { id: key } })
        : await prisma.approvedValidator.count({ where: { id: key } });
    if (!existing) return apiNotFoundError("Row");
    const { count } = await auditedAction(
      { action: `reference_${table}_deleted`, entityType: "reference_data", entityId: key, userId: actor.userId, summary: `Remove ${table} ${key}`, metadata: actor.metadata },
      async () => table === "asset-status"
        ? prisma.assetStatus.deleteMany({ where: { asset: key } })
        : table === "incident-categories"
          ? prisma.incidentCategory.updateMany({ where: { code: key }, data: { isActive: false } })
          : table === "otc-break-types"
          ? prisma.otcBreakType.deleteMany({ where: { code: key } })
          : table === "platform-impact-rules"
          ? prisma.platformImpactRule.updateMany({ where: { id: key }, data: { isActive: false, version: { increment: 1 } } })
          : prisma.approvedValidator.deleteMany({ where: { id: key } }),
      (r) => ({ deleted: r.count }),
    );
    if (!count) return apiNotFoundError("Row");
    return apiSuccess({ deleted: count });
  } catch (error) {
    return handleApiError(error, "admin reference DELETE");
  }
}
