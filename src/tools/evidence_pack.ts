/**
 * evidence_pack: Generates a structured, RCA-ready evidence pack.
 * Contains hypothesis, evidence table, missing signals, counter-evidence,
 * timeline, confidence scoring, and alternative explanations.
 */

import { readFileSync, existsSync } from "fs";
import { loadJson, type RootCauseEntry, type TimingBaseline } from "../knowledge/loader.js";

interface EvidenceItem {
  event: string;
  timestamp: string;
  line: number;
  significance: string;
  supports: string;
}

interface TimelineEntry {
  timestamp: string;
  event: string;
  pid: string;
  phase: string;
  notes: string;
}

// ─── Main entry point ───────────────────────────────────────────────

export function evidencePack(
  filteredFilePath: string,
  hypothesis: string,
  symptom: string
): string {
  if (!existsSync(filteredFilePath)) {
    return `❌ File not found: ${filteredFilePath}`;
  }

  const lines = readFileSync(filteredFilePath, "utf-8").split("\n").filter(l => l.trim());
  if (lines.length === 0) return "❌ File is empty";

  const rootCauses = loadJson<Record<string, RootCauseEntry>>("root_causes.json");
  const timingBaselines = loadJson<Record<string, TimingBaseline>>("timing_baselines.json");

  // Build evidence table
  const evidence = collectEvidence(lines, hypothesis);

  // Build key-event timeline
  const timeline = buildTimeline(lines);

  // Find counter-evidence
  const counterEvidence = findCounterEvidence(lines, hypothesis);

  // Generate alternative explanations
  const alternatives = generateAlternatives(hypothesis, lines, rootCauses);

  // Compute confidence
  const confidence = computeConfidence(evidence, counterEvidence, hypothesis);

  // Check timing anomalies
  const timingAnomalies = checkTimingAnomalies(lines, timingBaselines);

  // Format output
  return formatEvidencePack(
    symptom,
    hypothesis,
    evidence,
    timeline,
    counterEvidence,
    alternatives,
    confidence,
    timingAnomalies,
    lines.length
  );
}

// ─── Evidence collection ────────────────────────────────────────────

function collectEvidence(lines: string[], hypothesis: string): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const hypLower = hypothesis.toLowerCase();

  // Key patterns to look for based on hypothesis
  const patterns: { pattern: string; significance: string; supports: string }[] = [
    { pattern: "WebView2_APICalled", significance: "API invocation", supports: "navigation/initialization flow" },
    { pattern: "WebView2_Creation_Client", significance: "WebView2 creation lifecycle", supports: "initialization" },
    { pattern: "WebView2_NavigationStarting", significance: "Navigation began", supports: "navigation lifecycle" },
    { pattern: "WebView2_NavigationCompleted", significance: "Navigation finished", supports: "navigation lifecycle" },
    { pattern: "WebView2_Event_NavigationCompletedHandler", significance: "NavigationCompleted dispatched to host", supports: "host received the event" },
    { pattern: "WebView2_NoHandlers", significance: "No handler registered for event", supports: "handler registration issue" },
    { pattern: "WebView2_DifferentNavigationId", significance: "NavigationId mismatch", supports: "stale navigation" },
    { pattern: "WebView2_NavIdNotFound", significance: "NavigationId not found", supports: "navigation suppression" },
    { pattern: "WebView2_DocStateSuppressed", significance: "Document state change suppressed", supports: "about:blank suppression" },
    { pattern: "WebView2_BrowserProcessFailure", significance: "Browser process crashed", supports: "crash root cause" },
    { pattern: "WebView2_RendererUnresponsive", significance: "Renderer hung", supports: "hung/stuck root cause" },
    { pattern: "WebView2_ProcessExited", significance: "Process exited", supports: "process lifecycle" },
    { pattern: "NavigationRequest::Create", significance: "Browser navigation request created", supports: "navigation pipeline" },
    { pattern: "NavigationRequest::CommitNavigation", significance: "Navigation committed", supports: "document commit" },
    { pattern: "NavigationRequest::DidCommitNavigation", significance: "Commit acknowledged", supports: "document commit" },
    { pattern: "NavigationRequest::OnRequestFailedInternal", significance: "Navigation request failed", supports: "network/server failure" },
    { pattern: "WebTokenRequestResultOperation_ActivityStop", significance: "WAM token result", supports: "authentication flow" },
    { pattern: "WebTokenRequestResultOperation_ActivityError", significance: "WAM token error", supports: "authentication failure" },
    { pattern: "ForwardServiceWorkerToWorkerReady", significance: "SW activation timing", supports: "service worker delay" },
    { pattern: "WebView2_WebViewProcessLaunchType", significance: "Cold vs warm start", supports: "initialization performance" },
    { pattern: "WebView2_DroppedEvent", significance: "Event was dropped", supports: "event delivery failure" },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const p of patterns) {
      if (line.includes(p.pattern)) {
        items.push({
          event: p.pattern,
          timestamp: extractTimestamp(line) || `line ${i + 1}`,
          line: i + 1,
          significance: p.significance,
          supports: p.supports,
        });
        break; // One match per line
      }
    }
  }

  // Deduplicate by event — keep first and last occurrence
  const deduped: EvidenceItem[] = [];
  const seen = new Map<string, EvidenceItem[]>();
  for (const item of items) {
    const list = seen.get(item.event) || [];
    list.push(item);
    seen.set(item.event, list);
  }
  for (const [event, occurrences] of seen) {
    deduped.push(occurrences[0]);
    if (occurrences.length > 1) {
      const last = occurrences[occurrences.length - 1];
      last.significance += ` (last of ${occurrences.length})`;
      deduped.push(last);
    }
  }

  return deduped.sort((a, b) => a.line - b.line);
}

