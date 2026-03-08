# ADR-001: Next.js as Application Shell

## Status
Accepted

## Context
We need a full-stack framework for an internal operations command centre. Requirements include:
- Server-rendered pages for fast initial load
- API routes for backend logic
- TypeScript-first
- Strong ecosystem for UI components (Radix, Tailwind)
- Monorepo-friendly deployment (single container)

## Decision
Use **Next.js 14** with the App Router as the application shell.

## Consequences
- **Positive**: Full-stack in one repo, SSR + client interactivity, API routes colocated, Docker standalone output
- **Negative**: Tied to Vercel ecosystem conventions, App Router patterns still maturing, middleware limitations
- **Mitigation**: Keep business logic in domain services separate from Next.js route handlers to maintain portability
