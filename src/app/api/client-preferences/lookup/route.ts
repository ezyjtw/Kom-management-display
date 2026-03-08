import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { apiSuccess, apiValidationError, apiNotFoundError, handleApiError } from "@/lib/api/response";

/**
 * GET /api/client-preferences/lookup?clientName=AcmeCorp
 *
 * Quick lookup of a client's preferred contact method.
 * Used by travel-rule, comms, and other modules to determine
 * the best way to reach a client before sending communications.
 *
 * Returns the preference record with a recommended contact action.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const clientName = searchParams.get("clientName");

    if (!clientName) {
      return apiValidationError("clientName query parameter is required");
    }

    const preference = await prisma.clientContactPreference.findUnique({
      where: { clientName },
      include: {
        createdBy: { select: { id: true, name: true } },
      },
    });

    if (!preference) {
      return apiNotFoundError("Client preference");
    }

    // Build recommended contact info based on channel + business hours
    const now = new Date();
    const isWithinBusinessHours = checkBusinessHours(
      now,
      preference.timezone,
      preference.businessHoursStart,
      preference.businessHoursEnd,
      preference.businessDays,
    );

    const contactInfo = {
      channel: preference.preferredChannel,
      primary: getContactForChannel(preference),
      fallback: getFallbackContact(preference),
      isBusinessHours: isWithinBusinessHours,
      timezone: preference.timezone,
      note: isWithinBusinessHours
        ? `Client is within business hours (${preference.businessHoursStart}-${preference.businessHoursEnd} ${preference.timezone})`
        : `Outside business hours — consider ${preference.escalationEmail ? "escalation contact" : "waiting until " + preference.businessHoursStart + " " + preference.timezone}`,
    };

    // Travel rule specific
    const travelRule = preference.travelRuleContact
      ? {
          contact: preference.travelRuleContact,
          vaspDid: preference.vaspDid || null,
        }
      : null;

    // Escalation info
    const escalation =
      preference.escalationEmail || preference.escalationPhone
        ? {
            email: preference.escalationEmail || null,
            phone: preference.escalationPhone || null,
          }
        : null;

    let tags: string[] = [];
    try {
      const parsed = JSON.parse(preference.tags);
      tags = Array.isArray(parsed) ? parsed : [];
    } catch {
      tags = [];
    }

    return apiSuccess({
      clientName: preference.clientName,
      displayName: preference.displayName || preference.clientName,
      contactInfo,
      travelRule,
      escalation,
      language: preference.language,
      tags,
      lastContactedAt: preference.lastContactedAt?.toISOString() ?? null,
      active: preference.active,
    });
  } catch (error) {
    return handleApiError(error, "client-preferences lookup");
  }
}

// ─── Helpers ───

function getContactForChannel(pref: {
  preferredChannel: string;
  primaryEmail: string;
  slackChannel: string;
  phoneNumber: string;
}): string {
  switch (pref.preferredChannel) {
    case "email":
      return pref.primaryEmail;
    case "slack":
      return pref.slackChannel;
    case "phone":
      return pref.phoneNumber;
    case "portal":
      return "Client portal";
    default:
      return pref.primaryEmail;
  }
}

function getFallbackContact(pref: {
  primaryEmail: string;
  secondaryEmail: string;
  phoneNumber: string;
}): string | null {
  return pref.secondaryEmail || pref.phoneNumber || null;
}

function checkBusinessHours(
  now: Date,
  timezone: string,
  startStr: string,
  endStr: string,
  businessDaysStr: string,
): boolean {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short",
    });

    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0");
    const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0");
    const weekday = (parts.find((p) => p.type === "weekday")?.value || "").toLowerCase();

    const dayMap: Record<string, string> = {
      mon: "mon", tue: "tue", wed: "wed", thu: "thu", fri: "fri", sat: "sat", sun: "sun",
    };
    const businessDays = businessDaysStr.split(",").map((d) => d.trim().toLowerCase());
    const currentDay = dayMap[weekday.substring(0, 3)] || weekday.substring(0, 3);

    if (!businessDays.includes(currentDay)) return false;

    const currentMinutes = hour * 60 + minute;
    const [startH, startM] = startStr.split(":").map(Number);
    const [endH, endM] = endStr.split(":").map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  } catch {
    return true; // Default to business hours if timezone parsing fails
  }
}
