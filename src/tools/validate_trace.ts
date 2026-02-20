/**
 * validate_trace: Compares actual ETL events against expected happy-path sequences.
 * Identifies missing events, wrong ordering, and deviations from known-good patterns.
 *
 * Level 2 learning: Uses api_sequences.json to validate traces.
 * Level 3 learning: Mines new sequences from successful traces.
 */

import { readFileSync, existsSync } from "fs";
import { loadJson, saveJson } from "../knowledge/loader.js";
import { learnFromLines, flushLearnings } from "./auto_learn.js";

interface SequenceStep {
  event: string;
  field?: string;
  phase: string;
  required: boolean;
  terminal?: boolean;
  notes?: string;
}

interface ApiSequence {
  apiId: number;
  description: string;
  happyPath: SequenceStep[];
  expectedTimingKey: string | null;
  failureIndicators: string[];
  knownIssues: string[];
}

interface ApiCallInstance {
  apiId: number;
  apiName: string;
  timestamp: number;
  pid: number;
  lineIndex: number;
}

interface ValidationResult {
  apiName: string;
  apiId: number;
  instances: number;
  happyPathSteps: number;
  foundSteps: string[];
  missingSteps: string[];
  deviations: string[];
  health: "✅ Healthy" | "⚠️ Partial" | "❌ Broken" | "🔍 Unknown";
}

// ─── Main: validate_trace ───────────────────────────────────────────

export function validateTrace(
  filteredFilePath: string,
  mode: "validate" | "learn_good" | "learn_bad" = "validate"
): string {
  if (!existsSync(filteredFilePath)) {
    return `❌ File not found: ${filteredFilePath}`;
  }

  const lines = readFileSync(filteredFilePath, "utf-8").split("\n").filter(l => l.trim());
  if (lines.length === 0) return "❌ File is empty";

  // Auto-learn from all lines (Level 1 integration)
  learnFromLines(lines);

  const sequences = loadJson<Record<string, ApiSequence>>("api_sequences.json");
  const apiIds = loadJson<Record<string, any>>("api_ids.json");

  // Step 1: Extract all API calls from the trace
  const apiCalls = extractApiCalls(lines, apiIds);
  if (apiCalls.length === 0) {
    return [
      "## Trace Validation",
      "",
      "⚠️ No WebView2_APICalled events found in this trace.",
      `Scanned ${lines.length} lines.`,
      "",
      "This could mean:",
      "- The trace was not filtered for WebView2 events",
      "- The host app didn't call any WebView2 APIs in this timeframe",
      "- The trace captured a different process",
    ].join("\n") + flushLearnings();
  }

  // Step 2: Group API calls by name
  const apiGroups = new Map<string, ApiCallInstance[]>();
  for (const call of apiCalls) {
    const list = apiGroups.get(call.apiName) || [];
    list.push(call);
    apiGroups.set(call.apiName, list);
  }

  // Step 3: Validate each API group against happy path
  const results: ValidationResult[] = [];
  for (const [apiName, calls] of apiGroups) {
    const seq = sequences[apiName];
    if (!seq) {
      results.push({
        apiName,
        apiId: calls[0].apiId,
        instances: calls.length,
        happyPathSteps: 0,
        foundSteps: [],
        missingSteps: [],
        deviations: [],
        health: "🔍 Unknown",
      });
      continue;
    }

    const result = validateApiAgainstHappyPath(apiName, calls, seq, lines);
    results.push(result);
  }

  // Step 4: If learning mode, mine patterns
  if (mode === "learn_good") {
    const mined = mineSequences(apiCalls, lines, apiIds, "success");
    return formatValidationReport(results, apiCalls, lines.length, mode) +
      "\n\n" + mined + flushLearnings();
  }
  if (mode === "learn_bad") {
    const mined = mineSequences(apiCalls, lines, apiIds, "failure");
    return formatValidationReport(results, apiCalls, lines.length, mode) +
      "\n\n" + mined + flushLearnings();
  }

  return formatValidationReport(results, apiCalls, lines.length, mode) + flushLearnings();
}

