import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Create employees (upsert to be idempotent)
  // Transaction Operations has 3 sub-teams, each with a lead and juniors
  // Locations: London (EMEA), Hong Kong (APAC), Jersey (EMEA)
  const employeeData = [
    // Transaction Operations — Leads & Seniors
    { name: "Alice Chen", email: "alice@ops.com", role: "Senior", team: "Transaction Operations", region: "APAC" },       // Hong Kong
    { name: "Carol Davies", email: "carol@ops.com", role: "Lead", team: "Transaction Operations", region: "EMEA" },        // London — overall team lead
    { name: "Grace Thompson", email: "grace@ops.com", role: "Senior", team: "Transaction Operations", region: "EMEA" },     // London — sub-team lead
    { name: "Kenji Yamamoto", email: "kenji@ops.com", role: "Senior", team: "Transaction Operations", region: "APAC" },     // Hong Kong — sub-team lead
    // Transaction Operations — Analysts (juniors who rotate)
    { name: "Liam O'Brien", email: "liam@ops.com", role: "Analyst", team: "Transaction Operations", region: "EMEA" },      // London — late shift / WFH
    { name: "Maria Santos", email: "maria@ops.com", role: "Analyst", team: "Transaction Operations", region: "EMEA" },      // London
    { name: "Nikhil Patel", email: "nikhil@ops.com", role: "Analyst", team: "Transaction Operations", region: "EMEA" },     // Jersey
    { name: "Sophie Laurent", email: "sophie@ops.com", role: "Analyst", team: "Transaction Operations", region: "EMEA" },   // Jersey
    { name: "Tom Nakamura", email: "tom@ops.com", role: "Analyst", team: "Transaction Operations", region: "APAC" },        // Hong Kong
    { name: "Yuki Tanaka", email: "yuki@ops.com", role: "Analyst", team: "Transaction Operations", region: "APAC" },        // Hong Kong
    // Admin Operations
    { name: "Bob Martinez", email: "bob@ops.com", role: "Analyst", team: "Admin Operations", region: "Americas" },
    { name: "Eva Kowalski", email: "eva@ops.com", role: "Senior", team: "Admin Operations", region: "EMEA" },
    // Data Operations
    { name: "David Park", email: "david@ops.com", role: "Analyst", team: "Data Operations", region: "APAC" },
    { name: "Frank Osei", email: "frank@ops.com", role: "Analyst", team: "Data Operations", region: "EMEA" },
  ];

  const employees = await Promise.all(
    employeeData.map((data) =>
      prisma.employee.upsert({
        where: { email: data.email },
        update: { team: data.team },
        create: data,
      })
    )
  );

  console.log(`Upserted ${employees.length} employees`);

  // Create user accounts for login
  const defaultPassword = await bcrypt.hash("admin123", 10);
  const userPassword = await bcrypt.hash("user123", 10);
  const leadPassword = await bcrypt.hash("lead123", 10);

  // Build employee lookup by email for stable references
  const emp = Object.fromEntries(employees.map((e) => [e.email, e]));

  const userData = [
    { email: "manager@ops.com", name: "Ops Manager", role: "admin", password: defaultPassword, employeeId: null as string | null },
    { email: "carol@ops.com", name: "Carol Davies", role: "lead", password: leadPassword, employeeId: emp["carol@ops.com"].id },
    { email: "alice@ops.com", name: "Alice Chen", role: "employee", password: userPassword, employeeId: emp["alice@ops.com"].id },
    { email: "bob@ops.com", name: "Bob Martinez", role: "employee", password: userPassword, employeeId: emp["bob@ops.com"].id },
    { email: "david@ops.com", name: "David Park", role: "employee", password: userPassword, employeeId: emp["david@ops.com"].id },
    { email: "eva@ops.com", name: "Eva Kowalski", role: "employee", password: userPassword, employeeId: emp["eva@ops.com"].id },
    { email: "frank@ops.com", name: "Frank Osei", role: "employee", password: userPassword, employeeId: emp["frank@ops.com"].id },
    { email: "grace@ops.com", name: "Grace Thompson", role: "employee", password: userPassword, employeeId: emp["grace@ops.com"].id },
    { email: "kenji@ops.com", name: "Kenji Yamamoto", role: "employee", password: userPassword, employeeId: emp["kenji@ops.com"].id },
    { email: "liam@ops.com", name: "Liam O'Brien", role: "employee", password: userPassword, employeeId: emp["liam@ops.com"].id },
    { email: "maria@ops.com", name: "Maria Santos", role: "employee", password: userPassword, employeeId: emp["maria@ops.com"].id },
    { email: "nikhil@ops.com", name: "Nikhil Patel", role: "employee", password: userPassword, employeeId: emp["nikhil@ops.com"].id },
    { email: "sophie@ops.com", name: "Sophie Laurent", role: "employee", password: userPassword, employeeId: emp["sophie@ops.com"].id },
    { email: "tom@ops.com", name: "Tom Nakamura", role: "employee", password: userPassword, employeeId: emp["tom@ops.com"].id },
    { email: "yuki@ops.com", name: "Yuki Tanaka", role: "employee", password: userPassword, employeeId: emp["yuki@ops.com"].id },
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
    { type: "quarter", startDate: new Date("2025-10-01"), endDate: new Date("2025-12-31"), label: "2025-Q4" },
    { type: "quarter", startDate: new Date("2026-01-01"), endDate: new Date("2026-03-31"), label: "2026-Q1" },
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

  // Score data keyed by email for stability when employee array changes
  const scoreDataByEmail: Record<string, Record<string, [number, number]>> = {
    "alice@ops.com": { daily_tasks: [0.75, 0.82], projects: [0.65, 0.70], asset_actions: [0.80, 0.85], quality: [0.85, 0.80], knowledge: [0.70, 0.75] },
    "bob@ops.com": { daily_tasks: [0.55, 0.65], projects: [0.30, 0.45], asset_actions: [0.60, 0.70], quality: [0.70, 0.75], knowledge: [0.40, 0.50] },
    "carol@ops.com": { daily_tasks: [0.80, 0.78], projects: [0.90, 0.88], asset_actions: [0.70, 0.72], quality: [0.90, 0.92], knowledge: [0.85, 0.88] },
    "david@ops.com": { daily_tasks: [0.60, 0.55], projects: [0.20, 0.15], asset_actions: [0.65, 0.60], quality: [0.50, 0.35], knowledge: [0.35, 0.40] },
    "eva@ops.com": { daily_tasks: [0.70, 0.72], projects: [0.80, 0.85], asset_actions: [0.75, 0.78], quality: [0.80, 0.82], knowledge: [0.65, 0.70] },
    "frank@ops.com": { daily_tasks: [0.40, 0.52], projects: [0.25, 0.35], asset_actions: [0.45, 0.55], quality: [0.60, 0.65], knowledge: [0.30, 0.38] },
  };
  const scoreData: Record<string, Record<string, [number, number]>> = {};
  for (const [email, scores] of Object.entries(scoreDataByEmail)) {
    if (emp[email]) scoreData[emp[email].id] = scores;
  }

  for (const e of employees) {
    for (const cat of categories) {
      const [janRaw, febRaw] = scoreData[e.id]?.[cat] ?? [0.5, 0.5];

      const evidenceType = cat === "daily_tasks" ? "jira" : cat === "projects" ? "confluence" : cat === "asset_actions" ? "asset_action" : cat === "quality" ? "positive" : "knowledge";

      // January score
      await prisma.categoryScore.upsert({
        where: { employeeId_periodId_category: { employeeId: e.id, periodId: periods[0].id, category: cat } },
        update: {},
        create: {
          employeeId: e.id, periodId: periods[0].id, category: cat,
          rawIndex: janRaw, score: 3 + janRaw * 5, configVersion,
          evidence: JSON.stringify([{ type: evidenceType, label: `Sample ${cat} evidence for Jan`, details: "Auto-generated seed data" }]),
          metadata: JSON.stringify({ period: "January 2026", auto_generated: true }),
        },
      });

      // February score
      await prisma.categoryScore.upsert({
        where: { employeeId_periodId_category: { employeeId: e.id, periodId: periods[1].id, category: cat } },
        update: {},
        create: {
          employeeId: e.id, periodId: periods[1].id, category: cat,
          rawIndex: febRaw, score: 3 + febRaw * 5, configVersion,
          evidence: JSON.stringify([{ type: evidenceType, label: `Sample ${cat} evidence for Feb`, details: "Auto-generated seed data" }]),
          metadata: JSON.stringify({ period: "February 2026", auto_generated: true }),
        },
      });
    }
  }

  // Weekly scores (W08 = periods[2], W09 = periods[3]) — slight variation from monthly
  for (const e of employees) {
    for (const cat of categories) {
      const [janRaw, febRaw] = scoreData[e.id]?.[cat] ?? [0.5, 0.5];
      const w08Raw = Math.max(0, Math.min(1, janRaw + (Math.random() * 0.1 - 0.05)));
      const w09Raw = Math.max(0, Math.min(1, febRaw + (Math.random() * 0.1 - 0.05)));
      const evidenceType = cat === "daily_tasks" ? "jira" : cat === "projects" ? "confluence" : cat === "asset_actions" ? "asset_action" : cat === "quality" ? "positive" : "knowledge";

      await prisma.categoryScore.upsert({
        where: { employeeId_periodId_category: { employeeId: e.id, periodId: periods[2].id, category: cat } },
        update: {},
        create: {
          employeeId: e.id, periodId: periods[2].id, category: cat,
          rawIndex: Math.round(w08Raw * 100) / 100, score: Math.round((3 + w08Raw * 5) * 10) / 10,
          configVersion, evidence: JSON.stringify([{ type: evidenceType, label: `${cat} W08`, details: "Seed" }]),
          metadata: JSON.stringify({ period: "2026-W08", auto_generated: true }),
        },
      });
      await prisma.categoryScore.upsert({
        where: { employeeId_periodId_category: { employeeId: e.id, periodId: periods[3].id, category: cat } },
        update: {},
        create: {
          employeeId: e.id, periodId: periods[3].id, category: cat,
          rawIndex: Math.round(w09Raw * 100) / 100, score: Math.round((3 + w09Raw * 5) * 10) / 10,
          configVersion, evidence: JSON.stringify([{ type: evidenceType, label: `${cat} W09`, details: "Seed" }]),
          metadata: JSON.stringify({ period: "2026-W09", auto_generated: true }),
        },
      });
    }
  }

  // Quarterly scores (Q4-2025 = periods[4], Q1-2026 = periods[5])
  for (const e of employees) {
    for (const cat of categories) {
      const [janRaw, febRaw] = scoreData[e.id]?.[cat] ?? [0.5, 0.5];
      const q4Raw = Math.max(0, Math.min(1, janRaw - 0.05));
      const q1Raw = Math.max(0, Math.min(1, (janRaw + febRaw) / 2));
      const evidenceType = cat === "daily_tasks" ? "jira" : cat === "projects" ? "confluence" : cat === "asset_actions" ? "asset_action" : cat === "quality" ? "positive" : "knowledge";

      await prisma.categoryScore.upsert({
        where: { employeeId_periodId_category: { employeeId: e.id, periodId: periods[4].id, category: cat } },
        update: {},
        create: {
          employeeId: e.id, periodId: periods[4].id, category: cat,
          rawIndex: Math.round(q4Raw * 100) / 100, score: Math.round((3 + q4Raw * 5) * 10) / 10,
          configVersion, evidence: JSON.stringify([{ type: evidenceType, label: `${cat} Q4-2025`, details: "Seed" }]),
          metadata: JSON.stringify({ period: "2025-Q4", auto_generated: true }),
        },
      });
      await prisma.categoryScore.upsert({
        where: { employeeId_periodId_category: { employeeId: e.id, periodId: periods[5].id, category: cat } },
        update: {},
        create: {
          employeeId: e.id, periodId: periods[5].id, category: cat,
          rawIndex: Math.round(q1Raw * 100) / 100, score: Math.round((3 + q1Raw * 5) * 10) / 10,
          configVersion, evidence: JSON.stringify([{ type: evidenceType, label: `${cat} Q1-2026`, details: "Seed" }]),
          metadata: JSON.stringify({ period: "2026-Q1", auto_generated: true }),
        },
      });
    }
  }

  console.log("Upserted category scores (month, week, quarter)");

  // Knowledge scores
  const knowledgeData = [
    { employee: emp["alice@ops.com"], op: 7, asset: 8, compliance: 7, incident: 6 },
    { employee: emp["bob@ops.com"], op: 5, asset: 4, compliance: 5, incident: 4 },
    { employee: emp["carol@ops.com"], op: 9, asset: 8, compliance: 9, incident: 8 },
    { employee: emp["david@ops.com"], op: 4, asset: 3, compliance: 4, incident: 3 },
    { employee: emp["eva@ops.com"], op: 7, asset: 7, compliance: 6, incident: 7 },
    { employee: emp["frank@ops.com"], op: 3, asset: 3, compliance: 4, incident: 3 },
  ];

  for (const kd of knowledgeData) {
    const avg = (kd.op + kd.asset + kd.compliance + kd.incident) / 4;
    const mapped = 3 + ((avg - 1) / 9) * 5;
    await prisma.knowledgeScore.upsert({
      where: { employeeId_periodId: { employeeId: kd.employee.id, periodId: periods[1].id } },
      update: {},
      create: {
        employeeId: kd.employee.id,
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

  // Seed comms threads (skip if already seeded)
  const existingThreadCount = await prisma.commsThread.count();
  let threads: Awaited<ReturnType<typeof prisma.commsThread.create>>[] = [];

  if (existingThreadCount === 0) {
    const threadData = [
      {
        source: "email", sourceThreadRef: "gmail-thread-001",
        participants: JSON.stringify(["client-a@example.com", "ops@company.com"]),
        clientOrPartnerTag: "Client Alpha", subject: "ETH Staking withdrawal request — urgent",
        priority: "P1", status: "InProgress", ownerUserId: emp["alice@ops.com"].id,
        queue: "Transaction Operations", lastMessageAt: new Date("2026-02-28T09:30:00Z"), lastActionAt: new Date("2026-02-28T09:45:00Z"),
      },
      {
        source: "slack", sourceThreadRef: "C01234-1709100000.000001",
        participants: JSON.stringify(["@client-b-ops", "@settlements-team"]),
        clientOrPartnerTag: "Client Beta", subject: "Settlement reconciliation discrepancy Q1",
        priority: "P2", status: "WaitingExternal", ownerUserId: emp["eva@ops.com"].id,
        queue: "Admin Operations", lastMessageAt: new Date("2026-02-27T16:00:00Z"), lastActionAt: new Date("2026-02-27T16:30:00Z"),
      },
      {
        source: "email", sourceThreadRef: "gmail-thread-003",
        participants: JSON.stringify(["partner-x@exchange.com"]),
        clientOrPartnerTag: "Partner X", subject: "New custody onboarding — documentation required",
        priority: "P2", status: "Unassigned", queue: "Transaction Operations",
        lastMessageAt: new Date("2026-02-28T08:00:00Z"), ttoDeadline: new Date("2026-02-28T10:00:00Z"),
      },
      {
        source: "slack", sourceThreadRef: "C05678-1709200000.000002",
        participants: JSON.stringify(["@client-c-team"]),
        clientOrPartnerTag: "Client Gamma", subject: "Transaction stuck — Fireblocks approval pending",
        priority: "P0", status: "Assigned", ownerUserId: emp["david@ops.com"].id,
        queue: "Transaction Operations", lastMessageAt: new Date("2026-02-28T10:15:00Z"), ttfaDeadline: new Date("2026-02-28T10:25:00Z"),
      },
      {
        source: "email", sourceThreadRef: "gmail-thread-005",
        participants: JSON.stringify(["compliance@regulator.gov"]),
        clientOrPartnerTag: "Regulator", subject: "Travel Rule data request — March batch",
        priority: "P1", status: "Assigned", ownerUserId: emp["carol@ops.com"].id,
        queue: "Transaction Operations", lastMessageAt: new Date("2026-02-28T07:00:00Z"), lastActionAt: new Date("2026-02-28T08:30:00Z"),
      },
      {
        source: "email", sourceThreadRef: "gmail-thread-006",
        participants: JSON.stringify(["client-d@example.com"]),
        clientOrPartnerTag: "Client Delta", subject: "Monthly reporting — asset allocation summary",
        priority: "P3", status: "Done", ownerUserId: emp["bob@ops.com"].id,
        queue: "Transaction Operations", lastMessageAt: new Date("2026-02-26T14:00:00Z"), lastActionAt: new Date("2026-02-27T10:00:00Z"),
      },
    ];

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
          employeeId: emp["david@ops.com"].id, periodLabel: "2026-02",
          content: "Quality issues need attention — 3 mistakes in settlements this month. Scheduling coaching session.",
          noteType: "manager", authorId: emp["carol@ops.com"].id,
        },
        {
          employeeId: emp["david@ops.com"].id, periodLabel: "2026-02",
          content: "Was on-call week of Feb 16. Multiple incident responses impacted normal throughput.",
          noteType: "context", authorId: emp["david@ops.com"].id,
        },
        {
          employeeId: emp["frank@ops.com"].id, periodLabel: "2026-02",
          content: "Showing good improvement in second month. Asset knowledge growing. Assigned mentor.",
          noteType: "manager", authorId: emp["carol@ops.com"].id,
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
          employeeId: emp["david@ops.com"].id, type: "mistakes_rising", priority: "P2",
          message: "David Park — quality score dropped from 5.5 to 4.8 this month",
          status: "active", destination: "in_app",
        },
      ],
    });

    console.log("Created alerts");
  } else {
    console.log(`Skipping comms/notes/alerts seed — ${existingThreadCount} threads already exist`);
  }

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

  // ─── Seed Schedule Data ───

  // Public Holidays 2026
  const holidayData = [
    { date: new Date("2026-01-01"), name: "New Year's Day", region: "Global" },
    { date: new Date("2026-04-03"), name: "Good Friday", region: "Global" },
    { date: new Date("2026-04-06"), name: "Easter Monday", region: "EMEA" },
    { date: new Date("2026-05-04"), name: "Early May Bank Holiday", region: "EMEA" },
    { date: new Date("2026-05-25"), name: "Spring Bank Holiday", region: "EMEA" },
    { date: new Date("2026-07-04"), name: "Independence Day", region: "Americas" },
    { date: new Date("2026-08-31"), name: "Summer Bank Holiday", region: "EMEA" },
    { date: new Date("2026-12-25"), name: "Christmas Day", region: "Global" },
    { date: new Date("2026-12-26"), name: "Boxing Day", region: "EMEA" },
    { date: new Date("2026-01-26"), name: "Republic Day", region: "APAC" },
    { date: new Date("2026-02-19"), name: "Chinese New Year", region: "APAC" },
  ];

  for (const h of holidayData) {
    await prisma.publicHoliday.upsert({
      where: { date_region: { date: h.date, region: h.region } },
      update: {},
      create: h,
    });
  }
  console.log("Upserted public holidays");

  // PTO records (a few sample entries)
  const existingPto = await prisma.ptoRecord.count();
  if (existingPto === 0) {
    await prisma.ptoRecord.createMany({
      data: [
        { employeeId: emp["alice@ops.com"].id, startDate: new Date("2026-03-09"), endDate: new Date("2026-03-13"), type: "annual_leave", status: "approved", notes: "Spring break" },
        { employeeId: emp["bob@ops.com"].id, startDate: new Date("2026-03-16"), endDate: new Date("2026-03-17"), type: "sick", status: "approved" },
        { employeeId: emp["liam@ops.com"].id, startDate: new Date("2026-03-05"), endDate: new Date("2026-03-06"), type: "wfh", status: "approved", notes: "WFH — late shift" },
        { employeeId: emp["eva@ops.com"].id, startDate: new Date("2026-03-20"), endDate: new Date("2026-03-27"), type: "annual_leave", status: "approved", notes: "Family holiday" },
        { employeeId: emp["nikhil@ops.com"].id, startDate: new Date("2026-03-10"), endDate: new Date("2026-03-11"), type: "annual_leave", status: "approved", notes: "Personal" },
      ],
    });
    console.log("Created PTO records");
  }

  // On-Call Schedule — this week
  const existingOnCall = await prisma.onCallSchedule.count();
  if (existingOnCall === 0) {
    // Generate on-call for Mon-Fri of current week (March 2-6, 2026)
    const onCallRotation = [
      { team: "Transaction Operations", employees: [emp["alice@ops.com"], emp["carol@ops.com"], emp["grace@ops.com"]] },
      { team: "Admin Operations", employees: [emp["bob@ops.com"], emp["eva@ops.com"]] },
      { team: "Data Operations", employees: [emp["david@ops.com"], emp["frank@ops.com"]] },
    ];

    const weekStart = new Date("2026-03-02");
    for (let day = 0; day < 5; day++) {
      const date = new Date(weekStart.getTime() + day * 86400000);
      for (const rotation of onCallRotation) {
        const primaryIdx = day % rotation.employees.length;
        await prisma.onCallSchedule.upsert({
          where: { date_team_shiftType: { date, team: rotation.team, shiftType: "primary" } },
          update: {},
          create: {
            date,
            team: rotation.team,
            shiftType: "primary",
            employeeId: rotation.employees[primaryIdx].id,
          },
        });
      }
    }
    console.log("Created on-call schedule");
  }

  // Daily Tasks — sample tasks for today (March 3, 2026)
  const existingTasks = await prisma.dailyTask.count();
  if (existingTasks === 0) {
    const today = new Date("2026-03-03");
    const taskData = [
      // Transaction Operations tasks — allocated across sub-teams
      { date: today, team: "Transaction Operations", title: "Process ETH staking withdrawals batch", priority: "high", category: "operational", assigneeId: emp["alice@ops.com"].id, createdById: emp["carol@ops.com"].id },
      { date: today, team: "Transaction Operations", title: "Review pending Fireblocks approvals", priority: "urgent", category: "operational", assigneeId: emp["grace@ops.com"].id, createdById: emp["carol@ops.com"].id },
      { date: today, team: "Transaction Operations", title: "Client Alpha — confirm withdrawal timeline", priority: "normal", category: "client", assigneeId: emp["maria@ops.com"].id, createdById: emp["carol@ops.com"].id },
      { date: today, team: "Transaction Operations", title: "Travel rule response — Partner X", priority: "high", category: "compliance", assigneeId: emp["kenji@ops.com"].id, createdById: emp["carol@ops.com"].id },
      { date: today, team: "Transaction Operations", title: "New custody onboarding documentation", priority: "normal", category: "client", assigneeId: emp["sophie@ops.com"].id, createdById: emp["carol@ops.com"].id },
      { date: today, team: "Transaction Operations", title: "Late shift handover — pending items review", priority: "normal", category: "operational", assigneeId: emp["liam@ops.com"].id, createdById: emp["carol@ops.com"].id },
      { date: today, team: "Transaction Operations", title: "Update custody onboarding checklist", priority: "low", category: "administrative", createdById: emp["carol@ops.com"].id },

      // Admin Operations tasks
      { date: today, team: "Admin Operations", title: "Settlement reconciliation Q1 review", priority: "high", category: "compliance", assigneeId: emp["eva@ops.com"].id, createdById: emp["eva@ops.com"].id },
      { date: today, team: "Admin Operations", title: "Client Beta — resolve discrepancy report", priority: "normal", category: "client", assigneeId: emp["bob@ops.com"].id, createdById: emp["eva@ops.com"].id },
      { date: today, team: "Admin Operations", title: "Monthly reporting — asset allocation summary", priority: "normal", category: "administrative", assigneeId: emp["bob@ops.com"].id, createdById: emp["eva@ops.com"].id },

      // Data Operations tasks
      { date: today, team: "Data Operations", title: "Notabene travel rule data reconciliation", priority: "high", category: "compliance", assigneeId: emp["david@ops.com"].id, createdById: emp["david@ops.com"].id },
      { date: today, team: "Data Operations", title: "Update VASP contact directory", priority: "normal", category: "operational", assigneeId: emp["frank@ops.com"].id, createdById: emp["david@ops.com"].id },
      { date: today, team: "Data Operations", title: "Staking rewards calculation audit", priority: "normal", category: "operational", createdById: emp["david@ops.com"].id },
    ];

    for (const t of taskData) {
      await prisma.dailyTask.create({ data: t });
    }
    console.log("Created daily tasks");
  }

  // ─── Seed Projects ───

  const existingProjects = await prisma.project.count();
  if (existingProjects === 0) {
    const projectData = [
      {
        name: "Custody Onboarding Automation",
        description: "Automate the custody onboarding workflow to reduce manual steps and speed up client activation. Includes document collection, KYC integration, and wallet provisioning.",
        team: "Transaction Operations",
        leadId: emp["carol@ops.com"].id,
        status: "active",
        priority: "high",
        startDate: new Date("2026-01-15"),
        targetDate: new Date("2026-04-30"),
        progress: 45,
        tags: JSON.stringify(["automation", "onboarding", "Q1"]),
      },
      {
        name: "Travel Rule Compliance Enhancement",
        description: "Improve travel rule compliance workflow with Notabene auto-matching, bulk case resolution, and VASP directory enrichment.",
        team: "Data Operations",
        leadId: emp["david@ops.com"].id,
        status: "active",
        priority: "critical",
        startDate: new Date("2026-02-01"),
        targetDate: new Date("2026-03-31"),
        progress: 70,
        tags: JSON.stringify(["compliance", "travel-rule", "notabene"]),
      },
      {
        name: "Settlement Process Optimization",
        description: "Reduce settlement reconciliation time from 4h to 1h through automated matching and exception-based review.",
        team: "Admin Operations",
        leadId: emp["eva@ops.com"].id,
        status: "active",
        priority: "medium",
        startDate: new Date("2026-02-10"),
        targetDate: new Date("2026-05-15"),
        progress: 25,
        tags: JSON.stringify(["settlements", "optimization"]),
      },
      {
        name: "Client Reporting Dashboard",
        description: "Build a client-facing reporting dashboard showing portfolio, transaction history, and staking rewards.",
        team: "Transaction Operations",
        leadId: emp["carol@ops.com"].id,
        status: "planned",
        priority: "medium",
        startDate: new Date("2026-04-01"),
        targetDate: new Date("2026-06-30"),
        progress: 0,
        tags: JSON.stringify(["reporting", "client-facing", "Q2"]),
      },
      {
        name: "HiBob Integration for PTO Sync",
        description: "Integrate with HiBob API to automatically sync employee PTO records into the on-call scheduling system.",
        team: "Data Operations",
        leadId: emp["david@ops.com"].id,
        status: "planned",
        priority: "low",
        startDate: null,
        targetDate: null,
        progress: 0,
        tags: JSON.stringify(["integration", "hibob", "scheduling"]),
      },
      {
        name: "SLA Monitoring Improvements",
        description: "Enhance SLA monitoring with real-time Slack alerts, escalation chains, and historical SLA compliance reports.",
        team: "Admin Operations",
        leadId: emp["eva@ops.com"].id,
        status: "on_hold",
        priority: "medium",
        startDate: new Date("2026-01-20"),
        targetDate: new Date("2026-03-15"),
        progress: 35,
        tags: JSON.stringify(["sla", "monitoring", "alerts"]),
      },
    ];

    for (const p of projectData) {
      const project = await prisma.project.create({ data: p });

      // Add lead as member
      await prisma.projectMember.create({
        data: { projectId: project.id, employeeId: p.leadId, role: "lead" },
      });

      // Add 1-2 additional members
      const otherMembers = employees.filter((e) => e.id !== p.leadId && e.team === p.team);
      for (const m of otherMembers.slice(0, 2)) {
        await prisma.projectMember.create({
          data: { projectId: project.id, employeeId: m.id, role: "contributor" },
        });
      }
    }

    // Add some project updates
    const allProjects = await prisma.project.findMany({ where: { status: { not: "planned" } } });
    const updateData = [
      { type: "progress", content: "Completed document collection module. Working on KYC API integration next.", progress: 45 },
      { type: "milestone", content: "Auto-matching engine deployed to staging. 85% match rate on test data.", progress: 70 },
      { type: "blocker", content: "Waiting on settlement team to provide reconciliation file format spec.", progress: null },
      { type: "progress", content: "Initial SLA dashboard mockups completed. On hold pending alert system refactor.", progress: 35 },
      { type: "progress", content: "Fireblocks webhook integration completed. Moving to wallet provisioning flow.", progress: 30 },
      { type: "note", content: "Discussed with compliance team — need to add beneficiary name validation before go-live.", progress: null },
    ];

    for (let i = 0; i < Math.min(allProjects.length, updateData.length); i++) {
      await prisma.projectUpdate.create({
        data: {
          projectId: allProjects[i].id,
          authorId: allProjects[i].leadId,
          ...updateData[i],
          createdAt: new Date(Date.now() - (updateData.length - i) * 86400000),
        },
      });
    }

    console.log("Created projects with members and updates");
  }

  // ─── Seed Sub-Teams & Rota Assignments ───

  const existingSubTeams = await prisma.subTeam.count();
  if (existingSubTeams === 0) {
    // 3 sub-teams within Transaction Operations
    const subTeams = await Promise.all([
      prisma.subTeam.create({
        data: {
          name: "Team 1",
          parentTeam: "Transaction Operations",
          description: "Client custody onboarding, KYC documentation, wallet provisioning",
          sortOrder: 1,
        },
      }),
      prisma.subTeam.create({
        data: {
          name: "Team 2",
          parentTeam: "Transaction Operations",
          description: "Staking, withdrawals, Fireblocks approvals, settlement execution",
          sortOrder: 2,
        },
      }),
      prisma.subTeam.create({
        data: {
          name: "Team 3",
          parentTeam: "Transaction Operations",
          description: "Travel rule compliance, Notabene matching, regulatory reporting",
          sortOrder: 3,
        },
      }),
    ]);

    console.log("Created sub-teams");

    // Rota assignments model the real team structure:
    // - 3 leads (Carol, Grace, Kenji) stay on the same sub-team for a month
    // - Junior analysts rotate between sub-teams weekly
    // - Liam always works the late shift from home (London)
    // - APAC (Hong Kong) and Jersey staff share weekend coverage
    // Week 1: March 2-6, 2026 — Week 2: March 9-13, 2026
    const currentWeekStart = new Date("2026-03-02");
    const currentWeekEnd = new Date("2026-03-06");
    const nextWeekStart = new Date("2026-03-09");
    const nextWeekEnd = new Date("2026-03-13");

    // Week 1 rota: Carol leads Team 1, Grace leads Team 2, Kenji leads Team 3
    const week1Assignments = [
      // Team 1 — Lead: Carol, Members: Maria, Nikhil
      { subTeamId: subTeams[0].id, employeeId: emp["carol@ops.com"].id, role: "lead", startDate: currentWeekStart, endDate: currentWeekEnd, rotationCycle: "monthly", shiftType: "standard", location: "London" },
      { subTeamId: subTeams[0].id, employeeId: emp["maria@ops.com"].id, role: "member", startDate: currentWeekStart, endDate: currentWeekEnd, rotationCycle: "weekly", shiftType: "standard", location: "London" },
      { subTeamId: subTeams[0].id, employeeId: emp["nikhil@ops.com"].id, role: "member", startDate: currentWeekStart, endDate: currentWeekEnd, rotationCycle: "weekly", shiftType: "standard", location: "Jersey" },

      // Team 2 — Lead: Grace, Members: Alice, Tom, Liam (late shift WFH)
      { subTeamId: subTeams[1].id, employeeId: emp["grace@ops.com"].id, role: "lead", startDate: currentWeekStart, endDate: currentWeekEnd, rotationCycle: "monthly", shiftType: "standard", location: "London" },
      { subTeamId: subTeams[1].id, employeeId: emp["alice@ops.com"].id, role: "member", startDate: currentWeekStart, endDate: currentWeekEnd, rotationCycle: "weekly", shiftType: "standard", location: "Hong Kong" },
      { subTeamId: subTeams[1].id, employeeId: emp["tom@ops.com"].id, role: "member", startDate: currentWeekStart, endDate: currentWeekEnd, rotationCycle: "weekly", shiftType: "standard", location: "Hong Kong" },
      { subTeamId: subTeams[1].id, employeeId: emp["liam@ops.com"].id, role: "member", startDate: currentWeekStart, endDate: currentWeekEnd, rotationCycle: "weekly", shiftType: "late", isWfh: true, location: "London" },

      // Team 3 — Lead: Kenji, Members: Sophie, Yuki
      { subTeamId: subTeams[2].id, employeeId: emp["kenji@ops.com"].id, role: "lead", startDate: currentWeekStart, endDate: currentWeekEnd, rotationCycle: "monthly", shiftType: "standard", location: "Hong Kong" },
      { subTeamId: subTeams[2].id, employeeId: emp["sophie@ops.com"].id, role: "member", startDate: currentWeekStart, endDate: currentWeekEnd, rotationCycle: "weekly", shiftType: "standard", location: "Jersey" },
      { subTeamId: subTeams[2].id, employeeId: emp["yuki@ops.com"].id, role: "member", startDate: currentWeekStart, endDate: currentWeekEnd, rotationCycle: "weekly", shiftType: "standard", location: "Hong Kong" },
    ];

    // Week 2 rota: juniors rotate — same leads, different member assignments
    const week2Assignments = [
      // Team 1 — Lead: Carol, Members: Sophie, Tom (rotated in)
      { subTeamId: subTeams[0].id, employeeId: emp["carol@ops.com"].id, role: "lead", startDate: nextWeekStart, endDate: nextWeekEnd, rotationCycle: "monthly", shiftType: "standard", location: "London" },
      { subTeamId: subTeams[0].id, employeeId: emp["sophie@ops.com"].id, role: "member", startDate: nextWeekStart, endDate: nextWeekEnd, rotationCycle: "weekly", shiftType: "standard", location: "Jersey" },
      { subTeamId: subTeams[0].id, employeeId: emp["tom@ops.com"].id, role: "member", startDate: nextWeekStart, endDate: nextWeekEnd, rotationCycle: "weekly", shiftType: "standard", location: "Hong Kong" },

      // Team 2 — Lead: Grace, Members: Yuki, Nikhil, Liam (late)
      { subTeamId: subTeams[1].id, employeeId: emp["grace@ops.com"].id, role: "lead", startDate: nextWeekStart, endDate: nextWeekEnd, rotationCycle: "monthly", shiftType: "standard", location: "London" },
      { subTeamId: subTeams[1].id, employeeId: emp["yuki@ops.com"].id, role: "member", startDate: nextWeekStart, endDate: nextWeekEnd, rotationCycle: "weekly", shiftType: "standard", location: "Hong Kong" },
      { subTeamId: subTeams[1].id, employeeId: emp["nikhil@ops.com"].id, role: "member", startDate: nextWeekStart, endDate: nextWeekEnd, rotationCycle: "weekly", shiftType: "standard", location: "Jersey" },
      { subTeamId: subTeams[1].id, employeeId: emp["liam@ops.com"].id, role: "member", startDate: nextWeekStart, endDate: nextWeekEnd, rotationCycle: "weekly", shiftType: "late", isWfh: true, location: "London" },

      // Team 3 — Lead: Kenji, Members: Maria, Alice
      { subTeamId: subTeams[2].id, employeeId: emp["kenji@ops.com"].id, role: "lead", startDate: nextWeekStart, endDate: nextWeekEnd, rotationCycle: "monthly", shiftType: "standard", location: "Hong Kong" },
      { subTeamId: subTeams[2].id, employeeId: emp["maria@ops.com"].id, role: "member", startDate: nextWeekStart, endDate: nextWeekEnd, rotationCycle: "weekly", shiftType: "standard", location: "London" },
      { subTeamId: subTeams[2].id, employeeId: emp["alice@ops.com"].id, role: "member", startDate: nextWeekStart, endDate: nextWeekEnd, rotationCycle: "weekly", shiftType: "standard", location: "Hong Kong" },
    ];

    // Weekend shifts — APAC and Jersey share
    const sat = new Date("2026-03-07");
    const sun = new Date("2026-03-08");
    const weekendAssignments = [
      { subTeamId: subTeams[1].id, employeeId: emp["tom@ops.com"].id, role: "member", startDate: sat, endDate: sat, rotationCycle: "weekly" as const, shiftType: "weekend", location: "Hong Kong" },
      { subTeamId: subTeams[1].id, employeeId: emp["nikhil@ops.com"].id, role: "member", startDate: sun, endDate: sun, rotationCycle: "weekly" as const, shiftType: "weekend", location: "Jersey" },
    ];

    for (const a of [...week1Assignments, ...week2Assignments, ...weekendAssignments]) {
      await prisma.rotaAssignment.upsert({
        where: {
          subTeamId_employeeId_startDate: {
            subTeamId: a.subTeamId,
            employeeId: a.employeeId,
            startDate: a.startDate,
          },
        },
        update: {},
        create: {
          subTeamId: a.subTeamId,
          employeeId: a.employeeId,
          role: a.role,
          startDate: a.startDate,
          endDate: a.endDate,
          rotationCycle: a.rotationCycle,
          shiftType: a.shiftType,
          isWfh: "isWfh" in a ? (a as Record<string, unknown>).isWfh === true : false,
          location: a.location,
        },
      });
    }

    console.log("Created sub-team rota assignments");
  }

  // ─── Seed Activity Status ───

  const existingActivity = await prisma.activityStatus.count();
  if (existingActivity === 0) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 0, 0);

    // Some completed activities from earlier today
    const completedActivities = [
      { employeeId: emp["carol@ops.com"].id, activity: "meeting", detail: "Morning standup", startedAt: new Date(todayStart.getTime()), endedAt: new Date(todayStart.getTime() + 30 * 60000), durationMin: 30 },
      { employeeId: emp["grace@ops.com"].id, activity: "meeting", detail: "Morning standup", startedAt: new Date(todayStart.getTime()), endedAt: new Date(todayStart.getTime() + 30 * 60000), durationMin: 30 },
      { employeeId: emp["alice@ops.com"].id, activity: "meeting", detail: "Morning standup", startedAt: new Date(todayStart.getTime()), endedAt: new Date(todayStart.getTime() + 30 * 60000), durationMin: 30 },
      { employeeId: emp["carol@ops.com"].id, activity: "bau", detail: "Email triage", startedAt: new Date(todayStart.getTime() + 30 * 60000), endedAt: new Date(todayStart.getTime() + 90 * 60000), durationMin: 60 },
      { employeeId: emp["grace@ops.com"].id, activity: "queue_monitoring", detail: "Fireblocks queue", startedAt: new Date(todayStart.getTime() + 30 * 60000), endedAt: new Date(todayStart.getTime() + 150 * 60000), durationMin: 120 },
      { employeeId: emp["maria@ops.com"].id, activity: "bau", detail: "Client onboarding docs", startedAt: new Date(todayStart.getTime() + 30 * 60000), endedAt: new Date(todayStart.getTime() + 180 * 60000), durationMin: 150 },
      { employeeId: emp["kenji@ops.com"].id, activity: "bau", detail: "Travel rule matching", startedAt: new Date(todayStart.getTime() + 30 * 60000), endedAt: new Date(todayStart.getTime() + 180 * 60000), durationMin: 150 },
    ];

    for (const a of completedActivities) {
      await prisma.activityStatus.create({ data: a });
    }

    // Currently active activities
    const currentActivities = [
      { employeeId: emp["carol@ops.com"].id, activity: "project", detail: "Custody Onboarding Automation", startedAt: new Date(now.getTime() - 45 * 60000) },
      { employeeId: emp["grace@ops.com"].id, activity: "bau", detail: "Staking withdrawals batch", startedAt: new Date(now.getTime() - 30 * 60000) },
      { employeeId: emp["alice@ops.com"].id, activity: "queue_monitoring", detail: "Transaction queue", startedAt: new Date(now.getTime() - 60 * 60000) },
      { employeeId: emp["kenji@ops.com"].id, activity: "bau", detail: "Notabene travel rule review", startedAt: new Date(now.getTime() - 25 * 60000) },
      { employeeId: emp["maria@ops.com"].id, activity: "lunch", detail: "", startedAt: new Date(now.getTime() - 15 * 60000) },
      { employeeId: emp["liam@ops.com"].id, activity: "bau", detail: "Late shift handover review", startedAt: new Date(now.getTime() - 10 * 60000) },
      { employeeId: emp["sophie@ops.com"].id, activity: "project", detail: "Client reporting dashboard", startedAt: new Date(now.getTime() - 40 * 60000) },
      { employeeId: emp["nikhil@ops.com"].id, activity: "queue_monitoring", detail: "Settlement queue", startedAt: new Date(now.getTime() - 55 * 60000) },
      { employeeId: emp["tom@ops.com"].id, activity: "training", detail: "Fireblocks certification", startedAt: new Date(now.getTime() - 35 * 60000) },
      { employeeId: emp["yuki@ops.com"].id, activity: "bau", detail: "VASP directory updates", startedAt: new Date(now.getTime() - 20 * 60000) },
    ];

    for (const a of currentActivities) {
      await prisma.activityStatus.create({ data: a });
    }

    console.log("Created activity status entries");
  }

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
