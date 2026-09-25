/** Load review (Phase 12n): tables that grew without limit have a retention policy. */
import { describe, it, expect } from "vitest";
import { DEFAULT_RETENTION_POLICIES } from "@/lib/data-retention";

describe("retention policies", () => {
  const by = (model: string) => DEFAULT_RETENTION_POLICIES.find((p) => p.model === model);

  it("removes source records only once the source stopped returning them", () => {
    expect(by("sourceRecord")).toMatchObject({ dateField: "lastSeenAt", retentionDays: 365 });
  });

  it("removes Jira update history well outside the 5-minute sync window", () => {
    expect(by("jiraIssueEvent")!.retentionDays).toBeGreaterThanOrEqual(30);
  });

  it("never deletes audit evidence", () => {
    expect(by("auditLog")).toBeUndefined();
    expect(by("backgroundJobRun")).toBeUndefined();
  });
});
