import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeSlaStatus, isExcessiveBouncing, computeTravelRuleAging } from "@/lib/sla";
import { requireRole } from "@/lib/auth-user";

/**
 * GET /api/alerts/generate
 * For cron services (Vercel Cron, external cron). Protected by CRON_SECRET.
 *
 * POST /api/alerts/generate
 * Manual trigger from admin panel. Admin only.
 */
export async function GET(request: NextRequest) {
  // Verify cron secret in production
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
  }
  return generateAlerts();
}

export async function POST() {
  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;
  return generateAlerts();
}

async function generateAlerts() {
  try {
    const now = new Date();
    let alertsCreated = 0;

    // Get all active threads (not Done/Closed)
    const threads = await prisma.commsThread.findMany({
      where: {
        status: { notIn: ["Done", "Closed"] },
      },
      include: {
        ownershipChanges: {
          where: {
            changedAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
          },
        },
      },
    });

    for (const thread of threads) {
      const sla = computeSlaStatus({
        createdAt: thread.createdAt,
        ownerUserId: thread.ownerUserId,
        lastActionAt: thread.lastActionAt,
        status: thread.status,
        priority: thread.priority,
        ttoDeadline: thread.ttoDeadline,
        ttfaDeadline: thread.ttfaDeadline,
        tslaDeadline: thread.tslaDeadline,
      });

      // Check TTO breach (unassigned too long)
      if (sla.isTtoBreached) {
        const existing = await prisma.alert.findFirst({
          where: {
            threadId: thread.id,
            type: "tto_breach",
            status: "active",
          },
        });

        if (!existing) {
          await prisma.alert.create({
            data: {
              threadId: thread.id,
              type: "tto_breach",
              priority: thread.priority,
              message: `Thread "${thread.subject}" has been unassigned past SLA (${thread.priority})`,
              destination: "in_app",
            },
          });
          alertsCreated++;
        }
      }

      // Check TTFA breach (assigned but no action)
      if (sla.isTtfaBreached) {
        const existing = await prisma.alert.findFirst({
          where: {
            threadId: thread.id,
            type: "ttfa_breach",
            status: "active",
          },
        });

        if (!existing) {
          await prisma.alert.create({
            data: {
              threadId: thread.id,
              type: "ttfa_breach",
              priority: thread.priority,
              message: `Thread "${thread.subject}" assigned but no action taken past SLA`,
              destination: "in_app",
            },
          });
          alertsCreated++;
        }
      }

      // Check TSLA breach (stale — no activity for too long)
      if (sla.isTslaBreached) {
        const existing = await prisma.alert.findFirst({
          where: {
            threadId: thread.id,
            type: "tsla_breach",
            status: "active",
          },
        });

        if (!existing) {
          await prisma.alert.create({
            data: {
              threadId: thread.id,
              type: "tsla_breach",
              priority: thread.priority,
              message: `Thread "${thread.subject}" has no activity past SLA threshold (status: ${thread.status})`,
              destination: "in_app",
            },
          });
          alertsCreated++;
        }
      }

      // Check for excessive ownership bouncing
      if (isExcessiveBouncing(thread.ownershipChanges)) {
        const existing = await prisma.alert.findFirst({
          where: {
            threadId: thread.id,
            type: "ownership_bounce",
            status: "active",
          },
        });

        if (!existing) {
          await prisma.alert.create({
            data: {
              threadId: thread.id,
              type: "ownership_bounce",
              priority: "P1",
              message: `Thread "${thread.subject}" has excessive ownership changes (>2 in 24h)`,
              destination: "in_app",
            },
          });
          alertsCreated++;
        }
      }
    }

    // --- Travel Rule SLA Checks ---
    const openCases = await prisma.travelRuleCase.findMany({
      where: { status: { not: "Resolved" } },
    });

    for (const tc of openCases) {
      const { agingStatus } = computeTravelRuleAging(tc.createdAt);
      if (agingStatus === "red") {
        const existing = await prisma.alert.findFirst({
          where: {
            travelRuleCaseId: tc.id,
            type: "travel_rule_sla_breach",
            status: "active",
          },
        });

        if (!existing) {
          await prisma.alert.create({
            data: {
              travelRuleCaseId: tc.id,
              type: "travel_rule_sla_breach",
              priority: "P1",
              message: `Travel rule case for ${tc.asset} ${tc.direction} (${tc.transactionId}) is over 48h old`,
              destination: "in_app",
            },
          });
          alertsCreated++;
        }
      }
    }

    // Also check performance trends for employees
    // (mistakes rising, throughput dropping)
    const latestPeriod = await prisma.timePeriod.findFirst({
      where: { type: "month" },
      orderBy: { startDate: "desc" },
    });

    if (latestPeriod) {
      const previousPeriod = await prisma.timePeriod.findFirst({
        where: {
          type: "month",
          startDate: { lt: latestPeriod.startDate },
        },
        orderBy: { startDate: "desc" },
      });

      if (previousPeriod) {
        const employees = await prisma.employee.findMany({ where: { active: true } });

        for (const emp of employees) {
          const currentQuality = await prisma.categoryScore.findFirst({
            where: { employeeId: emp.id, periodId: latestPeriod.id, category: "quality" },
          });
          const prevQuality = await prisma.categoryScore.findFirst({
            where: { employeeId: emp.id, periodId: previousPeriod.id, category: "quality" },
          });

          if (currentQuality && prevQuality && currentQuality.score < prevQuality.score - 0.5) {
            const existing = await prisma.alert.findFirst({
              where: {
                employeeId: emp.id,
                type: "mistakes_rising",
                status: "active",
              },
            });

            if (!existing) {
              await prisma.alert.create({
                data: {
                  employeeId: emp.id,
                  type: "mistakes_rising",
                  priority: "P2",
                  message: `${emp.name} — quality score dropped from ${prevQuality.score.toFixed(1)} to ${currentQuality.score.toFixed(1)}`,
                  destination: "in_app",
                },
              });
              alertsCreated++;
            }
          }

          const currentTasks = await prisma.categoryScore.findFirst({
            where: { employeeId: emp.id, periodId: latestPeriod.id, category: "daily_tasks" },
          });
          const prevTasks = await prisma.categoryScore.findFirst({
            where: { employeeId: emp.id, periodId: previousPeriod.id, category: "daily_tasks" },
          });

          if (currentTasks && prevTasks && currentTasks.score < prevTasks.score - 0.5) {
            const existing = await prisma.alert.findFirst({
              where: {
                employeeId: emp.id,
                type: "throughput_drop",
                status: "active",
              },
            });

            if (!existing) {
              await prisma.alert.create({
                data: {
                  employeeId: emp.id,
                  type: "throughput_drop",
                  priority: "P2",
                  message: `${emp.name} — task throughput dropped from ${prevTasks.score.toFixed(1)} to ${currentTasks.score.toFixed(1)}`,
                  destination: "in_app",
                },
              });
              alertsCreated++;
            }
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        threadsScanned: threads.length,
        travelRuleCasesScanned: openCases.length,
        alertsCreated,
        timestamp: now.toISOString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "An internal error occurred" },
      { status: 500 }
    );
  }
}
