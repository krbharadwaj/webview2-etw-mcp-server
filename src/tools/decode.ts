import { loadJson, type ApiIdEntry } from "../knowledge/loader.js";

const apiIds = loadJson<Record<string, ApiIdEntry>>("api_ids.json");

export function decodeApiId(id: number | string): string {
  const key = String(id);
  const entry = apiIds[key];
  if (!entry) {
    return `Unknown API ID: ${id}. Valid range: 0-174.`;
  }

  const critical = entry.critical ? " ★ NAVIGATION-CRITICAL" : "";
  return [
    `**API ID ${id}: ${entry.name}**${critical}`,
    `Category: ${entry.category}`,
    "",
    `Use in ETW: Look for \`WebView2_APICalled\` events where Field1 = ${id}`,
  ].join("\n");
}

export function decodeApiIdBatch(ids: number[]): string {
  const lines: string[] = ["| ID | API Name | Category | Critical |", "|-----|----------|----------|----------|"];
  for (const id of ids) {
    const entry = apiIds[String(id)];
    if (entry) {
      lines.push(`| ${id} | ${entry.name} | ${entry.category} | ${entry.critical ? "★" : ""} |`);
    } else {
      lines.push(`| ${id} | Unknown | — | — |`);
    }
  }
  return lines.join("\n");
}

export function listApisByCategory(category: string): string {
  const matches: { id: string; entry: ApiIdEntry }[] = [];
  for (const [id, entry] of Object.entries(apiIds)) {
    if (entry.category.toLowerCase().includes(category.toLowerCase())) {
      matches.push({ id, entry });
    }
  }

  if (matches.length === 0) {
    return `No APIs found for category "${category}". Available categories: ${getCategories().join(", ")}`;
  }

  const lines = [`### APIs in category: ${category}`, "", "| ID | Name | Critical |", "|-----|------|----------|"];
  for (const { id, entry } of matches) {
    lines.push(`| ${id} | ${entry.name} | ${entry.critical ? "★" : ""} |`);
  }
  return lines.join("\n");
}

function getCategories(): string[] {
  const cats = new Set<string>();
  for (const entry of Object.values(apiIds)) {
    cats.add(entry.category);
  }
  return Array.from(cats).sort();
}
