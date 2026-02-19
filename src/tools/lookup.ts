import { loadJson, type EventEntry } from "../knowledge/loader.js";

const events = loadJson<Record<string, EventEntry>>("events.json");

export function lookupEvent(eventName: string): string {
  // Exact match
  const entry = events[eventName];
  if (entry) {
    return formatEvent(eventName, entry);
  }

  // Partial / fuzzy match
  const matches: [string, EventEntry][] = [];
  const lower = eventName.toLowerCase();
  for (const [name, evt] of Object.entries(events)) {
    if (name.toLowerCase().includes(lower)) {
      matches.push([name, evt]);
    }
  }

  if (matches.length === 0) {
    return [
      `❌ Event "${eventName}" not found in knowledge base.`,
      "",
      "**To discover this event:**",
      "1. Search codebase: `grep -r \"TRACE_EVENT.*${eventName}\" --include=\"*.cc\" --include=\"*.h\"`",
      "2. Use `contribute` tool to add it after you find the source definition",
      "",
      `Similar events (by prefix):`,
      ...getSuggestions(eventName),
    ].join("\n");
  }

  if (matches.length === 1) {
    return formatEvent(matches[0][0], matches[0][1]);
  }

  // Multiple matches
  const lines = [`Found ${matches.length} events matching "${eventName}":`, ""];
  for (const [name, evt] of matches.slice(0, 15)) {
    lines.push(`- **${name}** — ${evt.description} [${evt.severity}]`);
  }
  if (matches.length > 15) {
    lines.push(`... and ${matches.length - 15} more`);
  }
  return lines.join("\n");
}

export function listEventsByCategory(category: string): string {
  const matches: [string, EventEntry][] = [];
  const lower = category.toLowerCase();
  for (const [name, evt] of Object.entries(events)) {
    if (evt.category.toLowerCase().includes(lower)) {
      matches.push([name, evt]);
    }
  }

  if (matches.length === 0) {
    const cats = getCategories();
    return `No events in category "${category}". Available: ${cats.join(", ")}`;
  }

  const lines = [`### Events in category: ${category} (${matches.length} found)`, "", "| Event | Severity | Description |", "|-------|----------|-------------|"];
  for (const [name, evt] of matches) {
    lines.push(`| \`${name}\` | ${evt.severity} | ${evt.description} |`);
  }
  return lines.join("\n");
}

function formatEvent(name: string, entry: EventEntry): string {
  const lines = [
    `## ${name}`,
    "",
    `**Description**: ${entry.description}`,
    `**Category**: ${entry.category}`,
    `**Severity**: ${entry.severity}`,
  ];

  if (entry.params.length > 0) {
    lines.push("", "### Parameters", "| Field | Name | Type | Description |", "|-------|------|------|-------------|");
    for (const p of entry.params) {
      lines.push(`| ${p.index} | ${p.name} | ${p.type} | ${p.description} |`);
    }
  }

  if (entry.relatedEvents.length > 0) {
    lines.push("", `**Related Events**: ${entry.relatedEvents.map(e => `\`${e}\``).join(", ")}`);
  }

  if (entry.sourceFile) {
    lines.push(`**Source**: ${entry.sourceFile}`);
  }

  return lines.join("\n");
}

function getSuggestions(eventName: string): string[] {
  const prefix = eventName.split("_").slice(0, 2).join("_");
  const suggestions: string[] = [];
  for (const name of Object.keys(events)) {
    if (name.startsWith(prefix)) {
      suggestions.push(`  - \`${name}\``);
    }
    if (suggestions.length >= 10) break;
  }
  return suggestions.length > 0 ? suggestions : ["  (no similar events found)"];
}

function getCategories(): string[] {
  const cats = new Set<string>();
  for (const entry of Object.values(events)) {
    cats.add(entry.category);
  }
  return Array.from(cats).sort();
}
