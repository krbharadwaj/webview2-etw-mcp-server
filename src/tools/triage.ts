/**
 * triage: Fast root-cause-first analysis of filtered ETL data.
 * Produces a compact Triage Card with top suspected root causes,
 * evidence pointers, missing signals, and next actions.
 */

import { readFileSync, existsSync } from "fs";
import { loadJson, type RootCauseEntry, type TimingBaseline } from "../knowledge/loader.js";
import { learnFromLines, flushLearnings } from "./auto_learn.js";

interface TriageCandidate {
  rootCause: string;
  subCause: string;
  confidence: number;
  evidence: string[];
  missingSignals: string[];
  stage: string;
  rationale: string;
}

interface TriageCard {
  symptom: string;
  fingerprint: string;
  candidates: TriageCandidate[];
  evidencePointers: { event: string; timestamp: string; line: number }[];
  missingExpected: string[];
  nextActions: string[];
}

// ─── ETW signatures for each sub-cause ──────────────────────────────

interface SubCauseSignature {
  label: string;
  category: string;
  stage: string;
  mustPresent: string[];
  mustAbsent: string[];
  mayPresent: string[];
  timingKeys: string[];
  timingThresholds: Record<string, number>;
}

const SUBCAUSE_SIGNATURES: Record<string, SubCauseSignature> = {
  nav_completed_not_received: {
    label: "NavigationCompleted not received by host",
    category: "Navigation",
    stage: "Host event dispatch",
    mustPresent: ["WebView2_APICalled", "WebView2_NavigationStarting"],
    mustAbsent: ["WebView2_Event_NavigationCompletedHandler"],
    mayPresent: ["NavigationRequest::Create", "NavigationRequest::CommitNavigation"],
    timingKeys: [],
    timingThresholds: {},
  },
  nav_completed_suppressed: {
    label: "NavigationCompleted suppressed (about:blank)",
    category: "Initialization",
    stage: "about:blank suppression",
    mustPresent: [],
    mustAbsent: ["WebView2_Event_NavigationCompletedHandler"],
    mayPresent: ["WebView2_DocStateSuppressed", "WebView2_NavIdNotFound", "initializing_navigation_id"],
    timingKeys: [],
    timingThresholds: {},
  },
  init_about_blank_deadlock: {
    label: "Host deadlocked waiting for about:blank NavigationCompleted",
    category: "Initialization",
    stage: "Post-creation",
    mustPresent: ["WebView2_Creation_Client"],
    mustAbsent: ["WebView2_APICalled"],
    mayPresent: ["WebView2_DocStateSuppressed"],
    timingKeys: ["creation_client_cold_start"],
    timingThresholds: { creation_client_cold_start: 5000 },
  },
  handler_registration_race: {
    label: "Event handler registered after event fired",
    category: "Initialization",
    stage: "Handler registration",
    mustPresent: ["WebView2_Creation_Client"],
    mustAbsent: [],
    mayPresent: ["WebView2_APICalled"],
    timingKeys: [],
    timingThresholds: {},
  },
  cold_start_timeout: {
    label: "Cold start timeout or excessive delay",
    category: "Performance",
    stage: "Browser process launch",
    mustPresent: [],
    mustAbsent: [],
    mayPresent: ["WebView2_WebViewProcessLaunchType", "WebView2_Creation_Client"],
    timingKeys: ["creation_client_cold_start"],
    timingThresholds: { creation_client_cold_start: 5000 },
  },
  vdi_dll_loading: {
    label: "VDI/Citrix DLL loading delay",
    category: "Performance",
    stage: "DLL loading",
    mustPresent: [],
    mustAbsent: [],
    mayPresent: ["CommitToDidCommit", "OnModuleEvent", "PvsVmAgent", "BrokerAgent", "vmtoolsd"],
    timingKeys: ["commit_to_did_commit"],
    timingThresholds: { commit_to_did_commit: 5000 },
  },
  service_worker_slow: {
    label: "Service worker cold activation delay",
    category: "Performance",
    stage: "Service worker activation",
    mustPresent: [],
    mustAbsent: [],
    mayPresent: ["ForwardServiceWorkerToWorkerReady", "EmbeddedWorkerInstance", "ServiceWorker"],
    timingKeys: ["sw_forward_to_worker_ready"],
    timingThresholds: { sw_forward_to_worker_ready: 1000 },
  },
  wam_token_failure: {
    label: "WAM authentication token failure",
    category: "Authentication",
    stage: "Token acquisition",
    mustPresent: [],
    mustAbsent: [],
    mayPresent: ["WebTokenRequestResultOperation_ActivityStop", "WebTokenRequestResultOperation_ActivityError", "TokenBroker"],
    timingKeys: ["wam_token_request"],
    timingThresholds: { wam_token_request: 10000 },
  },
  browser_crash: {
    label: "Browser process crashed",
    category: "Crash",
    stage: "Browser process",
    mustPresent: [],
    mustAbsent: [],
    mayPresent: ["WebView2_BrowserProcessFailure", "ProcessExited", "ProcessFailure", "crash"],
    timingKeys: [],
    timingThresholds: {},
  },
  renderer_hung: {
    label: "Renderer unresponsive",
    category: "Stuck",
    stage: "Renderer process",
    mustPresent: [],
    mustAbsent: [],
    mayPresent: ["WebView2_RendererUnresponsive", "Timeout", "Unresponsive"],
    timingKeys: [],
    timingThresholds: {},
  },
  nav_request_failed: {
    label: "Navigation request failed (network/SSL/server error)",
    category: "Navigation",
    stage: "Network request",
    mustPresent: [],
    mustAbsent: [],
    mayPresent: ["OnRequestFailedInternal", "NavigationFailed", "RequestFailed", "net::ERR_"],
    timingKeys: [],
    timingThresholds: {},
  },
};

