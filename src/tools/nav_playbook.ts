/**
 * nav_playbook: Deterministic navigation lifecycle playbook.
 * Correlates events by NavigationId, checks each lifecycle stage,
 * detects host-vs-runtime boundary issues, and reports the exact
 * stage where the navigation pipeline breaks.
 *
 * Reference: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/navigation-events
 */

import { readFileSync, existsSync } from "fs";
import { loadJson } from "../knowledge/loader.js";

interface NavEvent {
  event: string;
  timestamp: string;
  line: number;
  pid: string;
  navigationId: string | null;
  apiId: number | null;
  phase: string;
  raw: string;
}

interface StageResult {
  stage: string;
  order: number;
  status: "✅ passed" | "❌ failed" | "⚠️ partial" | "⬜ not checked";
  events: NavEvent[];
  failureVariants: NavEvent[];
  notes: string[];
}

interface BoundaryCheck {
  name: string;
  status: "✅ ok" | "❌ issue" | "⬜ n/a";
  detail: string;
}

// ─── Main entry point ───────────────────────────────────────────────

export function navPlaybook(
  filteredFilePath: string,
  scenario: string = "nav_completed_not_received"
): string {
  if (!existsSync(filteredFilePath)) {
    return `❌ File not found: ${filteredFilePath}`;
  }

  const lines = readFileSync(filteredFilePath, "utf-8").split("\n").filter(l => l.trim());
  if (lines.length === 0) return "❌ File is empty";

  // Extract all navigation-related events
  const navEvents = extractNavEvents(lines);

  if (navEvents.length === 0) {
    return [
      "## 🧭 Navigation Playbook",
      "",
      "⚠️ No navigation-related events found in this trace.",
      `Scanned ${lines.length} lines.`,
      "",
      "Possible reasons:",
      "- Trace was not filtered for WebView2 events",
      "- No navigation was attempted in this timeframe",
      "- Host app uses a different navigation pattern",
    ].join("\n");
  }

  // Group events by NavigationId
  const navGroups = groupByNavigationId(navEvents);

  // Run deterministic checks for each navigation
  const allResults: { navId: string; stages: StageResult[]; boundaries: BoundaryCheck[] }[] = [];

  for (const [navId, events] of navGroups) {
    const stages = checkNavigationStages(events, lines);
    const boundaries = checkBoundaries(events, lines);
    allResults.push({ navId, stages, boundaries });
  }

  // Also check for events without a NavigationId (orphaned)
  const orphanedEvents = navEvents.filter(e => !e.navigationId);

  return formatPlaybookReport(scenario, navEvents, allResults, orphanedEvents, lines.length);
}

// ─── Event extraction ───────────────────────────────────────────────

function extractNavEvents(lines: string[]): NavEvent[] {
  const events: NavEvent[] = [];

  const navPatterns = [
    "WebView2_APICalled",
    "WebView2_NavigationStarting",
    "WebView2_NavigationCompleted",
    "WebView2_Event_NavigationStartingHandler",
    "WebView2_Event_NavigationCompletedHandler",
    "WebView2_SourceChanged",
    "WebView2_ContentLoading",
    "WebView2_DOMContentLoaded",
    "WebView2_HistoryChanged",
    "WebView2_DocStateChanged",
    "WebView2_DocStateSuppressed",
    "WebView2_NavIdNotFound",
    "WebView2_DifferentNavigationId",
    "WebView2_NoHandlers",
    "WebView2_IFrameNotFound",
    "WebView2_DroppedEvent",
    "WebView2_NoEventDispatcher",
    "NavigationRequest::Create",
    "NavigationRequest::BeginNavigation",
    "NavigationRequest::CommitNavigation",
    "NavigationRequest::DidCommitNavigation",
    "NavigationRequest::OnRequestFailedInternal",
    "WebView2_Event_ContentLoadingHandler",
    "WebView2_Event_DOMContentLoadedHandler",
    "WebView2_Event_SourceChangedHandler",
    "WebView2_Event_HistoryChangedHandler",
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of navPatterns) {
      if (line.includes(pattern)) {
        events.push({
          event: pattern,
          timestamp: extractTimestamp(line) || `${i}`,
          line: i + 1,
          pid: extractPid(line) || "?",
          navigationId: extractNavigationId(line),
          apiId: extractApiId(line),
          phase: inferPhase(pattern),
          raw: line.slice(0, 200),
        });
        break;
      }
    }
  }

  return events;
}

