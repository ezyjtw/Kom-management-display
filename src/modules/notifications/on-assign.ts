/**
 * Spec §12 TASK-OTC: when a ticket in one of a user's chosen projects
 * (notify.on_assign.projects) is assigned to them in Jira, send a Slack DM and
 * an in-app notification. Informational only: links, no actions.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getSlackClient } from "@/lib/integrations/slack";

export async function projectsFor(userId: string): Promise<string[]> {
  const pref = await prisma.userNotificationPreference.findUnique({ where: { userId } });
  return Array.isArray(pref?.onAssignProjects) ? (pref!.onAssignProjects as unknown[]).filter((p): p is string => typeof p === "string") : [];
}

export async function notifyOnAssign(input: { employeeId: string; ticketKey: string; title: string; url: string | null }): Promise<boolean> {
  const project = input.ticketKey.split("-")[0];
  const user = await prisma.user.findFirst({ where: { employeeId: input.employeeId }, select: { id: true, email: true } });
  if (!user || !(await projectsFor(user.id)).includes(project)) return false;

  const title = `${input.ticketKey} was assigned to you`;
  await prisma.inAppNotification.create({ data: { userId: user.id, title, body: input.title.slice(0, 500), link: input.url } });
  try {
    const slack = getSlackClient();
    const res = await slack?.users.lookupByEmail({ email: user.email });
    if (res?.user?.id) await slack!.chat.postMessage({ channel: res.user.id, text: `${title}: ${input.title}${input.url ? `\n${input.url}` : ""}` });
  } catch (error) {
    logger.warn("Assignment DM failed", { project, error: error instanceof Error ? error.message : String(error) });
  }
  return true;
}