// ─── Timeline ───────────────────────────────────────────────────────

function buildTimeline(lines: string[]): TimelineEntry[] {
  const timeline: TimelineEntry[] = [];
  const keyEvents = [
    "WebView2_FactoryCreate", "WebView2_Creation_Client", "WebView2_Creation_Server",
    "WebView2_APICalled", "WebView2_NavigationStarting", "WebView2_NavigationCompleted",
    "WebView2_Event_NavigationCompletedHandler", "WebView2_Event_NavigationStartingHandler",
    "NavigationRequest::Create", "NavigationRequest::CommitNavigation",
    "NavigationRequest::DidCommitNavigation", "NavigationRequest::OnRequestFailedInternal",
    "WebView2_ContentLoading", "WebView2_DOMContentLoaded",
    "WebView2_BrowserProcessFailure", "WebView2_ProcessExited",
    "WebView2_RendererUnresponsive", "WebView2_DroppedEvent",
    "WebView2_NoHandlers", "WebView2_DifferentNavigationId",
    "WebTokenRequestResultOperation_ActivityStop",
    "ForwardServiceWorkerToWorkerReady",
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const event of keyEvents) {
      if (line.includes(event)) {
        const ts = extractTimestamp(line) || "?";
        const pid = extractPid(line) || "?";
        timeline.push({
          timestamp: ts,
          event,
          pid,
          phase: inferPhase(event),
          notes: extractNotes(line, event),
        });
        break;
      }
    }
  }

  return timeline.slice(0, 50); // Cap at 50 entries
}

// ─── Counter-evidence ───────────────────────────────────────────────

function findCounterEvidence(lines: string[], hypothesis: string): string[] {
  const counter: string[] = [];
  const hypLower = hypothesis.toLowerCase();

  // If hypothesis involves crash but no crash events found
  if (hypLower.includes("crash") || hypLower.includes("failure")) {
    const hasCrash = lines.some(l =>
      l.includes("BrowserProcessFailure") || l.includes("ProcessExited") || l.includes("crash"));
    if (!hasCrash) {
      counter.push("No crash/ProcessFailure events found — may not be a crash issue");
    }
  }

  // If hypothesis involves navigation but NavigationStarting is present and healthy
  if (hypLower.includes("nav") && hypLower.includes("not received")) {
    const hasCompleted = lines.some(l => l.includes("WebView2_NavigationCompleted"));
    if (hasCompleted) {
      counter.push("WebView2_NavigationCompleted IS present in trace — runtime generated it");
    }
    const hasHandler = lines.some(l => l.includes("WebView2_Event_NavigationCompletedHandler"));
    if (hasHandler) {
      counter.push("WebView2_Event_NavigationCompletedHandler IS present — host DID receive it");
    }
  }

  // If hypothesis involves stuck but APICalled events continue after gap
  if (hypLower.includes("stuck") || hypLower.includes("hung")) {
    const apiLines = lines.filter(l => l.includes("WebView2_APICalled"));
    if (apiLines.length > 5) {
      counter.push(`${apiLines.length} API calls found — host is still active, not fully stuck`);
    }
  }

  // If hypothesis involves auth but no WAM events
  if (hypLower.includes("auth") || hypLower.includes("token")) {
    const hasWam = lines.some(l => l.includes("TokenBroker") || l.includes("WebTokenRequest"));
    if (!hasWam) {
      counter.push("No WAM/TokenBroker events found — issue may not be auth-related");
    }
  }

  return counter;
}