// ─── Extract API calls ──────────────────────────────────────────────

function extractApiCalls(lines: string[], apiIds: Record<string, any>): ApiCallInstance[] {
  const calls: ApiCallInstance[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes("WebView2_APICalled")) continue;

    const apiMatch = line.match(/API[=:]\s*(\d+)/i);
    if (!apiMatch) continue;

    const apiId = parseInt(apiMatch[1], 10);
    const apiInfo = apiIds[apiId.toString()];
    const apiName = apiInfo?.name || `API_${apiId}`;
    const tsMatch = line.match(/,\s*(\d+)/);
    const timestamp = tsMatch ? parseInt(tsMatch[1], 10) : i;
    const pidMatch = line.match(/\(\s*(\d+)\s*\)/);
    const pid = pidMatch ? parseInt(pidMatch[1], 10) : 0;

    calls.push({ apiId, apiName, timestamp, pid, lineIndex: i });
  }

  return calls;
}

// ─── Validate single API against happy path ─────────────────────────

function validateApiAgainstHappyPath(
  apiName: string,
  calls: ApiCallInstance[],
  seq: ApiSequence,
  lines: string[]
): ValidationResult {
  const foundSteps: string[] = [];
  const missingSteps: string[] = [];
  const deviations: string[] = [];

  // For each step in the happy path, check if it appears in the trace
  // We look in a window after the API call
  const firstCall = calls[0];
  const lastCallIdx = calls[calls.length - 1].lineIndex;

  // Search window: from first API call to end of trace (or next 500 lines)
  const searchEnd = Math.min(lines.length, lastCallIdx + 500);

  for (const step of seq.happyPath) {
    if (step.event === "WebView2_APICalled") {
      foundSteps.push(`✅ ${step.event} (${step.field || "trigger"})`);
      continue;
    }

    let found = false;
    for (let i = firstCall.lineIndex; i < searchEnd; i++) {
      if (lines[i].includes(step.event)) {
        found = true;
        break;
      }
    }

    if (found) {
      foundSteps.push(`✅ ${step.event}`);
    } else if (step.required) {
      missingSteps.push(`❌ ${step.event} (REQUIRED — never appeared)`);
    } else {
      missingSteps.push(`⬜ ${step.event} (optional — not seen)`);
    }
  }

  // Check for failure indicators
  for (const indicator of seq.failureIndicators) {
    for (let i = firstCall.lineIndex; i < searchEnd; i++) {
      if (lines[i].includes(indicator) || lines[i].toLowerCase().includes(indicator.toLowerCase())) {
        deviations.push(`🚨 Failure indicator found: "${indicator}"`);
        break;
      }
    }
  }

  // Check event ordering (required steps should appear in order)
  const requiredSteps = seq.happyPath.filter(s => s.required && s.event !== "WebView2_APICalled");
  const foundOrder: number[] = [];
  for (const step of requiredSteps) {
    for (let i = firstCall.lineIndex; i < searchEnd; i++) {
      if (lines[i].includes(step.event)) {
        foundOrder.push(i);
        break;
      }
    }
  }
  const isOrdered = foundOrder.every((v, i) => i === 0 || v > foundOrder[i - 1]);
  if (!isOrdered && foundOrder.length > 1) {
    deviations.push("⚠️ Events appeared out of expected order");
  }

  // Determine health
  const requiredMissing = missingSteps.filter(s => s.includes("REQUIRED")).length;
  const totalRequired = seq.happyPath.filter(s => s.required).length;
  let health: ValidationResult["health"];
  if (requiredMissing === 0 && deviations.length === 0) {
    health = "✅ Healthy";
  } else if (requiredMissing === 0) {
    health = "⚠️ Partial";
  } else if (requiredMissing < totalRequired) {
    health = "⚠️ Partial";
  } else {
    health = "❌ Broken";
  }

  return {
    apiName,
    apiId: calls[0].apiId,
    instances: calls.length,
    happyPathSteps: seq.happyPath.length,
    foundSteps,
    missingSteps,
    deviations,
    health,
  };
}

