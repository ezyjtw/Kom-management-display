/**
 * ALR-HB-WORKER fires from outside the worker (spec §6.1).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

const prismaMock = vi.hoisted(() => ({
  backgroundJob: { count: vi.fn() },
  alert: { count: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { checkWorkerHealth, WORKER_ALERT_TYPE } from "@/lib/worker-health";

describe("checkWorkerHealth", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fires one ALR-HB-WORKER alert when no heartbeat is recent", async () => {
    prismaMock.backgroundJob.count.mockResolvedValue(0);
    prismaMock.alert.count.mockResolvedValue(0);

    expect(await checkWorkerHealth()).toEqual({ workerAlive: false });
    expect(prismaMock.alert.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.alert.create.mock.calls[0][0].data).toMatchObject({ type: WORKER_ALERT_TYPE, severity: "critical" });

    const cutoff = prismaMock.backgroundJob.count.mock.calls[0][0].where.lastRunAt.gte as Date;
    expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(120_000 - 50);
  });

  it("does not duplicate an alert that is already open", async () => {
    prismaMock.backgroundJob.count.mockResolvedValue(0);
    prismaMock.alert.count.mockResolvedValue(1);
    await checkWorkerHealth();
    expect(prismaMock.alert.create).not.toHaveBeenCalled();
  });

  it("resolves the alert once a heartbeat returns", async () => {
    prismaMock.backgroundJob.count.mockResolvedValue(1);
    expect(await checkWorkerHealth()).toEqual({ workerAlive: true });
    expect(prismaMock.alert.updateMany.mock.calls[0][0].data.status).toBe("resolved");
    expect(prismaMock.alert.create).not.toHaveBeenCalled();
  });
});

describe("deployment wiring", () => {
  const root = path.resolve(__dirname, "../..");
  const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");

  it("/api/health exposes worker_alive", () => {
    expect(read("src/app/api/health/route.ts")).toContain("worker_alive");
  });

  it("docker-compose runs a worker service from the same image", () => {
    const compose = read("docker-compose.yml");
    // The image has no npm (Phase 12h): the worker runs with node directly, labelled for credential-use audit.
    expect(compose).toMatch(/\n  worker:\n[\s\S]*command: \["node", "worker\.js"\]/);
    expect(compose).toMatch(/\n  worker:\n[\s\S]*KOM_WORKLOAD=worker/);
  });

  it("Railway config is out of the default deploy path (H10)", () => {
    expect(fs.existsSync(path.join(root, "railway.toml"))).toBe(false);
    expect(fs.existsSync(path.join(root, "railway.json"))).toBe(false);
    expect(fs.existsSync(path.join(root, "Procfile"))).toBe(false);
  });

  it("start.sh never seeds the production tier and otherwise requires ALLOW_SEED=true (or a demo rebuild)", () => {
    const sh = read("start.sh");
    // A production build is the production tier unless KOM_ENVIRONMENT=demo (Phase 12j).
    // KOM_ENVIRONMENT=production always wins; Railway with it unset is demo (H10); otherwise a production build is production.
    expect(sh).toMatch(/elif \[ "\$\{KOM_ENVIRONMENT\}" = "production" \]; then\n\s*TIER="production"\n\s*elif \[ "\$\{ON_RAILWAY\}" = "true" \]; then\n\s*TIER="demo"\n\s*elif \[ "\$\{NODE_ENV\}" = "production" \]; then\n\s*TIER="production"/);
    expect(sh).toMatch(/if \[ "\$\{TIER\}" = "production" \]; then\n[^\n]*\n[^\n]*\n\s*echo "Skipping seed \(never seeds in production\)"/);
    expect(sh).toMatch(/elif \[ "\$\{ALLOW_SEED\}" = "true" \] \|\| \[ "\$\{FORCE_SEED\}" = "true" \]; then\n[\s\S]*node prisma\/seed\.js/);
    // FORCE_SEED is set only by the demo-tier rebuild of a pre-baseline database.
    expect(sh.match(/FORCE_SEED="true"/g)).toHaveLength(1);
  });
});