// ─── Main entry point ───────────────────────────────────────────────

export function triage(
  filteredFilePath: string,
  symptom: string
): string {
  if (!existsSync(filteredFilePath)) {
    return `❌ File not found: ${filteredFilePath}`;
  }

  const lines = readFileSync(filteredFilePath, "utf-8").split("\n").filter(l => l.trim());
  if (lines.length === 0) return "❌ File is empty";

  // Auto-learn silently
  learnFromLines(lines);

  // Build line index for fast search
  const lineIndex = buildLineIndex(lines);

  // Score each sub-cause against the trace
  const candidates = scoreAllCandidates(lineIndex, lines, symptom);

  // Extract evidence pointers
  const evidencePointers = extractEvidencePointers(lineIndex, lines);

  // Detect missing expected signals
  const missingExpected = detectMissingSignals(lineIndex, symptom);

  // Build triage card
  const card = formatTriageCard(
    symptom,
    computeFingerprint(lines),
    candidates,
    evidencePointers,
    missingExpected,
    lines.length
  );

  return card + flushLearnings();
}

// ─── Line indexing ──────────────────────────────────────────────────

interface LineIndex {
  eventCounts: Map<string, number>;
  eventFirstLine: Map<string, number>;
  eventFirstTimestamp: Map<string, string>;
  hasPattern: (pattern: string) => boolean;
  countPattern: (pattern: string) => number;
}

function buildLineIndex(lines: string[]): LineIndex {
  const eventCounts = new Map<string, number>();
  const eventFirstLine = new Map<string, number>();
  const eventFirstTimestamp = new Map<string, string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Extract key patterns
    for (const [key, sig] of Object.entries(SUBCAUSE_SIGNATURES)) {
      for (const pat of [...sig.mustPresent, ...sig.mustAbsent, ...sig.mayPresent]) {
        if (line.includes(pat)) {
          eventCounts.set(pat, (eventCounts.get(pat) || 0) + 1);
          if (!eventFirstLine.has(pat)) {
            eventFirstLine.set(pat, i);
            const ts = extractTimestamp(line);
            if (ts) eventFirstTimestamp.set(pat, ts);
          }
        }
      }
    }
  }

  return {
    eventCounts,
    eventFirstLine,
    eventFirstTimestamp,
    hasPattern: (p: string) => (eventCounts.get(p) || 0) > 0,
    countPattern: (p: string) => eventCounts.get(p) || 0,
  };
}

function extractTimestamp(line: string): string | null {
  const m = line.match(/,\s*(\d{8,})/);
  return m ? m[1] : null;
}

// ─── Scoring ────────────────────────────────────────────────────────