// ─── Format report ──────────────────────────────────────────────────

function formatValidationReport(
  results: ValidationResult[],
  apiCalls: ApiCallInstance[],
  totalLines: number,
  mode: string
): string {
  const out: string[] = [];

  out.push("## 🔍 Trace Validation Report");
  out.push("");
  out.push(`📊 **${apiCalls.length} API calls** across **${results.length} unique APIs** | ${totalLines} total lines`);
  if (mode !== "validate") out.push(`📝 Mode: **${mode}** — learning from this trace`);
  out.push("");

  // Summary table
  out.push("### Health Summary");
  out.push("| API | Calls | Health | Issues |");
  out.push("|-----|-------|--------|--------|");
  for (const r of results.sort((a, b) => {
    const order = { "❌ Broken": 0, "⚠️ Partial": 1, "🔍 Unknown": 2, "✅ Healthy": 3 };
    return (order[a.health] ?? 2) - (order[b.health] ?? 2);
  })) {
    const issues = r.missingSteps.filter(s => s.includes("REQUIRED")).length + r.deviations.length;
    out.push(`| ${r.apiName} (${r.apiId}) | ${r.instances} | ${r.health} | ${issues > 0 ? issues + " issues" : "—"} |`);
  }

  // Detailed per-API
  const problemApis = results.filter(r => r.health !== "✅ Healthy" && r.health !== "🔍 Unknown");
  if (problemApis.length > 0) {
    out.push("");
    out.push("### ⚠️ APIs with Issues");
    for (const r of problemApis) {
      out.push("");
      out.push(`#### ${r.apiName} (API=${r.apiId}) — ${r.health}`);
      out.push(`Called ${r.instances} time(s) | ${r.happyPathSteps} steps in happy path`);
      out.push("");
      if (r.foundSteps.length > 0) {
        out.push("**Found:**");
        for (const s of r.foundSteps) out.push(`- ${s}`);
      }
      if (r.missingSteps.length > 0) {
        out.push("**Missing:**");
        for (const s of r.missingSteps) out.push(`- ${s}`);
      }
      if (r.deviations.length > 0) {
        out.push("**Deviations:**");
        for (const s of r.deviations) out.push(`- ${s}`);
      }
    }
  }

  // APIs without known sequences
  const unknownApis = results.filter(r => r.health === "🔍 Unknown");
  if (unknownApis.length > 0) {
    out.push("");
    out.push("### 🔍 APIs Without Known Sequences");
    out.push("These APIs were called but have no happy-path definition yet.");
    out.push("Use `learn_good` mode on a successful trace to auto-mine their sequences.");
    out.push("");
    for (const r of unknownApis) {
      out.push(`- **${r.apiName}** (API=${r.apiId}) — called ${r.instances} time(s)`);
    }
  }

  return out.join("\n");
}

// ─── Level 3: Mine sequences from traces ────────────────────────────

