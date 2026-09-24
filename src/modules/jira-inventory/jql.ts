/** Issue type names referenced in a JQL string (issuetype / type clauses). Lower-cased. */
export function issueTypesInJql(jql: string): string[] {
  const out = new Set<string>();
  const clause = /\b(?:issuetype|type)\s*(?:!=|=|not\s+in|in|~)\s*(\([^)]*\)|"[^"]*"|'[^']*'|[^\s)]+)/gi;
  for (const m of jql.matchAll(clause)) {
    let value = m[1].trim();
    if (value.startsWith("(")) value = value.slice(1, -1);
    for (const part of value.match(/"[^"]*"|'[^']*'|[^,\s][^,]*/g) ?? []) {
      const name = part.trim().replace(/^["']|["']$/g, "").trim();
      if (name && !/^(empty|null)$/i.test(name)) out.add(name.toLowerCase());
    }
  }
  return [...out];
}

/** Project keys referenced in a JQL string (project = X / project in (X, Y)). Upper-cased. */
export function projectsInJql(jql: string): string[] {
  const out = new Set<string>();
  const clause = /\bproject\s*(?:!=|=|not\s+in|in)\s*(\([^)]*\)|"[^"]*"|'[^']*'|[^\s)]+)/gi;
  for (const m of jql.matchAll(clause)) {
    let value = m[1].trim();
    if (value.startsWith("(")) value = value.slice(1, -1);
    for (const part of value.split(",")) {
      const key = part.trim().replace(/^["']|["']$/g, "").trim();
      if (key) out.add(key.toUpperCase());
    }
  }
  return [...out];
}