function scoreAllCandidates(
  index: LineIndex,
  lines: string[],
  symptom: string
): TriageCandidate[] {
  const candidates: TriageCandidate[] = [];

  for (const [key, sig] of Object.entries(SUBCAUSE_SIGNATURES)) {
    let score = 0;
    const evidence: string[] = [];
    const missing: string[] = [];

    // mustPresent: +20 each if found, -30 each if missing
    for (const pat of sig.mustPresent) {
      if (index.hasPattern(pat)) {
        score += 20;
        evidence.push(`✅ ${pat} found (×${index.countPattern(pat)})`);
      } else {
        score -= 30;
        missing.push(`Expected ${pat} not found`);
      }
    }

    // mustAbsent: +25 each if truly absent, -20 if present
    for (const pat of sig.mustAbsent) {
      if (!index.hasPattern(pat)) {
        score += 25;
        evidence.push(`🚫 ${pat} absent (as expected for this root cause)`);
      } else {
        score -= 20;
      }
    }

    // mayPresent: +15 each if found
    for (const pat of sig.mayPresent) {
      if (index.hasPattern(pat)) {
        score += 15;
        evidence.push(`🔍 ${pat} detected (×${index.countPattern(pat)})`);
      }
    }

    // Symptom keyword boost
    const symptomLower = symptom.toLowerCase();
    if (symptomLower.includes(sig.category.toLowerCase())) score += 10;
    if (sig.label.toLowerCase().includes(symptomLower)) score += 15;
    if (symptomLower.includes("stuck") && sig.category === "Stuck") score += 20;
    if (symptomLower.includes("crash") && sig.category === "Crash") score += 20;
    if (symptomLower.includes("slow") && sig.category === "Performance") score += 20;
    if (symptomLower.includes("auth") && sig.category === "Authentication") score += 20;
    if (symptomLower.includes("navigation") && sig.category === "Navigation") score += 15;
    if (symptomLower.includes("blank") && key === "nav_completed_not_received") score += 15;
    if (symptomLower.includes("completed") && key.includes("nav_completed")) score += 20;

    // Only include if score > 0
    if (score > 0) {
      const confidence = Math.min(0.95, score / 100);
      candidates.push({
        rootCause: sig.category,
        subCause: sig.label,
        confidence,
        evidence,
        missingSignals: missing,
        stage: sig.stage,
        rationale: buildRationale(key, sig, index),
      });
    }
  }

  // Sort by confidence descending, return top 3
  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates.slice(0, 3);
}

function buildRationale(key: string, sig: SubCauseSignature, index: LineIndex): string {
  const parts: string[] = [];
  const presentMust = sig.mustPresent.filter(p => index.hasPattern(p));
  const presentMay = sig.mayPresent.filter(p => index.hasPattern(p));
  const absentMust = sig.mustAbsent.filter(p => !index.hasPattern(p));

  if (presentMust.length > 0) parts.push(`Key events present: ${presentMust.join(", ")}`);
  if (absentMust.length > 0) parts.push(`Expected absences confirmed: ${absentMust.join(", ")}`);
  if (presentMay.length > 0) parts.push(`Supporting signals: ${presentMay.join(", ")}`);

  return parts.join(". ") || "Pattern matched based on trace content.";
}

// ─── Evidence pointers ──────────────────────────────────────────────

function extractEvidencePointers(
  index: LineIndex,
  lines: string[]
): { event: string; timestamp: string; line: number }[] {
  const pointers: { event: string; timestamp: string; line: number }[] = [];

  const keyEvents = [
    "WebView2_APICalled", "WebView2_Creation_Client", "WebView2_NavigationStarting",
    "WebView2_NavigationCompleted", "WebView2_BrowserProcessFailure",
    "NavigationRequest::Create", "NavigationRequest::CommitNavigation",
    "WebView2_RendererUnresponsive", "WebView2_ProcessExited",
    "WebTokenRequestResultOperation_ActivityStop", "WebView2_Event_NavigationCompletedHandler",
    "WebView2_NoHandlers", "WebView2_DifferentNavigationId", "WebView2_NavIdNotFound",
  ];

  for (const event of keyEvents) {
    const lineNum = index.eventFirstLine.get(event);
    const ts = index.eventFirstTimestamp.get(event);
    if (lineNum !== undefined) {
      pointers.push({ event, timestamp: ts || "?", line: lineNum + 1 });
    }
  }

  return pointers.sort((a, b) => a.line - b.line);
}

// ─── Missing signals ────────────────────────────────────────────────