function extractTimestamp(line: string): string | null {
  const m = line.match(/,\s*(\d{8,})/);
  return m ? m[1] : null;
}

function extractPid(line: string): string | null {
  const m = line.match(/\(\s*(\d+)\s*\)/);
  return m ? m[1] : null;
}

function extractNavigationId(line: string): string | null {
  // Look for NavigationId patterns
  const patterns = [
    /NavigationId[=:]\s*(\d+)/i,
    /navigation_id[=:]\s*(\d+)/i,
    /NavId[=:]\s*(\d+)/i,
    /Field\s*\d+\s*=\s*(\d+)/i, // Generic field that might be NavId
  ];
  for (const p of patterns) {
    const m = line.match(p);
    if (m) return m[1];
  }
  return null;
}

function extractApiId(line: string): number | null {
  if (!line.includes("WebView2_APICalled")) return null;
  const m = line.match(/API[=:]\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

function inferPhase(event: string): string {
  if (event.includes("_Event_")) return "host_dispatch";
  if (event.includes("NavigationRequest")) return "browser";
  if (event.includes("NoHandlers") || event.includes("DroppedEvent") || event.includes("NoEventDispatcher")) return "dispatch_failure";
  if (event.includes("NavIdNotFound") || event.includes("DifferentNavigationId") || event.includes("DocStateSuppressed")) return "suppression";
  if (event.includes("IFrameNotFound")) return "frame_issue";
  return "runtime";
}

// ─── Group by NavigationId ──────────────────────────────────────────

function groupByNavigationId(events: NavEvent[]): Map<string, NavEvent[]> {
  const groups = new Map<string, NavEvent[]>();
  for (const event of events) {
    if (!event.navigationId) continue;
    const list = groups.get(event.navigationId) || [];
    list.push(event);
    groups.set(event.navigationId, list);
  }
  return groups;
}

// ─── Stage checks ───────────────────────────────────────────────────

function checkNavigationStages(events: NavEvent[], lines: string[]): StageResult[] {
  const stages: StageResult[] = [
    checkStage("Navigate API", 1, events, ["WebView2_APICalled"], [], true),
    checkStage("NavigationStarting", 2, events,
      ["WebView2_NavigationStarting", "WebView2_Event_NavigationStartingHandler"],
      ["WebView2_NoHandlers"], true),
    checkStage("NavigationRequest", 3, events,
      ["NavigationRequest::Create", "NavigationRequest::BeginNavigation"], [], true),
    checkStage("SourceChanged", 4, events,
      ["WebView2_SourceChanged", "WebView2_Event_SourceChangedHandler"], [], false),
    checkStage("ContentLoading", 5, events,
      ["WebView2_ContentLoading", "WebView2_Event_ContentLoadingHandler"], [], false),
    checkStage("DocumentCommit", 6, events,
      ["NavigationRequest::CommitNavigation", "NavigationRequest::DidCommitNavigation", "WebView2_DocStateChanged"],
      ["WebView2_DocStateSuppressed", "WebView2_NavIdNotFound"], true),
    checkStage("HistoryChanged", 7, events,
      ["WebView2_HistoryChanged"], [], false),
    checkStage("DOMContentLoaded", 8, events,
      ["WebView2_DOMContentLoaded", "WebView2_Event_DOMContentLoadedHandler"], [], false),
    checkStage("NavigationCompleted", 9, events,
      ["WebView2_NavigationCompleted", "WebView2_Event_NavigationCompletedHandler"],
      ["WebView2_NavIdNotFound", "WebView2_DifferentNavigationId", "WebView2_NoHandlers", "WebView2_IFrameNotFound"],
      true),
  ];

  return stages;
}

function checkStage(
  name: string,
  order: number,
  events: NavEvent[],
  expectedEvents: string[],
  failureVariantPatterns: string[],
  required: boolean
): StageResult {
  const found = events.filter(e => expectedEvents.some(p => e.event.includes(p)));
  const failures = events.filter(e => failureVariantPatterns.some(p => e.event.includes(p)));

  let status: StageResult["status"];
  if (found.length > 0 && failures.length === 0) {
    status = "✅ passed";
  } else if (found.length > 0 && failures.length > 0) {
    status = "⚠️ partial";
  } else if (failures.length > 0) {
    status = "❌ failed";
  } else if (!required) {
    status = "⬜ not checked";
  } else {
    status = "❌ failed";
  }

  const notes: string[] = [];
  if (found.length > 0) {
    notes.push(`Found: ${found.map(e => e.event).join(", ")}`);
  } else if (required) {
    notes.push(`MISSING: Expected ${expectedEvents.join(" or ")}`);
  }
  if (failures.length > 0) {
    notes.push(`Failure variants: ${failures.map(e => e.event).join(", ")}`);
  }

  return { stage: name, order, status, events: found, failureVariants: failures, notes };
}

// ─── Boundary checks ────────────────────────────────────────────────

function checkBoundaries(events: NavEvent[], lines: string[]): BoundaryCheck[] {
  const checks: BoundaryCheck[] = [];

  // Check: RuntimeToHost dispatch for NavigationCompleted
  const runtimeCompleted = events.find(e => e.event === "WebView2_NavigationCompleted");
  const hostCompleted = events.find(e => e.event === "WebView2_Event_NavigationCompletedHandler");
  if (runtimeCompleted && !hostCompleted) {
    checks.push({
      name: "NavigationCompleted: Runtime → Host",
      status: "❌ issue",
      detail: "Runtime generated NavigationCompleted but host never received it. Check for suppression or missing handler.",
    });
  } else if (runtimeCompleted && hostCompleted) {
    checks.push({
      name: "NavigationCompleted: Runtime → Host",
      status: "✅ ok",
      detail: "NavigationCompleted delivered to host successfully.",
    });
  } else if (!runtimeCompleted) {
    checks.push({
      name: "NavigationCompleted: Runtime → Host",
      status: "❌ issue",
      detail: "NavigationCompleted was never generated by the runtime.",
    });
  }

  // Check: RuntimeToHost dispatch for NavigationStarting
  const runtimeStarting = events.find(e => e.event === "WebView2_NavigationStarting");
  const hostStarting = events.find(e => e.event === "WebView2_Event_NavigationStartingHandler");
  if (runtimeStarting && !hostStarting) {
    checks.push({
      name: "NavigationStarting: Runtime → Host",
      status: "❌ issue",
      detail: "Runtime generated NavigationStarting but host never received it.",
    });
  } else if (runtimeStarting && hostStarting) {
    checks.push({
      name: "NavigationStarting: Runtime → Host",
      status: "✅ ok",
      detail: "NavigationStarting delivered to host successfully.",
    });
  }

  // Check: NavigationId consistency
  const navIds = new Set(events.filter(e => e.navigationId).map(e => e.navigationId));
  const hasMismatch = events.some(e => e.event.includes("DifferentNavigationId"));
  const hasNotFound = events.some(e => e.event.includes("NavIdNotFound"));
  if (hasMismatch || hasNotFound) {
    checks.push({
      name: "NavigationId Consistency",
      status: "❌ issue",
      detail: `NavigationId mismatch detected. IDs seen: ${[...navIds].join(", ")}. ${hasMismatch ? "DifferentNavigationId present." : ""} ${hasNotFound ? "NavIdNotFound present." : ""}`,
    });
  } else if (navIds.size > 0) {
    checks.push({
      name: "NavigationId Consistency",
      status: "✅ ok",
      detail: `Consistent NavigationId(s): ${[...navIds].join(", ")}`,
    });
  }

  // Check: Handler registration
  const noHandlers = events.filter(e => e.event.includes("NoHandlers"));
  if (noHandlers.length > 0) {
    checks.push({
      name: "Handler Registration",
      status: "❌ issue",
      detail: `No handlers registered for: ${noHandlers.map(e => e.event).join(", ")}`,
    });
  }

  // Check: Iframe lifecycle
  const iframeNotFound = events.filter(e => e.event.includes("IFrameNotFound"));
  if (iframeNotFound.length > 0) {
    checks.push({
      name: "IFrame Lifecycle",
      status: "❌ issue",
      detail: "IFrame was removed mid-navigation — events for this frame will be dropped.",
    });
  }

  // Check: Event drops
  const droppedEvents = events.filter(e =>
    e.event.includes("DroppedEvent") || e.event.includes("NoEventDispatcher"));
  if (droppedEvents.length > 0) {
    checks.push({
      name: "Event Delivery",
      status: "❌ issue",
      detail: `${droppedEvents.length} event(s) dropped or had no dispatcher.`,
    });
  }

  return checks;
}

// ─── Format output ──────────────────────────────────────────────────

function formatPlaybookReport(
  scenario: string,
  allEvents: NavEvent[],
  results: { navId: string; stages: StageResult[]; boundaries: BoundaryCheck[] }[],
  orphaned: NavEvent[],
  totalLines: number
): string {
  const out: string[] = [];

  out.push("## 🧭 Navigation Playbook Report");
  out.push("");
  out.push(`**Scenario**: ${scenario}`);
  out.push(`**Navigation events found**: ${allEvents.length}`);
  out.push(`**Unique NavigationIds**: ${results.length}`);
  out.push(`**Lines scanned**: ${totalLines}`);
  out.push("");
  out.push(`📖 Reference: [WebView2 Navigation Events](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/navigation-events)`);
  out.push("");

  for (const result of results) {
    out.push(`### Navigation ID: ${result.navId}`);
    out.push("");

    // Stage pipeline
    out.push("#### Lifecycle Pipeline");
    out.push("");
    const pipeline = result.stages
      .map(s => {
        const icon = s.status.split(" ")[0];
        return `${icon} ${s.stage}`;
      })
      .join(" → ");
    out.push(pipeline);
    out.push("");

    // Stage details table
    out.push("| # | Stage | Status | Details |");
    out.push("|---|-------|--------|---------|");
    for (const s of result.stages) {
      const details = s.notes.join("; ") || "—";
      out.push(`| ${s.order} | ${s.stage} | ${s.status} | ${details} |`);
    }
    out.push("");

    // First failure point
    const firstFailure = result.stages.find(s => s.status === "❌ failed");
    if (firstFailure) {
      out.push(`> 🔴 **Pipeline breaks at stage ${firstFailure.order}: ${firstFailure.stage}**`);
      out.push(`> ${firstFailure.notes.join(". ")}`);
      out.push("");
    }

    // Boundary checks
    if (result.boundaries.length > 0) {
      out.push("#### Boundary Checks (Host ↔ Runtime)");
      out.push("");
      for (const b of result.boundaries) {
        out.push(`- ${b.status} **${b.name}**: ${b.detail}`);
      }
      out.push("");
    }
  }

  // Orphaned events
  if (orphaned.length > 0) {
    out.push("### ⚠️ Events Without NavigationId");
    out.push("");
    out.push("These events could not be correlated to a specific navigation:");
    out.push("");
    for (const e of orphaned.slice(0, 20)) {
      out.push(`- L${e.line}: \`${e.event}\` (PID ${e.pid}, ts ${e.timestamp})`);
    }
    if (orphaned.length > 20) out.push(`- ... and ${orphaned.length - 20} more`);
    out.push("");
  }

  // Recommendations
  out.push("### 💡 Recommendations");
  out.push("");
  const hasRuntimeNoHost = results.some(r =>
    r.boundaries.some(b => b.name.includes("NavigationCompleted") && b.status === "❌ issue"));
  const hasNoHandlers = results.some(r =>
    r.boundaries.some(b => b.name === "Handler Registration" && b.status === "❌ issue"));
  const hasNavIdIssue = results.some(r =>
    r.boundaries.some(b => b.name === "NavigationId Consistency" && b.status === "❌ issue"));

  if (hasRuntimeNoHost) {
    out.push("1. **Check event suppression** — NavigationCompleted was generated but not delivered to host.");
    out.push("   Look for `initializing_navigation_id_` suppression (about:blank issue).");
    out.push("   Check `IsEdgeWebViewCancelInitialNavigationEnabled` feature flag.");
  }
  if (hasNoHandlers) {
    out.push("2. **Register handlers earlier** — Events fired but no handler was registered.");
    out.push("   Move `add_NavigationCompleted` before controller creation completes.");
  }
  if (hasNavIdIssue) {
    out.push("3. **NavigationId mismatch** — Events have mismatched NavigationIds.");
    out.push("   This may indicate a stale navigation or concurrent navigations.");
  }
  if (!hasRuntimeNoHost && !hasNoHandlers && !hasNavIdIssue) {
    out.push("- All navigation boundary checks passed. Use `evidence_pack` for deeper analysis.");
  }

  return out.join("\n");
}