// ─── Alternative explanations ───────────────────────────────────────

function generateAlternatives(
  hypothesis: string,
  lines: string[],
  rootCauses: Record<string, RootCauseEntry>
): string[] {
  const alternatives: string[] = [];
  const hypLower = hypothesis.toLowerCase();

  for (const [key, rc] of Object.entries(rootCauses)) {
    if (hypLower.includes(key)) continue; // Skip the primary hypothesis
    // Check if any evidence for this root cause exists
    const hasEvidence = rc.evidence.some(ev =>
      lines.some(l => l.toLowerCase().includes(ev.toLowerCase().split(" ")[0]))
    );
    if (hasEvidence) {
      alternatives.push(`**${rc.classification}**: ${rc.symptom} — some evidence matches (${rc.evidence[0]})`);
    }
  }

  return alternatives.slice(0, 3);
}

// ─── Confidence scoring ─────────────────────────────────────────────

function computeConfidence(
  evidence: EvidenceItem[],
  counterEvidence: string[],
  hypothesis: string
): { score: number; factors: string[]; wouldChange: string[] } {
  let score = 50; // Start neutral
  const factors: string[] = [];
  const wouldChange: string[] = [];

  // More evidence items → higher confidence
  if (evidence.length > 10) { score += 15; factors.push(`Strong evidence (${evidence.length} items)`); }
  else if (evidence.length > 5) { score += 10; factors.push(`Moderate evidence (${evidence.length} items)`); }
  else { factors.push(`Limited evidence (${evidence.length} items)`); }

  // Counter-evidence lowers confidence
  if (counterEvidence.length > 0) {
    score -= counterEvidence.length * 10;
    factors.push(`${counterEvidence.length} counter-evidence item(s) found`);
  }

  // Cap
  score = Math.max(10, Math.min(95, score));

  // What would change confidence
  wouldChange.push("A good-vs-bad ETL comparison showing divergence at the suspected stage");
  wouldChange.push("Confirming the root cause is absent in a working trace");
  if (counterEvidence.length > 0) {
    wouldChange.push("Explaining the counter-evidence (may rule out this hypothesis)");
  }

  return { score, factors, wouldChange };
}

// ─── Timing anomalies ───────────────────────────────────────────────

function checkTimingAnomalies(
  lines: string[],
  baselines: Record<string, TimingBaseline>
): string[] {
  const anomalies: string[] = [];

  const timingPatterns: { pattern: string; key: string; label: string }[] = [
    { pattern: "NavigationTotal", key: "navigation_total", label: "Navigation total" },
    { pattern: "WebView2_CreationTime", key: "creation_client_cold_start", label: "Creation time" },
    { pattern: "ForwardServiceWorkerToWorkerReady", key: "sw_forward_to_worker_ready", label: "SW activation" },
    { pattern: "CommitToDidCommit", key: "commit_to_did_commit", label: "Commit to DidCommit" },
    { pattern: "BeginNavigationToCommit", key: "begin_navigation_to_commit", label: "BeginNav to Commit" },
  ];

  for (const line of lines) {
    for (const tp of timingPatterns) {
      if (line.includes(tp.pattern)) {
        const durMatch = line.match(/duration[=:]\s*([\d.]+)|(\d+)\s*ms|total_time_ms[=:]\s*([\d.]+)/i);
        if (durMatch) {
          const duration = parseFloat(durMatch[1] || durMatch[2] || durMatch[3]);
          const baseline = baselines[tp.key];
          if (baseline && duration > baseline.p95_ms) {
            anomalies.push(
              `⏱️ **${tp.label}**: ${duration.toFixed(0)}ms (baseline p95=${baseline.p95_ms}ms, p99=${baseline.p99_ms}ms) — **above p95**`
            );
          }
        }
      }
    }
  }

  return anomalies;
}

// ─── Helpers ────────────────────────────────────────────────────────

function extractTimestamp(line: string): string | null {
  const m = line.match(/,\s*(\d{8,})/);
  return m ? m[1] : null;
}

function extractPid(line: string): string | null {
  const m = line.match(/\(\s*(\d+)\s*\)/);
  return m ? m[1] : null;
}

