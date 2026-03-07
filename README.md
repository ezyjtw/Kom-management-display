# KOMmand Centre

Ops Team Management Dashboard with integrated Communications & Ownership Hub.

## Features

### Performance Dashboard
- **Team Overview** — All employees with 5 category scores (3-8 scale), overall score, trends, and risk flags
- **Employee Detail** — Scorecard, trend charts, evidence panels (Jira tickets, Confluence pages, asset actions, quality events), notes
- **Scoring Engine** — Configurable weights, per-role targets, PTO adjustments, clamped 3-8 range

### Scoring Categories
1. **Daily Tasks** (Jira) — ticket throughput, on-time rate, cycle time, reopened rate
2. **Projects** (Confluence) — pages created/updated, quality markers
3. **Asset Actions** — client operations completed, SLA compliance, complexity
4. **Mistakes vs Positives** — severity-weighted errors offset by proactive improvements
5. **Crypto Knowledge** — manual rubric scored monthly (operational, asset, compliance, incident response)

### Communications & Ownership Module
- **Unified Inbox** — Email + Slack threads in one view
- **Ownership Workflow** — Assign, transfer, handover notes, audit trail
- **SLA Timers** — Time-to-Ownership (TTO), Time-to-First-Action (TTFA), Time-Since-Last-Action (TSLA)
- **Alerts** — SLA breach, ownership change, excessive bouncing notifications
- **Thread Detail** — Messages, internal notes, linked records (Jira/Fireblocks/Confluence)

### Admin Panel
- Scoring weight configuration with version control
- Role-based target management (Analyst/Senior/Lead)
- Crypto knowledge rubric scoring
- Employee management
- Audit log

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Database**: PostgreSQL via Prisma ORM
- **Auth**: NextAuth.js (JWT sessions, role-based access)
- **Charts**: Recharts
- **Icons**: Lucide React

## Getting Started

### Prerequisites
- Node.js 20+
- PostgreSQL (local or hosted)

### Setup

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env and set DATABASE_URL to your PostgreSQL connection string

# Generate Prisma client
npx prisma generate

# Run migrations and seed database
npx prisma migrate deploy
npx tsx prisma/seed.ts

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — redirects to the Command Centre dashboard.

### Local PostgreSQL (Docker)

If you don't have PostgreSQL installed locally:

```bash
docker run -d --name kommand-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=kommand -p 5432:5432 postgres:16
# Then set DATABASE_URL="postgresql://postgres:postgres@localhost:5432/kommand"
```

## Project Structure

```
src/
├── app/
│   ├── dashboard/          # Team Overview page
│   ├── employee/[id]/      # Employee Detail page
│   ├── comms/              # Communications Inbox
│   ├── comms/thread/[id]/  # Thread Detail
│   ├── admin/              # Admin Panel (config, employees, knowledge)
│   └── api/                # REST API routes
│       ├── employees/      # CRUD + detail
│       ├── scores/         # Category scores + overview
│       ├── scoring-config/ # Config versioning
│       ├── comms/threads/  # Thread CRUD + SLA
│       ├── comms/alerts/   # Alert management
│       ├── audit/          # Audit log
│       └── export/         # CSV/JSON export
├── components/
│   ├── dashboard/          # ScoreCard, Evidence, Stats
│   ├── comms/              # ThreadList, ThreadDetail
│   └── shared/             # Sidebar, ScoreBadge, StatusBadge
├── lib/
│   ├── prisma.ts           # DB client
│   ├── scoring.ts          # Scoring engine + formulas
│   ├── sla.ts              # SLA computation
│   ├── auth-options.ts     # NextAuth config
│   └── auth-user.ts        # RBAC helpers (requireAuth, requireRole)
└── types/                  # TypeScript type definitions
```

## Integration Points (Production)

- **Jira API** — Auto-pull tickets, status, assignee, dates
- **Confluence API** — Auto-pull pages, authors, labels
- **Slack** — Webhook/API ingestion for channel messages
- **Email** — IMAP/OAuth for shared mailbox ingestion
- **Fireblocks** — Transaction/approval state tracking