function mineSequences(
  apiCalls: ApiCallInstance[],
  lines: string[],
  apiIds: Record<string, any>,
  traceType: "success" | "failure"
): string {
  const sequences = loadJson<Record<string, ApiSequence>>("api_sequences.json");
  const mined: string[] = [];
  let newSequences = 0;

  // For each unique API call, extract the event pattern that follows it
  const seenApis = new Set<string>();

  for (const call of apiCalls) {
    if (seenApis.has(call.apiName)) continue;
    seenApis.add(call.apiName);

    // Skip if we already have a manual sequence
    if (sequences[call.apiName] && !sequences[call.apiName].happyPath.some((s: any) => s.autoMined)) {
      // Already has a manually defined sequence — don't overwrite, but augment
      continue;
    }

    // Extract events in a window after this API call
    const windowEnd = Math.min(lines.length, call.lineIndex + 200);
    const followingEvents: { event: string; offset: number }[] = [];
    const seenEvents = new Set<string>();

    for (let i = call.lineIndex + 1; i < windowEnd; i++) {
      const eventName = extractEventFromLine(lines[i]);
      if (eventName && !seenEvents.has(eventName) && isWebView2Related(eventName)) {
        seenEvents.add(eventName);
        followingEvents.push({ event: eventName, offset: i - call.lineIndex });

        // Stop at terminal events
        if (eventName.includes("Completed") || eventName.includes("Failed") ||
            eventName.includes("_End") || eventName.includes("_Stop")) {
          break;
        }
      }

      // Stop if we hit another API call
      if (i !== call.lineIndex && lines[i].includes("WebView2_APICalled")) break;
    }

    if (followingEvents.length < 2) continue; // Need at least 2 events to form a pattern

    // Build or update sequence
    if (!sequences[call.apiName]) {
      const newSeq: any = {
        apiId: call.apiId,
        description: apiIds[call.apiId.toString()]?.name || call.apiName,
        happyPath: [
          { event: "WebView2_APICalled", field: `API=${call.apiId}`, phase: "trigger", required: true, autoMined: true },
          ...followingEvents.map(e => ({
            event: e.event,
            phase: inferPhase(e.event),
            required: traceType === "success",
            autoMined: true,
          })),
        ],
        expectedTimingKey: null,
        failureIndicators: traceType === "failure" ?
          followingEvents.filter(e => e.event.includes("Failed") || e.event.includes("Error"))
            .map(e => e.event) : [],
        knownIssues: [],
        _minedFrom: traceType,
        _confidence: 1,
        _sampleCount: 1,
      };
      sequences[call.apiName] = newSeq;
      newSequences++;
      mined.push(`🆕 Mined sequence for **${call.apiName}**: ${followingEvents.map(e => e.event).join(" → ")}`);
    } else {
      // Augment existing sequence confidence
      const existing = sequences[call.apiName] as any;
      existing._sampleCount = (existing._sampleCount || 1) + 1;
      existing._confidence = Math.min(1.0, (existing._confidence || 0.5) + 0.1);
    }
  }

  // Save updated sequences
  if (newSequences > 0) {
    const meta = sequences["_metadata"] as any;
    if (meta) {
      meta.autoMinedSequences = (meta.autoMinedSequences || 0) + newSequences;
      meta.lastUpdated = new Date().toISOString().split("T")[0];
    }
    saveJson("api_sequences.json", sequences);
  }

  if (mined.length === 0) {
    return `📚 No new sequences to mine (${seenApis.size} APIs already have known patterns)`;
  }

  return [
    `## 🧠 Auto-Mined Sequences (from ${traceType} trace)`,
    "",
    `Discovered **${newSequences}** new API→event sequences:`,
    "",
    ...mined,
    "",
    `These patterns will be used in future validations. Confidence increases with more traces.`,
  ].join("\n");
}

// ─── Helpers ────────────────────────────────────────────────────────

function extractEventFromLine(line: string): string | null {
  // Match WebView2 events, NavigationRequest events, etc.
  const patterns = [
    /\b(WebView2_\w+)/,
    /\b(NavigationRequest::\w+)/,
    /\b(ServiceWorker\w*::\w+)/,
    /\b(DocumentLoader::\w+)/,
    /\b(URLLoader\w*::\w+)/,
  ];
  for (const p of patterns) {
    const m = line.match(p);
    if (m) return m[1];
  }
  return null;
}

function isWebView2Related(eventName: string): boolean {
  return eventName.startsWith("WebView2_") ||
    eventName.startsWith("NavigationRequest") ||
    eventName.startsWith("ServiceWorker") ||
    eventName.startsWith("DocumentLoader") ||
    eventName.startsWith("URLLoader");
}

function inferPhase(eventName: string): string {
  if (eventName.includes("_Event_")) return "host_event";
  if (eventName.includes("_Creation_Client")) return "host";
  if (eventName.includes("_Creation_Server")) return "server";
  if (eventName.includes("_Factory")) return "factory";
  if (eventName.includes("NavigationRequest")) return "browser";
  if (eventName.includes("ServiceWorker")) return "service_worker";
  if (eventName.includes("DocumentLoader")) return "renderer";
  if (eventName.includes("URLLoader")) return "network";
  return "browser";
}
