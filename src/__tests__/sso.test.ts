/**
 * Entra ID role mapping and login decisions (spec §6.2).
 */
import { describe, it, expect } from "vitest";
import {
  decideSsoLogin,
  parseRoleGroupMap,
  resolveRoleFromGroups,
  groupsFromClaims,
} from "@/lib/sso";

const MAP = parseRoleGroupMap(JSON.stringify({ "g-admin": "admin", "g-lead": "lead", "g-audit": "auditor" }));
const hasEmployee = (known: string[]) => async (email: string) => known.includes(email);

describe("parseRoleGroupMap", () => {
  it("parses a valid map", () => {
    expect(MAP).toEqual({ "g-admin": "admin", "g-lead": "lead", "g-audit": "auditor" });
  });

  it.each([undefined, "", "not json", '{"g":"superuser"}', "[]"])("treats %j as an empty map", (raw) => {
    expect(parseRoleGroupMap(raw)).toEqual({});
  });
});

describe("resolveRoleFromGroups", () => {
  it("picks the highest-privilege mapped role", () => {
    expect(resolveRoleFromGroups(["g-audit", "g-lead"], MAP)).toBe("lead");
    expect(resolveRoleFromGroups(["g-lead", "g-admin"], MAP)).toBe("admin");
  });

  it("returns null when no group is mapped", () => {
    expect(resolveRoleFromGroups(["other"], MAP)).toBeNull();
    expect(resolveRoleFromGroups([], MAP)).toBeNull();
  });
});

describe("groupsFromClaims", () => {
  it("returns null on group overage", () => {
    expect(groupsFromClaims({ _claim_names: { groups: "src1" } })).toBeNull();
  });
});

describe("decideSsoLogin", () => {
  it("allows a mapped user with an Employee record, normalising the email", async () => {
    const d = await decideSsoLogin(
      { preferred_username: "Alice@Komainu.com", groups: ["g-lead"] },
      MAP,
      hasEmployee(["alice@komainu.com"]),
    );
    expect(d).toEqual({ allowed: true, email: "alice@komainu.com", role: "lead" });
  });

  it("denies a user with no mapped group", async () => {
    const d = await decideSsoLogin({ email: "a@k.com", groups: ["other"] }, MAP, hasEmployee(["a@k.com"]));
    expect(d).toMatchObject({ allowed: false, reason: "no_mapped_group" });
  });

  it("denies a first login with no Employee match", async () => {
    const d = await decideSsoLogin({ email: "new@k.com", groups: ["g-admin"] }, MAP, hasEmployee([]));
    expect(d).toMatchObject({ allowed: false, email: "new@k.com", reason: "no_employee" });
  });

  it("denies on group overage and when there is no email", async () => {
    expect(await decideSsoLogin({ email: "a@k.com", _claim_names: { groups: "x" } }, MAP, hasEmployee(["a@k.com"])))
      .toMatchObject({ allowed: false, reason: "group_overage" });
    expect(await decideSsoLogin({ groups: ["g-admin"] }, MAP, hasEmployee([])))
      .toMatchObject({ allowed: false, reason: "no_email" });
  });

  it("denies everyone when ROLE_GROUP_MAP is unset", async () => {
    const d = await decideSsoLogin({ email: "a@k.com", groups: ["g-admin"] }, {}, hasEmployee(["a@k.com"]));
    expect(d).toMatchObject({ allowed: false, reason: "no_mapped_group" });
  });
});
