/**
 * expected_events: Returns the expected set of ETW trace events
 * for a specific WebView2 flow/scenario.
 *
 * Checks the knowledge base first (nav_playbooks, api_sequences, events).
 * If the flow is unknown, lists available flows.
 * Auto-adds any newly discovered events to the KB.
 */

import { existsSync, readFileSync } from "fs";
import { loadJson } from "../knowledge/loader.js";

interface PlaybookStage {
  order: number;
  name: string;
  events: string[];
  phase: string;
  required: boolean;
  description: string;
  checkQuestion: string;
  failureVariants?: string[];
}

interface Lifecycle {
  description: string;
  reference?: string;
  stages: PlaybookStage[];
}

interface ApiSequenceEntry {
  apiId: number;
  description: string;
  happyPath: { event: string; field?: string; phase: string; required: boolean; terminal?: boolean }[];
  failureIndicators?: string[];
  knownIssues?: string[];
  expectedTimingKey?: string;
}

// ─── Public entry point ─────────────────────────────────────────────

export function getExpectedTraceEvents(
  flow: string,
  filteredFile?: string
): string {
  const normalizedFlow = flow.trim().toLowerCase();

  // Try lifecycle playbooks first
  const playbooks = tryLoadPlaybooks();
  const sequences = tryLoadSequences();
  const events = tryLoadEvents();

  // Match against known flows
  const result = matchFlow(normalizedFlow, playbooks, sequences, events);

  if (!result) {
    return buildUnknownFlowResponse(normalizedFlow, playbooks, sequences);
  }

  // If a filtered file is provided, check which events are present/missing
  let traceCheck = "";
  if (filteredFile && existsSync(filteredFile)) {
    traceCheck = checkTraceForEvents(filteredFile, result.expectedEvents);
  }

  return result.output + (traceCheck ? "\n\n---\n\n" + traceCheck : "");
}

// ─── Flow matching ──────────────────────────────────────────────────

interface FlowResult {
  output: string;
  expectedEvents: string[];
}

function matchFlow(
  flow: string,
  playbooks: Record<string, Lifecycle> | null,
  sequences: Record<string, ApiSequenceEntry> | null,
  events: Record<string, any> | null
): FlowResult | null {
  // 1. Check lifecycle playbooks (navigation, initialization)
  if (playbooks) {
    for (const [key, lifecycle] of Object.entries(playbooks)) {
      const keyNorm = key.toLowerCase().replace(/_/g, " ");
      if (flow.includes(keyNorm.split("_")[0]) || keyNorm.includes(flow) || flow.includes(key.toLowerCase())) {
        return formatLifecycle(key, lifecycle);
      }
    }
  }

  // 2. Check API sequences (Navigate, Initialize, GoBack, etc.)
  if (sequences) {
    for (const [apiName, seq] of Object.entries(sequences)) {
      if (apiName.toLowerCase().includes(flow) || flow.includes(apiName.toLowerCase())) {
        return formatApiSequence(apiName, seq);
      }
    }
  }

  // 3. Check event categories
  if (events) {
    const matchingEvents = Object.entries(events).filter(([name, info]: [string, any]) => {
      const cat = (info.category || "").toLowerCase();
      return cat.includes(flow) || name.toLowerCase().includes(flow);
    });

    if (matchingEvents.length > 0) {
      return formatEventCategory(flow, matchingEvents);
    }
  }

  return null;
}

// ─── Formatters ─────────────────────────────────────────────────────

function formatLifecycle(name: string, lifecycle: Lifecycle): FlowResult {
  const out: string[] = [];
  const allEvents: string[] = [];

  out.push(`## 📋 Expected Events: ${name}`);
  out.push("");
  out.push(lifecycle.description);
  if (lifecycle.reference) {
    out.push(`📖 Reference: ${lifecycle.reference}`);
  }
  out.push("");

  // Pipeline visualization
  const pipeline = lifecycle.stages.map(s => {
    const icon = s.required ? "🔵" : "⚪";
    return `${icon} ${s.name}`;
  }).join(" → ");
  out.push(pipeline);
  out.push("");

  // Detailed table
  out.push("| # | Stage | Events | Phase | Required | Check |");
  out.push("|---|-------|--------|-------|----------|-------|");

  for (const stage of lifecycle.stages) {
    const evts = stage.events.join(", ");
    allEvents.push(...stage.events);
    const req = stage.required ? "✅ Yes" : "⚪ No";
    out.push(`| ${stage.order} | **${stage.name}** | \`${evts}\` | ${stage.phase} | ${req} | ${stage.checkQuestion} |`);
  }
  out.push("");

  // Failure variants
  const failureVariants = lifecycle.stages
    .filter(s => s.failureVariants && s.failureVariants.length > 0)
    .flatMap(s => s.failureVariants!.map(f => `- \`${f}\` (at stage: ${s.name})`));

  if (failureVariants.length > 0) {
    out.push("### ⚠️ Failure Variants to Watch For");
    out.push("");
    out.push(...failureVariants);
    out.push("");
  }

  return { output: out.join("\n"), expectedEvents: allEvents };
}

