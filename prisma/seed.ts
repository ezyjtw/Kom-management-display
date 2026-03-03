import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Create employees (upsert to be idempotent)
  const employeeData = [
    { name: "Alice Chen", email: "alice@ops.com", role: "Senior", team: "Transaction Operations", region: "APAC" },
    { name: "Bob Martinez", email: "bob@ops.com", role: "Analyst", team: "Admin Operations", region: "Americas" },
    { name: "Carol Davies", email: "carol@ops.com", role: "Lead", team: "Transaction Operations", region: "EMEA" },
    { name: "David Park", email: "david@ops.com", role: "Analyst", team: "Data Operations", region: "APAC" },
    { name: "Eva Kowalski", email: "eva@ops.com", role: "Senior", team: "Admin Operations", region: "EMEA" },
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

  // Weekly scores (W08 = periods[2], W09 = periods[3]) — slight variation from monthly
  for (const emp of employees) {
    for (const cat of categories) {
      const [janRaw, febRaw] = scoreData[emp.id]?.[cat] ?? [0.5, 0.5];
      const w08Raw = Math.max(0, Math.min(1, janRaw + (Math.random() * 0.1 - 0.05)));
      const w09Raw = Math.max(0, Math.min(1, febRaw + (Math.random() * 0.1 - 0.05)));
      const evidenceType = cat === "daily_tasks" ? "jira" : cat === "projects" ? "confluence" : cat === "asset_actions" ? "asset_action" : cat === "quality" ? "positive" : "knowledge";

      await prisma.categoryScore.upsert({
        where: { employeeId_periodId_category: { employeeId: emp.id, periodId: periods[2].id, category: cat } },
        update: {},
        create: {
          employeeId: emp.id, periodId: periods[2].id, category: cat,
          rawIndex: Math.round(w08Raw * 100) / 100, score: Math.round((3 + w08Raw * 5) * 10) / 10,
          configVersion, evidence: JSON.stringify([{ type: evidenceType, label: `${cat} W08`, details: "Seed" }]),
          metadata: JSON.stringify({ period: "2026-W08", auto_generated: true }),
        },
      });
      await prisma.categoryScore.upsert({
        where: { employeeId_periodId_category: { employeeId: emp.id, periodId: periods[3].id, category: cat } },
        update: {},
        create: {
          employeeId: emp.id, periodId: periods[3].id, category: cat,
          rawIndex: Math.round(w09Raw * 100) / 100, score: Math.round((3 + w09Raw * 5) * 10) / 10,
          configVersion, evidence: JSON.stringify([{ type: evidenceType, label: `${cat} W09`, details: "Seed" }]),
          metadata: JSON.stringify({ period: "2026-W09", auto_generated: true }),
        },
      });
    }
  }

  // Quarterly scores (Q4-2025 = periods[4], Q1-2026 = periods[5])
  for (const emp of employees) {
    for (const cat of categories) {
      const [janRaw, febRaw] = scoreData[emp.id]?.[cat] ?? [0.5, 0.5];
      const q4Raw = Math.max(0, Math.min(1, janRaw - 0.05));
      const q1Raw = Math.max(0, Math.min(1, (janRaw + febRaw) / 2));
      const evidenceType = cat === "daily_tasks" ? "jira" : cat === "projects" ? "confluence" : cat === "asset_actions" ? "asset_action" : cat === "quality" ? "positive" : "knowledge";

      await prisma.categoryScore.upsert({
        where: { employeeId_periodId_category: { employeeId: emp.id, periodId: periods[4].id, category: cat } },
        update: {},
        create: {
          employeeId: emp.id, periodId: periods[4].id, category: cat,
          rawIndex: Math.round(q4Raw * 100) / 100, score: Math.round((3 + q4Raw * 5) * 10) / 10,
          configVersion, evidence: JSON.stringify([{ type: evidenceType, label: `${cat} Q4-2025`, details: "Seed" }]),
          metadata: JSON.stringify({ period: "2025-Q4", auto_generated: true }),
        },
      });
      await prisma.categoryScore.upsert({
        where: { employeeId_periodId_category: { employeeId: emp.id, periodId: periods[5].id, category: cat } },
        update: {},
        create: {
          employeeId: emp.id, periodId: periods[5].id, category: cat,
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

  // Seed comms threads (skip if already seeded)
  const existingThreadCount = await prisma.commsThread.count();
  let threads: Awaited<ReturnType<typeof prisma.commsThread.create>>[] = [];

  if (existingThreadCount === 0) {
    const threadData = [
      {
        source: "email", sourceThreadRef: "gmail-thread-001",
        participants: JSON.stringify(["client-a@example.com", "ops@company.com"]),
        clientOrPartnerTag: "Client Alpha", subject: "ETH Staking withdrawal request — urgent",
        priority: "P1", status: "InProgress", ownerUserId: employees[0].id,
        queue: "Transaction Operations", lastMessageAt: new Date("2026-02-28T09:30:00Z"), lastActionAt: new Date("2026-02-28T09:45:00Z"),
      },
      {
        source: "slack", sourceThreadRef: "C01234-1709100000.000001",
        participants: JSON.stringify(["@client-b-ops", "@settlements-team"]),
        clientOrPartnerTag: "Client Beta", subject: "Settlement reconciliation discrepancy Q1",
        priority: "P2", status: "WaitingExternal", ownerUserId: employees[4].id,
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
        priority: "P0", status: "Assigned", ownerUserId: employees[3].id,
        queue: "Transaction Operations", lastMessageAt: new Date("2026-02-28T10:15:00Z"), ttfaDeadline: new Date("2026-02-28T10:25:00Z"),
      },
      {
        source: "email", sourceThreadRef: "gmail-thread-005",
        participants: JSON.stringify(["compliance@regulator.gov"]),
        clientOrPartnerTag: "Regulator", subject: "Travel Rule data request — March batch",
        priority: "P1", status: "Assigned", ownerUserId: employees[2].id,
        queue: "Transaction Operations", lastMessageAt: new Date("2026-02-28T07:00:00Z"), lastActionAt: new Date("2026-02-28T08:30:00Z"),
      },
      {
        source: "email", sourceThreadRef: "gmail-thread-006",
        participants: JSON.stringify(["client-d@example.com"]),
        clientOrPartnerTag: "Client Delta", subject: "Monthly reporting — asset allocation summary",
        priority: "P3", status: "Done", ownerUserId: employees[1].id,
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
        { employeeId: employees[0].id, startDate: new Date("2026-03-09"), endDate: new Date("2026-03-13"), type: "annual_leave", status: "approved", notes: "Spring break" },
        { employeeId: employees[1].id, startDate: new Date("2026-03-16"), endDate: new Date("2026-03-17"), type: "sick", status: "approved" },
        { employeeId: employees[3].id, startDate: new Date("2026-03-05"), endDate: new Date("2026-03-06"), type: "wfh", status: "approved", notes: "Remote" },
        { employeeId: employees[4].id, startDate: new Date("2026-03-20"), endDate: new Date("2026-03-27"), type: "annual_leave", status: "approved", notes: "Family holiday" },
      ],
    });
    console.log("Created PTO records");
  }

  // On-Call Schedule — this week
  const existingOnCall = await prisma.onCallSchedule.count();
  if (existingOnCall === 0) {
    // Generate on-call for Mon-Fri of current week (March 2-6, 2026)
    const onCallRotation = [
      { team: "Transaction Operations", employees: [employees[0], employees[2]] },
      { team: "Admin Operations", employees: [employees[1], employees[4]] },
      { team: "Data Operations", employees: [employees[3], employees[5]] },
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
      // Transaction Operations tasks
      { date: today, team: "Transaction Operations", title: "Process ETH staking withdrawals batch", priority: "high", category: "operational", assigneeId: employees[0].id, createdById: employees[2].id },
      { date: today, team: "Transaction Operations", title: "Review pending Fireblocks approvals", priority: "urgent", category: "operational", assigneeId: employees[2].id, createdById: employees[2].id },
      { date: today, team: "Transaction Operations", title: "Client Alpha — confirm withdrawal timeline", priority: "normal", category: "client", assigneeId: employees[0].id, createdById: employees[2].id },
      { date: today, team: "Transaction Operations", title: "Update custody onboarding checklist", priority: "low", category: "administrative", createdById: employees[2].id },

      // Admin Operations tasks
      { date: today, team: "Admin Operations", title: "Settlement reconciliation Q1 review", priority: "high", category: "compliance", assigneeId: employees[4].id, createdById: employees[4].id },
      { date: today, team: "Admin Operations", title: "Client Beta — resolve discrepancy report", priority: "normal", category: "client", assigneeId: employees[1].id, createdById: employees[4].id },
      { date: today, team: "Admin Operations", title: "Monthly reporting — asset allocation summary", priority: "normal", category: "administrative", assigneeId: employees[1].id, createdById: employees[4].id },

      // Data Operations tasks
      { date: today, team: "Data Operations", title: "Notabene travel rule data reconciliation", priority: "high", category: "compliance", assigneeId: employees[3].id, createdById: employees[3].id },
      { date: today, team: "Data Operations", title: "Update VASP contact directory", priority: "normal", category: "operational", assigneeId: employees[5].id, createdById: employees[3].id },
      { date: today, team: "Data Operations", title: "Staking rewards calculation audit", priority: "normal", category: "operational", createdById: employees[3].id },
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
        leadId: employees[2].id,
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
        leadId: employees[3].id,
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
        leadId: employees[4].id,
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
        leadId: employees[2].id,
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
        leadId: employees[3].id,
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
        leadId: employees[4].id,
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
