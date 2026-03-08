import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-user";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";

const MAX_LOGO_SIZE = 512 * 1024; // 512 KB max for base64 logo

/**
 * GET /api/branding
 *
 * Public (no auth required) — returns current branding config so the
 * login page can show the correct logo before the user signs in.
 */
export async function GET() {
  try {
    const config = await prisma.brandingConfig.findUnique({
      where: { id: "singleton" },
    });

    const data = config || {
      appName: process.env.NEXT_PUBLIC_APP_NAME || "KOMmand Centre",
      subtitle: process.env.NEXT_PUBLIC_APP_SUBTITLE || "Ops Management & Comms Hub",
      logoData: "",
    };

    return apiSuccess(data);
  } catch (error) {
    return handleApiError(error, "branding GET");
  }
}

/**
 * PATCH /api/branding
 *
 * Admin-only. Update branding settings.
 * Body: { appName?, subtitle?, logoData? }
 *
 * logoData should be a base64 data URL, e.g. "data:image/png;base64,..."
 */
export async function PATCH(request: NextRequest) {
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { appName, subtitle, logoData } = body;

    // Validate logo size if provided
    if (logoData && logoData.length > MAX_LOGO_SIZE) {
      return apiValidationError("Logo file is too large. Maximum size is 512 KB.");
    }

    // Validate logo is a data URL if provided
    if (logoData && !logoData.startsWith("data:image/")) {
      return apiValidationError("Logo must be a valid image (PNG, JPEG, or SVG).");
    }

    const updateData: Record<string, unknown> = {};
    if (appName !== undefined) updateData.appName = String(appName).slice(0, 100);
    if (subtitle !== undefined) updateData.subtitle = String(subtitle).slice(0, 200);
    if (logoData !== undefined) updateData.logoData = logoData;

    const config = await prisma.brandingConfig.upsert({
      where: { id: "singleton" },
      create: {
        id: "singleton",
        appName: (updateData.appName as string) || "KOMmand Centre",
        subtitle: (updateData.subtitle as string) || "Ops Management & Comms Hub",
        logoData: (updateData.logoData as string) || "",
      },
      update: updateData,
    });

    await prisma.auditLog.create({
      data: {
        action: "branding_updated",
        entityType: "branding_config",
        entityId: "singleton",
        userId: auth.employeeId || auth.id,
        details: JSON.stringify({
          appName: config.appName,
          subtitle: config.subtitle,
          hasLogo: !!config.logoData,
        }),
      },
    });

    return apiSuccess(config);
  } catch (error) {
    return handleApiError(error, "branding PATCH");
  }
}
