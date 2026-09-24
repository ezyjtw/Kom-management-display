/**
 * Admin reference data for daily coverage (spec §12), audit-logged:
 * - team-config: team -> lead and deputy (teams are fixed, no rotation);
 * - asset-status: known degraded / sunset assets (CF-26) suppress CHK-01 tickets with a reason;
 * - approved-validators: the approved validator set (CF-10, CF-24), shipped empty;
 * - incident-categories: §9.7 categories and whether each is compliance-sensitive (DELETE deactivates);
 * - otc-break-types: CHK-02 break types from Confluence "2.3 OTC Break Types" (TODO(CONFIRM-OTC-BREAK-TYPES)).
 * GET lists; PUT upserts one row; DELETE removes one (?key=).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { createAuditEntry } from "@/lib/api/audit";
import { apiNotFoundError, apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { validateBody } from "@/lib/validation";
import { auditActor } from "@/modules/core-data/audit-actor";

const teamConfig = z.object({
  team: z.enum(["Team 1", "Team 2", "Team 3"]),
  leadEmployeeId: z.string().min(1).max(100).nullable(),
  deputyEmployeeId: z.string().min(1).max(100).nullable(),
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

type TableName = "team-config" | "asset-status" | "approved-validators" | "otc-break-types" | "incident-categories";
const TABLES: TableName[] = ["team-config", "asset-status", "approved-validators", "otc-break-types", "incident-categories"];

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
    let row: unknown;
    let key: string;
    if (table === "team-config") {
      const v = validateBody(teamConfig, body);
      if (!v.success) return apiValidationError(v.error);
      for (const id of [v.data.leadEmployeeId, v.data.deputyEmployeeId].filter((x): x is string => !!x)) {
        if (!(await prisma.employee.findUnique({ where: { id }, select: { id: true } }))) return apiValidationError(`Unknown employee ${id}`);
      }
      key = v.data.team;
      row = await prisma.teamConfig.upsert({ where: { team: key }, update: v.data, create: v.data });
    } else if (table === "asset-status") {
      const v = validateBody(assetStatus, body);
      if (!v.success) return apiValidationError(v.error);
      key = v.data.asset;
      const data = { ...v.data, updatedById: auth.id };
      row = await prisma.assetStatus.upsert({ where: { asset: key }, update: data, create: data });
    } else if (table === "incident-categories") {
      // Spec §9.7: compliance-sensitive categories never create a client ticket without a Compliance decision.
      const v = validateBody(incidentCategory, body);
      if (!v.success) return apiValidationError(v.error);
      key = v.data.code;
      row = await prisma.incidentCategory.upsert({ where: { code: key }, update: v.data, create: v.data });
    } else if (table === "otc-break-types") {
      const v = validateBody(otcBreakType, body);
      if (!v.success) return apiValidationError(v.error);
      key = v.data.code;
      row = await prisma.otcBreakType.upsert({ where: { code: key }, update: v.data, create: v.data });
    } else {
      const v = validateBody(approvedValidator, body);
      if (!v.success) return apiValidationError(v.error);
      key = `${v.data.chain}:${v.data.validator}`;
      row = await prisma.approvedValidator.upsert({
        where: { chain_validator: { chain: v.data.chain, validator: v.data.validator } },
        update: { notes: v.data.notes },
        create: { ...v.data, addedById: auth.id },
      });
    }
    await createAuditEntry({ action: `reference_${table}_upserted`, entityType: "reference_data", entityId: key, userId: actor.userId, summary: `${table} ${key} saved`, after: row as Record<string, unknown>, metadata: actor.metadata });
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
  if (!TABLES.includes(table as TableName) || table === "team-config") return apiNotFoundError("Reference table");
  if (!key) return apiValidationError("key is required");
  const actor = auditActor(auth);
  try {
    const { count } = table === "asset-status"
      ? await prisma.assetStatus.deleteMany({ where: { asset: key } })
      : table === "incident-categories"
        ? await prisma.incidentCategory.updateMany({ where: { code: key }, data: { isActive: false } })
        : table === "otc-break-types"
        ? await prisma.otcBreakType.deleteMany({ where: { code: key } })
        : await prisma.approvedValidator.deleteMany({ where: { id: key } });
    if (!count) return apiNotFoundError("Row");
    await createAuditEntry({ action: `reference_${table}_deleted`, entityType: "reference_data", entityId: key, userId: actor.userId, summary: `${table} ${key} removed`, metadata: actor.metadata });
    return apiSuccess({ deleted: count });
  } catch (error) {
    return handleApiError(error, "admin reference DELETE");
  }
}
