import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Create employees (upsert to be idempotent)
  const employeeData = [
    { name: "Alice Chen", email: "alice@ops.com", role: "Senior", team: "Ops", region: "APAC" },
    { name: "Bob Martinez", email: "bob@ops.com", role: "Analyst", team: "Settlements", region: "Americas" },
    { name: "Carol Davies", email: "carol@ops.com", role: "Lead", team: "Ops", region: "EMEA" },
    { name: "David Park", email: "david@ops.com", role: "Analyst", team: "StakingOps", region: "APAC" },
    { name: "Eva Kowalski", email: "eva@ops.com", role: "Senior", team: "Settlements", region: "EMEA" },
    { name: "Frank Osei", email: "frank@ops.com", role: "Analyst", team: "Ops", region: "EMEA" },
  ];

  const employees = await Promise.all(
    employeeData.map((data) =>
      prisma.employee.upsert({
        where: { email: data.email },
        update: {},
        create: data,
      })
    )
  );

  console.log(`Upserted ${employees.length} employees`);

  // Create user accounts for login
  const defaultPassword = await bcrypt.hash("admin123", 10);
  const userPassword = await bcrypt.hash("user123", 10);
  const leadPassword = await bcrypt.hash("lead123", 10);

  const userData = [
    { email: "manager@ops.com", name: "Ops Manager", role: "admin", password: defaultPassword, employeeId: null as string | null },
    { email: "carol@ops.com", name: "Carol Davies", role: "lead", password: leadPassword, employeeId: employees[2].id },
    { email: "alice@ops.com", name: "Alice Chen", role: "employee", password: userPassword, employeeId: employees[0].id },
    { email: "bob@ops.com", name: "Bob Martinez", role: "employee", password: userPassword, employeeId: employees[1].id },
    { email: "david@ops.com", name: "David Park", role: "employee", password: userPassword, employeeId: employees[3].id },
    { email: "eva@ops.com", name: "Eva Kowalski", role: "employee", password: userPassword, employeeId: employees[4].id },
    { email: "frank@ops.com", name: "Frank Osei", role: "employee", password: userPassword, employeeId: employees[5].id },
  ];

  await Promise.all(
    userData.map((data) =>
      prisma.user.upsert({
        where: { email: data.email },
        update: {},
        create: data,
      })
    )
  );

  console.log("Upserted user accounts");

  // Create time periods
  const periodData = [
    { type: "month", startDate: new Date("2026-01-01"), endDate: new Date("2026-01-31"), label: "2026-01" },
    { type: "month", startDate: new Date("2026-02-01"), endDate: new Date("2026-02-28"), label: "2026-02" },
    { type: "week", startDate: new Date("2026-02-16"), endDate: new Date("2026-02-22"), label: "2026-W08" },
    { type: "week", startDate: new Date("2026-02-23"), endDate: new Date("2026-03-01"), label: "2026-W09" },
  ];

  const periods = await Promise.all(
    periodData.map((data) =>
      prisma.timePeriod.upsert({
        where: { type_startDate: { type: data.type, startDate: data.startDate } },
        update: {},
        create: data,
      })
    )
  );

  console.log(`Upserted ${periods.length} time periods`);

  // Seed category scores for each employee for the latest month
  const categories = ["daily_tasks", "projects", "asset_actions", "quality", "knowledge"];
  const configVersion = "1.0.0";

  const scoreData: Record<string, Record<string, [number, number]>> = {
    [employees[0].id]: { daily_tasks: [0.75, 0.82], projects: [0.65, 0.70], asset_actions: [0.80, 0.85], quality: [0.85, 0.80], knowledge: [0.70, 0.75] },
    [employees[1].id]: { daily_tasks: [0.55, 0.65], projects: [0.30, 0.45], asset_actions: [0.60, 0.70], quality: [0.70, 0.75], knowledge: [0.40, 0.50] },
    [employees[2].id]: { daily_tasks: [0.80, 0.78], projects: [0.90, 0.88], asset_actions: [0.70, 0.72], quality: [0.90, 0.92], knowledge: [0.85, 0.88] },
    [employees[3].id]: { daily_tasks: [0.60, 0.55], projects: [0.20, 0.15], asset_actions: [0.65, 0.60], quality: [0.50, 0.35], knowledge: [0.35, 0.40] },
    [employees[4].id]: { daily_tasks: [0.70, 0.72], projects: [0.80, 0.85], asset_actions: [0.75, 0.78], quality: [0.80, 0.82], knowledge: [0.65, 0.70] },
    [employees[5].id]: { daily_tasks: [0.40, 0.52], projects: [0.25, 0.35], asset_actions: [0.45, 0.55], quality: [0.60, 0.65], knowledge: [0.30, 0.38] },
  };

  for (const emp of employees) {
    for (const cat of categories) {
      const [janRaw, febRaw] = scoreData[emp.id]?.[cat] ?? [0.5, 0.5];

      const evidenceType = cat === "daily_tasks" ? "jira" : cat === "projects" ? "confluence" : cat === "asset_actions" ? "asset_action" : cat === "quality" ? "positive" : "knowledge";

      // January score
      await prisma.categoryScore.upsert({
        where: { employeeId_periodId_category: { employeeId: emp.id, periodId: periods[0].id, category: cat } },
        update: {},
        create: {
          employeeId: emp.id,
          periodId: periods[0].id,
          category: cat,
          rawIndex: janRaw,
          score: 3 + janRaw * 5,
          configVersion,
          evidence: JSON.stringify([{ type: evidenceType, label: `Sample ${cat} evidence for Jan`, details: "Auto-generated seed data" }]),
          metadata: JSON.stringify({ period: "January 2026", auto_generated: true }),
        },
      });

      // February score
      await prisma.categoryScore.upsert({
        where: { employeeId_periodId_category: { employeeId: emp.id, periodId: periods[1].id, category: cat } },
        update: {},
        create: {
          employeeId: emp.id,
          periodId: periods[1].id,
          category: cat,
          rawIndex: febRaw,
          score: 3 + febRaw * 5,
          configVersion,
          evidence: JSON.stringify([{ type: evidenceType, label: `Sample ${cat} evidence for Feb`, details: "Auto-generated seed data" }]),
          metadata: JSON.stringify({ period: "February 2026", auto_generated: true }),
        },
      });
    }
  }

  console.log("Upserted category scores");

  // Knowledge scores
  const knowledgeData = [
    { emp: employees[0], op: 7, asset: 8, compliance: 7, incident: 6 },
    { emp: employees[1], op: 5, asset: 4, compliance: 5, incident: 4 },
    { emp: employees[2], op: 9, asset: 8, compliance: 9, incident: 8 },
    { emp: employees[3], op: 4, asset: 3, compliance: 4, incident: 3 },
    { emp: employees[4], op: 7, asset: 7, compliance: 6, incident: 7 },
    { emp: employees[5], op: 3, asset: 3, compliance: 4, incident: 3 },
  ];

  for (const kd of knowledgeData) {
    const avg = (kd.op + kd.asset + kd.compliance + kd.incident) / 4;
    const mapped = 3 + ((avg - 1) / 9) * 5;
    await prisma.knowledgeScore.upsert({
      where: { employeeId_periodId: { employeeId: kd.emp.id, periodId: periods[1].id } },
      update: {},
      create: {
        employeeId: kd.emp.id,
        periodId: periods[1].id,
        operationalUnderstanding: kd.op,
        assetKnowledge: kd.asset,
        complianceAwareness: kd.compliance,
        incidentResponse: kd.incident,
        overallRaw: avg,
        mappedScore: Math.round(mapped * 10) / 10,
        notes: "Initial assessment",
        scoredBy: "admin",
      },
    });
  }

  console.log("Upserted knowledge scores");

  // Seed comms threads
  const threadData = [
    {
      source: "email", sourceThreadRef: "gmail-thread-001",
      participants: JSON.stringify(["client-a@example.com", "ops@company.com"]),
      clientOrPartnerTag: "Client Alpha", subject: "ETH Staking withdrawal request — urgent",
      priority: "P1", status: "InProgress", ownerUserId: employees[0].id,
      queue: "StakingOps", lastMessageAt: new Date("2026-02-28T09:30:00Z"), lastActionAt: new Date("2026-02-28T09:45:00Z"),
    },
    {
      source: "slack", sourceThreadRef: "C01234-1709100000.000001",
      participants: JSON.stringify(["@client-b-ops", "@settlements-team"]),
      clientOrPartnerTag: "Client Beta", subject: "Settlement reconciliation discrepancy Q1",
      priority: "P2", status: "WaitingExternal", ownerUserId: employees[4].id,
      queue: "Settlements", lastMessageAt: new Date("2026-02-27T16:00:00Z"), lastActionAt: new Date("2026-02-27T16:30:00Z"),
    },
    {
      source: "email", sourceThreadRef: "gmail-thread-003",
      participants: JSON.stringify(["partner-x@exchange.com"]),
      clientOrPartnerTag: "Partner X", subject: "New custody onboarding — documentation required",
      priority: "P2", status: "Unassigned", queue: "Ops",
      lastMessageAt: new Date("2026-02-28T08:00:00Z"), ttoDeadline: new Date("2026-02-28T10:00:00Z"),
    },
    {
      source: "slack", sourceThreadRef: "C05678-1709200000.000002",
      participants: JSON.stringify(["@client-c-team"]),
      clientOrPartnerTag: "Client Gamma", subject: "Transaction stuck — Fireblocks approval pending",
      priority: "P0", status: "Assigned", ownerUserId: employees[3].id,
      queue: "Ops", lastMessageAt: new Date("2026-02-28T10:15:00Z"), ttfaDeadline: new Date("2026-02-28T10:25:00Z"),
    },
    {
      source: "email", sourceThreadRef: "gmail-thread-005",
      participants: JSON.stringify(["compliance@regulator.gov"]),
      clientOrPartnerTag: "Regulator", subject: "Travel Rule data request — March batch",
      priority: "P1", status: "Assigned", ownerUserId: employees[2].id,
      queue: "Ops", lastMessageAt: new Date("2026-02-28T07:00:00Z"), lastActionAt: new Date("2026-02-28T08:30:00Z"),
    },
    {
      source: "email", sourceThreadRef: "gmail-thread-006",
      participants: JSON.stringify(["client-d@example.com"]),
      clientOrPartnerTag: "Client Delta", subject: "Monthly reporting — asset allocation summary",
      priority: "P3", status: "Done", ownerUserId: employees[1].id,
      queue: "Ops", lastMessageAt: new Date("2026-02-26T14:00:00Z"), lastActionAt: new Date("2026-02-27T10:00:00Z"),
    },
  ];

  const threads = [];
  for (const data of threadData) {
    const thread = await prisma.commsThread.create({ data });
    threads.push(thread);
  }

  console.log(`Created ${threads.length} comms threads`);

  // Seed messages for threads
  await prisma.commsMessage.createMany({
    data: [
      {
        threadId: threads[0].id, authorName: "John @ Client Alpha", authorEmail: "client-a@example.com",
        authorType: "external", timestamp: new Date("2026-02-28T09:00:00Z"),
        bodySnippet: "Hi team, we need to initiate an ETH staking withdrawal for 500 ETH. Can you confirm the timeline and any fees involved? This is urgent as we have a fund redemption deadline.",
      },
      {
        threadId: threads[0].id, authorName: "Alice Chen", authorEmail: "alice@ops.com",
        authorType: "internal", timestamp: new Date("2026-02-28T09:30:00Z"),
        bodySnippet: "Hi John, acknowledged. I'm initiating the unstaking process now. ETH unstaking typically takes 1-5 days depending on the queue. I'll provide a Fireblocks reference shortly.",
      },
      {
        threadId: threads[2].id, authorName: "Partner X Onboarding", authorEmail: "partner-x@exchange.com",
        authorType: "external", timestamp: new Date("2026-02-28T08:00:00Z"),
        bodySnippet: "Hello, we're ready to begin the custody onboarding process. Please send us the required documentation checklist and KYC requirements for our entity.",
      },
      {
        threadId: threads[3].id, authorName: "Client Gamma Ops", authorEmail: "",
        authorType: "external", timestamp: new Date("2026-02-28T10:15:00Z"),
        bodySnippet: "URGENT: We have a USDC transfer that's been stuck in pending for 45 minutes. Fireblocks shows 'awaiting approval'. Can someone approve ASAP? TX ID: FB-29384",
      },
    ],
  });

  console.log("Created comms messages");

  // Seed some employee notes
  await prisma.employeeNote.createMany({
    data: [
      {
        employeeId: employees[3].id, periodLabel: "2026-02",
        content: "Quality issues need attention — 3 mistakes in settlements this month. Scheduling coaching session.",
        noteType: "manager", authorId: employees[2].id,
      },
      {
        employeeId: employees[3].id, periodLabel: "2026-02",
        content: "Was on-call week of Feb 16. Multiple incident responses impacted normal throughput.",
        noteType: "context", authorId: employees[3].id,
      },
      {
        employeeId: employees[5].id, periodLabel: "2026-02",
        content: "Showing good improvement in second month. Asset knowledge growing. Assigned mentor.",
        noteType: "manager", authorId: employees[2].id,
      },
    ],
  });

  console.log("Created employee notes");

  // Seed alerts
  await prisma.alert.createMany({
    data: [
      {
        threadId: threads[2].id, type: "tto_breach", priority: "P2",
        message: "Thread 'New custody onboarding' has been unassigned for over 2 hours",
        status: "active", destination: "in_app",
      },
      {
        threadId: threads[3].id, type: "ttfa_breach", priority: "P0",
        message: "P0 thread 'Transaction stuck — Fireblocks approval pending' assigned but no action taken",
        status: "active", destination: "in_app",
      },
      {
        employeeId: employees[3].id, type: "mistakes_rising", priority: "P2",
        message: "David Park — quality score dropped from 5.5 to 4.8 this month",
        status: "active", destination: "in_app",
      },
    ],
  });

  console.log("Created alerts");

  // Seed scoring config
  await prisma.scoringConfig.upsert({
    where: { version: "1.0.0" },
    update: {},
    create: {
      version: "1.0.0",
      config: JSON.stringify({
        version: "1.0.0",
        weights: { daily_tasks: 0.25, projects: 0.15, asset_actions: 0.25, quality: 0.25, knowledge: 0.10 },
        clampMin: 3,
        clampMax: 8,
      }),
      active: true,
      createdBy: "system",
      notes: "Initial default configuration",
    },
  });

  console.log("Created scoring config");
  console.log("Seed complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