function detectMissingSignals(index: LineIndex, symptom: string): string[] {
  const missing: string[] = [];
  const symptomLower = symptom.toLowerCase();

  // Navigation context: check for full lifecycle
  if (symptomLower.includes("nav") || symptomLower.includes("completed") ||
      symptomLower.includes("stuck") || symptomLower.includes("blank")) {
    const navLifecycle = [
      "WebView2_APICalled", "WebView2_NavigationStarting",
      "NavigationRequest::Create", "NavigationRequest::CommitNavigation",
      "WebView2_NavigationCompleted", "WebView2_Event_NavigationCompletedHandler",
    ];
    for (const event of navLifecycle) {
      if (!index.hasPattern(event)) {
        missing.push(`${event} — expected in navigation flow but not found`);
      }
    }
  }

  // Creation context
  if (symptomLower.includes("init") || symptomLower.includes("create") ||
      symptomLower.includes("slow") || symptomLower.includes("stuck")) {
    if (!index.hasPattern("WebView2_Creation_Client")) {
      missing.push("WebView2_Creation_Client — expected for initialization");
    }
  }

  // Error context
  if (!index.hasPattern("WebView2_BrowserProcessFailure") &&
      (symptomLower.includes("crash") || symptomLower.includes("fail"))) {
    missing.push("WebView2_BrowserProcessFailure — not found (rules out browser crash)");
  }

  return missing;
}

// ─── Fingerprint ────────────────────────────────────────────────────

function computeFingerprint(lines: string[]): string {
  let runtimeVersion = "unknown";
  let hostApp = "unknown";
  let lineCount = lines.length;

  for (const line of lines.slice(0, 200)) {
    const verMatch = line.match(/msedgewebview2.*?(\d+\.\d+\.\d+\.\d+)/);
    if (verMatch) runtimeVersion = verMatch[1];
    const appMatch = line.match(/(\w+)\.exe\s*\(/);
    if (appMatch && appMatch[1] !== "msedgewebview2") hostApp = appMatch[1];
  }

  return `${hostApp} | runtime ${runtimeVersion} | ${lineCount} lines`;
}

// ─── Format output ──────────────────────────────────────────────────

function formatTriageCard(
  symptom: string,
  fingerprint: string,
  candidates: TriageCandidate[],
  evidencePointers: { event: string; timestamp: string; line: number }[],
  missingExpected: string[],
  totalLines: number
): string {
  const out: string[] = [];

  out.push("## 🏥 Triage Card");
  out.push("");
  out.push(`**Symptom**: ${symptom}`);
  out.push(`**Trace**: ${fingerprint}`);
  out.push("");

  // Top suspects
  out.push("### 🎯 Top Suspected Root Causes");
  out.push("");
  if (candidates.length === 0) {
    out.push("No strong root-cause candidates matched. Consider using `diagnose` for symptom-based guidance.");
  } else {
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const conf = (c.confidence * 100).toFixed(0);
      out.push(`**${i + 1}. ${c.subCause}** (${conf}% confidence)`);
      out.push(`   Category: ${c.rootCause} | Stage: ${c.stage}`);
      out.push(`   Rationale: ${c.rationale}`);
      if (c.evidence.length > 0) {
        out.push(`   Evidence:`);
        for (const e of c.evidence.slice(0, 5)) out.push(`   - ${e}`);
      }
      if (c.missingSignals.length > 0) {
        out.push(`   Missing:`);
        for (const m of c.missingSignals) out.push(`   - ⚠️ ${m}`);
      }
      out.push("");
    }
  }

  // Evidence pointers
  if (evidencePointers.length > 0) {
    out.push("### 📌 Evidence Pointers");
    out.push("");
    out.push("| # | Event | Timestamp | Line |");
    out.push("|---|-------|-----------|------|");
    for (const p of evidencePointers.slice(0, 15)) {
      out.push(`| ${evidencePointers.indexOf(p) + 1} | \`${p.event}\` | ${p.timestamp} | L${p.line} |`);
    }
    out.push("");
  }

  // Missing expected signals
  if (missingExpected.length > 0) {
    out.push("### ❓ Missing Expected Signals");
    out.push("");
    for (const m of missingExpected) {
      out.push(`- ${m}`);
    }
    out.push("");
  }

  // Next actions
  out.push("### ▶️ Next Actions");
  out.push("");
  if (candidates.length > 0) {
    const top = candidates[0];
    out.push(`1. **Run playbook** — Use \`nav_playbook\` to run deterministic checks for "${top.subCause}"`);
  }
  out.push(`2. **Evidence pack** — Use \`evidence_pack\` to generate a structured RCA narrative`);
  out.push(`3. **Timeline slice** — Use \`timeline_slice\` to zoom into suspicious time windows`);
  out.push(`4. **Compare ETLs** — Use \`compare_etls\` if you have a good vs bad trace`);
  out.push(`5. **CPU profile** — Use \`analyze_cpu\` only if timeline suggests CPU contention`);

  return out.join("\n");
}