function inferPhase(event: string): string {
  if (event.includes("_Event_")) return "host_dispatch";
  if (event.includes("_Creation_Client")) return "host";
  if (event.includes("_Creation_Server")) return "server";
  if (event.includes("_Factory")) return "factory";
  if (event.includes("NavigationRequest")) return "browser";
  if (event.includes("ServiceWorker") || event.includes("ForwardService")) return "service_worker";
  if (event.includes("TokenBroker") || event.includes("WebTokenRequest")) return "auth";
  return "runtime";
}

function extractNotes(line: string, event: string): string {
  // Extract API ID if present
  if (event === "WebView2_APICalled") {
    const m = line.match(/API[=:]\s*(\d+)/i);
    return m ? `API=${m[1]}` : "";
  }
  // Extract HRESULT
  const hr = line.match(/hr[=:]\s*(0x[0-9a-fA-F]+|\d+)/i);
  if (hr) return `hr=${hr[1]}`;
  // Extract status
  const status = line.match(/status[=:]\s*(\d+)/i);
  if (status) return `status=${status[1]}`;
  return "";
}

// ─── Format output ──────────────────────────────────────────────────

function formatEvidencePack(
  symptom: string,
  hypothesis: string,
  evidence: EvidenceItem[],
  timeline: TimelineEntry[],
  counterEvidence: string[],
  alternatives: string[],
  confidence: { score: number; factors: string[]; wouldChange: string[] },
  timingAnomalies: string[],
  totalLines: number
): string {
  const out: string[] = [];

  out.push("## 📋 Evidence Pack (RCA-Ready)");
  out.push("");
  out.push(`**Symptom**: ${symptom}`);
  out.push(`**Hypothesis**: ${hypothesis}`);
  out.push(`**Confidence**: ${confidence.score}%`);
  out.push(`**Lines analyzed**: ${totalLines}`);
  out.push("");

  // Confidence breakdown
  out.push("### 📊 Confidence Scoring");
  out.push("");
  for (const f of confidence.factors) out.push(`- ${f}`);
  out.push("");
  out.push("**What would change confidence:**");
  for (const w of confidence.wouldChange) out.push(`- ${w}`);
  out.push("");

  // Evidence table
  out.push("### ✅ Supporting Evidence");
  out.push("");
  out.push("| # | Event | Timestamp | Line | Significance |");
  out.push("|---|-------|-----------|------|-------------|");
  for (let i = 0; i < Math.min(evidence.length, 20); i++) {
    const e = evidence[i];
    out.push(`| ${i + 1} | \`${e.event}\` | ${e.timestamp} | L${e.line} | ${e.significance} |`);
  }
  if (evidence.length > 20) out.push(`| ... | ${evidence.length - 20} more items | | | |`);
  out.push("");

  // Timeline
  if (timeline.length > 0) {
    out.push("### 📅 Key Event Timeline");
    out.push("");
    out.push("| Timestamp | Event | PID | Phase | Notes |");
    out.push("|-----------|-------|-----|-------|-------|");
    for (const t of timeline.slice(0, 30)) {
      out.push(`| ${t.timestamp} | \`${t.event}\` | ${t.pid} | ${t.phase} | ${t.notes} |`);
    }
    if (timeline.length > 30) out.push(`| ... | ${timeline.length - 30} more | | | |`);
    out.push("");
  }

  // Timing anomalies
  if (timingAnomalies.length > 0) {
    out.push("### ⏱️ Timing Anomalies");
    out.push("");
    for (const a of timingAnomalies) out.push(`- ${a}`);
    out.push("");
  }

  // Counter-evidence
  if (counterEvidence.length > 0) {
    out.push("### ⚠️ Counter-Evidence");
    out.push("");
    for (const c of counterEvidence) out.push(`- ${c}`);
    out.push("");
  }

  // Alternative explanations
  if (alternatives.length > 0) {
    out.push("### 🔄 Alternative Explanations");
    out.push("");
    for (const a of alternatives) out.push(`- ${a}`);
    out.push("");
  }

  // Next steps
  out.push("### ▶️ Next Steps");
  out.push("");
  out.push("1. **Validate** — Use `validate_trace` to check API happy-path completeness");
  out.push("2. **Compare** — Use `compare_etls` with a known-good trace to confirm divergence");
  out.push("3. **Feedback** — Use `rca_feedback` to confirm/deny this root cause and improve the KB");
  out.push("4. **Share** — Use `share_learnings` to push confirmed findings to the shared KB");

  return out.join("\n");
}