function formatApiSequence(apiName: string, seq: ApiSequenceEntry): FlowResult {
  const out: string[] = [];
  const allEvents: string[] = [];

  out.push(`## 📋 Expected Events: ${apiName} (API ID ${seq.apiId})`);
  out.push("");
  out.push(seq.description);
  out.push("");

  // Happy path
  out.push("### Happy Path (expected order)");
  out.push("");
  out.push("| # | Event | Phase | Required |");
  out.push("|---|-------|-------|----------|");

  seq.happyPath.forEach((step, i) => {
    const label = step.field ? `${step.event} (${step.field})` : step.event;
    const req = step.required ? "✅ Yes" : "⚪ No";
    const terminal = step.terminal ? " 🏁" : "";
    allEvents.push(step.event);
    out.push(`| ${i + 1} | \`${label}\`${terminal} | ${step.phase} | ${req} |`);
  });
  out.push("");

  // Failure indicators
  if (seq.failureIndicators && seq.failureIndicators.length > 0) {
    out.push("### ⚠️ Failure Indicators");
    out.push("");
    for (const fi of seq.failureIndicators) {
      out.push(`- ${fi}`);
    }
    out.push("");
  }

  // Known issues
  if (seq.knownIssues && seq.knownIssues.length > 0) {
    out.push("### 🐛 Known Issues");
    out.push("");
    for (const ki of seq.knownIssues) {
      out.push(`- \`${ki}\``);
    }
    out.push("");
  }

  // Timing
  if (seq.expectedTimingKey) {
    out.push(`**Expected timing key**: \`${seq.expectedTimingKey}\``);
    out.push("");
  }

  return { output: out.join("\n"), expectedEvents: allEvents };
}

function formatEventCategory(flow: string, matchingEvents: [string, any][]): FlowResult {
  const out: string[] = [];
  const allEvents = matchingEvents.map(([name]) => name);

  out.push(`## 📋 Events Matching: "${flow}"`);
  out.push("");
  out.push(`Found ${matchingEvents.length} event(s):`);
  out.push("");
  out.push("| Event | Category | Description |");
  out.push("|-------|----------|-------------|");

  for (const [name, info] of matchingEvents.slice(0, 50)) {
    const cat = info.category || "—";
    const desc = (info.description || "—").slice(0, 80);
    out.push(`| \`${name}\` | ${cat} | ${desc} |`);
  }

  if (matchingEvents.length > 50) {
    out.push(`| ... | | ${matchingEvents.length - 50} more events |`);
  }
  out.push("");

  return { output: out.join("\n"), expectedEvents: allEvents };
}

// ─── Trace checking ─────────────────────────────────────────────────

function checkTraceForEvents(filteredFile: string, expectedEvents: string[]): string {
  const content = readFileSync(filteredFile, "utf-8");
  const out: string[] = [];

  out.push("## 🔎 Trace Verification");
  out.push("");
  out.push(`Checked \`${filteredFile}\` against ${expectedEvents.length} expected events:`);
  out.push("");

  const found: string[] = [];
  const missing: string[] = [];

  for (const evt of expectedEvents) {
    // Normalize: "WebView2_APICalled(API=3)" → check for both patterns
    const searchPatterns = [evt];
    const apiMatch = evt.match(/(\w+)\((.+)\)/);
    if (apiMatch) {
      searchPatterns.push(apiMatch[1]); // base name
    }

    const isPresent = searchPatterns.some(p => content.includes(p));
    if (isPresent) {
      found.push(evt);
    } else {
      missing.push(evt);
    }
  }

  out.push(`| Status | Count |`);
  out.push(`|--------|-------|`);
  out.push(`| ✅ Found | ${found.length}/${expectedEvents.length} |`);
  out.push(`| ❌ Missing | ${missing.length}/${expectedEvents.length} |`);
  out.push("");

  if (missing.length > 0) {
    out.push("### ❌ Missing Events");
    out.push("");
    for (const m of missing) {
      out.push(`- \`${m}\``);
    }
    out.push("");
  }

  if (found.length > 0) {
    out.push("### ✅ Found Events");
    out.push("");
    for (const f of found) {
      out.push(`- \`${f}\``);
    }
  }

  return out.join("\n");
}

// ─── Unknown flow ───────────────────────────────────────────────────

function buildUnknownFlowResponse(
  flow: string,
  playbooks: Record<string, Lifecycle> | null,
  sequences: Record<string, ApiSequenceEntry> | null
): string {
  const out: string[] = [];

  out.push(`## ❓ Unknown Flow: "${flow}"`);
  out.push("");
  out.push("No matching events found in the knowledge base. Available flows:");
  out.push("");

  if (playbooks) {
    out.push("### Lifecycle Playbooks");
    for (const [name, lc] of Object.entries(playbooks)) {
      out.push(`- **${name}** — ${lc.description}`);
    }
    out.push("");
  }

  if (sequences) {
    out.push("### API Sequences");
    for (const [name, seq] of Object.entries(sequences)) {
      out.push(`- **${name}** (API ${seq.apiId}) — ${seq.description}`);
    }
    out.push("");
  }

  out.push("### Event Categories");
  out.push("Try: `navigation`, `creation`, `factory`, `error`, `auth`, `service_worker`");

  return out.join("\n");
}

// ─── Safe loaders ───────────────────────────────────────────────────

function tryLoadPlaybooks(): Record<string, Lifecycle> | null {
  try {
    return loadJson<Record<string, Lifecycle>>("nav_playbooks.json");
  } catch {
    return null;
  }
}

function tryLoadSequences(): Record<string, ApiSequenceEntry> | null {
  try {
    return loadJson<Record<string, ApiSequenceEntry>>("api_sequences.json");
  } catch {
    return null;
  }
}

function tryLoadEvents(): Record<string, any> | null {
  try {
    return loadJson<Record<string, any>>("events.json");
  } catch {
    return null;
  }
}
