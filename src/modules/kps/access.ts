/**
 * kps:view (spec §12 CHK-09K). KPS views mirror the RESTRICTED status of the
 * explainer: only admins and the named users in `kps.viewerUserIds`.
 */
import type { AuthUser } from "@/lib/auth-user";
import { getSetting } from "@/modules/settings/settings";

export async function canViewKps(auth: Pick<AuthUser, "id" | "role">): Promise<boolean> {
  if (auth.role === "admin") return true;
  return (await getSetting("kps.viewerUserIds")).includes(auth.id);
}

/** True when the daily check item belongs to a restricted definition the user may not see. */
export async function isRestrictedItemFor(itemId: string, auth: Pick<AuthUser, "id" | "role">): Promise<boolean> {
  const { prisma } = await import("@/lib/prisma");
  const item = await prisma.dailyCheckItem.findUnique({ where: { id: itemId }, select: { definition: { select: { restricted: true } } } });
  return !!item?.definition?.restricted && !(await canViewKps(auth));
}
