/**
 * unified_analyze: Single tool that does everything.
 *
 * Phase 1 (no filtered_file): generates extraction commands.
 * Phase 2 (filtered_file provided): runs full analysis pipeline:
 *   config → process tree → activity → initial issues → triage → nav_playbook → evidence_pack → timeline_slice → CPU (opt-in)
 *
 * All sub-analyses are combined into one comprehensive report.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { analyzeEtl, generateFilterCommand } from "./analyze.js";
import { triage } from "./triage.js";
import { navPlaybook } from "./nav_playbook.js";
import { evidencePack } from "./evidence_pack.js";
import { timelineSlice } from "./timeline_slice.js";
import { analyzeCpu } from "./analyze_cpu.js";
import { validateTrace } from "./validate_trace.js";
import { compareEtls } from "./compare_etls.js";
import { extractTraceStructure, formatTraceStructureReport, type TraceStructure } from "./trace_structure.js";
import { buildStructuredReport, formatStructuredReportMarkdown, type ETLAnalysisReport } from "./structured_report.js";

export interface UnifiedParams {
  etlPath: string;
  hostApp: string;
  symptom?: string;
  filteredFile?: string;
  includeCpu?: boolean;
  pid?: string;
  cpuKeywords?: string[];
  startTime?: string;
  endTime?: string;
  goodEtl?: string;
  goodFiltered?: string;
  outputDir?: string;
}

export function unifiedAnalyze(params: UnifiedParams): string {
  // ── Phase 1: No filtered file → extraction commands ──
  if (!params.filteredFile) {
    const extractionCmds = analyzeEtl(params.etlPath, params.hostApp, params.outputDir);

    // Replace the "Next Steps" section with simplified guidance
    const nextSteps = [
      "",
      "### Next Steps",
      "After running the commands above, call `analyze_etl` again with the `filtered_file` parameter:",
      "```",
      `analyze_etl with filtered_file = "$outDir\\filtered.txt"`,
      "```",
      "The server will automatically run: triage → navigation playbook → evidence pack.",
    ].join("\n");

    // Replace the old "Next Steps" section
    const marker = "### Next Steps";
    const idx = extractionCmds.indexOf(marker);
    if (idx >= 0) {
      return extractionCmds.slice(0, idx) + nextSteps;
    }
    return extractionCmds + "\n" + nextSteps;
  }

  // ── Phase 2: Filtered file provided → full analysis ──
  return runFullAnalysis(params);
}

function runFullAnalysis(params: UnifiedParams): string {
  const {
    filteredFile,
    etlPath,
    hostApp,
    symptom = "",
    includeCpu = false,
    pid,
    cpuKeywords,
    startTime,
    endTime,
    goodEtl,
    goodFiltered,
  } = params;

  if (!filteredFile || !existsSync(filteredFile)) {
    return `❌ Filtered file not found: ${filteredFile}`;
  }

  const sections: string[] = [];
  const outputDir = params.outputDir || "C:\\temp\\etl_analysis";

  // ── Run all analyzers first, then assemble report in user-friendly order ──

  // Extract trace structure
  let traceStructure: ReturnType<typeof extractTraceStructure> | null = null;
  try {
    traceStructure = extractTraceStructure(filteredFile, hostApp);
  } catch (err) {
    // Will handle gracefully in each section
  }

  // Run triage
  const triageResult = triage(filteredFile, symptom);
  const topSuspect = extractTopSuspect(triageResult);
  const isNavRelated = isNavigationScenario(symptom, triageResult);

  // Build structured JSON report (for metrics, RCA, etc.)
  let structuredReport: ETLAnalysisReport | null = null;
  if (traceStructure) {
    try {
      const evidenceResult = topSuspect ? evidencePack(filteredFile, topSuspect, symptom) : "";
      structuredReport = buildStructuredReport(
        filteredFile, etlPath, hostApp, traceStructure, triageResult, evidenceResult,
      );
    } catch { /* handled below */ }
  }

  // Parse triage for root causes (primary + secondary)
  const rootCauses = parseRootCauses(triageResult);

  // ── 1. HEADER ──
  const etlName = etlPath.split(/[/\\]/).pop() || etlPath;
  const etlSizeMB = structuredReport?.metadata?.etlSizeMB;
  const sizeStr = etlSizeMB ? ` (${(etlSizeMB / 1024).toFixed(1)} GB)` : "";
  sections.push([
    "# 🔍 WebView2 ETL Analysis Report",
    "",
    `**ETL**: \`${etlName}\`${sizeStr} | **Host App**: ${hostApp} | **Symptom**: ${symptom || "Not specified"}`,
    "",
  ].join("\n"));

  // ── 2. VERDICT (most important — first thing users read) ──
  sections.push(buildVerdict(topSuspect, rootCauses, structuredReport, traceStructure));

  // ── 3. ANNOTATED TIMELINE ──
  if (traceStructure) {
    const timeline = buildAnnotatedTimeline(traceStructure, topSuspect);
    if (timeline) {
      sections.push("---\n");
      sections.push(timeline);
    }
  }

  // ── 4. NAVIGATION SEQUENCE VALIDATION ──
  if (isNavRelated && traceStructure) {
    sections.push("---\n");
    sections.push(buildSequenceVisualization(filteredFile, structuredReport));
  }

  // ── 5. ROOT CAUSE ANALYSIS ──
  sections.push("---\n");
  sections.push(buildRCASection(rootCauses, structuredReport));

  // ── 6. KEY METRICS ──
  if (structuredReport) {
    sections.push("---\n");
    sections.push(buildMetricsTable(structuredReport));
  }

  // ── 7. PROCESS SUMMARY (collapsed) ──
  if (traceStructure) {
    sections.push("---\n");
    sections.push(buildCollapsedProcessSummary(traceStructure));
  }

  // ── 8. INITIAL WARNINGS ──
  if (traceStructure && traceStructure.issues.length > 0) {
    sections.push("---\n");
    sections.push(buildWarningsSection(traceStructure));
  }

  // ── 9. CONFIGURATION SNAPSHOT ──
  if (traceStructure) {
    sections.push("---\n");
    sections.push(buildConfigSnapshot(traceStructure));
  }

  // ── 10. OPTIONAL: Timeline slice, comparison, CPU ──
  if (startTime && endTime) {
    sections.push("---\n");
    const slice = timelineSlice(filteredFile, startTime, endTime, pid);
    sections.push(slice);
  }

  if (goodEtl || goodFiltered) {
    sections.push("---\n");
    const comparison = compareEtls(
      goodEtl || "", etlPath, hostApp, goodFiltered, filteredFile
    );
    sections.push(comparison);
  }

  if (includeCpu) {
    sections.push("---\n");
    if (!pid) {
      sections.push("## ⏳ CPU Analysis\n\nCPU analysis requested but no `pid` provided. Check the process summary above and re-run with the PID.\n");
    } else {
      const keywords = cpuKeywords || ["msedge.dll", "msedgewebview2.dll", "webview2", "ntdll"];
      sections.push(analyzeCpu(etlPath, pid, keywords, startTime, endTime, undefined));
    }
  }

  // ── 11. NEXT STEPS (user-friendly) ──
  sections.push("---\n");
  sections.push(buildUserFriendlyNextSteps(topSuspect, isNavRelated, includeCpu, !!startTime, traceStructure));

  // ── 12. APPENDIX (link to JSON, not inline) ──
  sections.push("---\n");
  sections.push(buildAppendixSection(outputDir));

  const fullReport = sections.join("\n");

  // ── Save report + JSON evidence to output directory ──
  try {
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }
    const reportPath = join(outputDir, "full_analysis_report.md");
    writeFileSync(reportPath, fullReport, "utf-8");

    // Save JSON evidence separately
    if (structuredReport) {
      const jsonPath = join(outputDir, "evidence_data.json");
      writeFileSync(jsonPath, JSON.stringify(structuredReport, null, 2), "utf-8");
    }

    const savedNotice = [
      "",
      "---",
      "",
      "## 📁 Report Saved",
      "",
      `✅ Full analysis report saved to: **${reportPath}**`,
      structuredReport ? `✅ Evidence JSON saved to: **${join(outputDir, "evidence_data.json")}**` : "",
      "",
      "You can open the report in any markdown viewer or editor to review the complete analysis.",
    ].filter(Boolean).join("\n");

    return fullReport + savedNotice;
  } catch {
    return fullReport;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

interface ParsedRootCause {
  label: string;
  confidence: number;
  category: string;
  stage: string;
  evidence: string[];
  missing: string[];
}

function parseRootCauses(triageOutput: string): ParsedRootCause[] {
  const causes: ParsedRootCause[] = [];
  // Match "**N. <label>** (XX% confidence)\n   Category: ... | Stage: ..."
  const pattern = /\*\*(\d+)\.\s+(.+?)\*\*\s*\((\d+)%\s*confidence\)\s*\n\s*Category:\s*(.+?)\s*\|\s*Stage:\s*(.+?)(?:\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(triageOutput)) !== null) {
    const idx = parseInt(match[1]);
    const label = match[2].trim();
    const conf = parseInt(match[3]);
    const cat = match[4].trim();
    const stage = match[5].trim();

    // Extract evidence lines following this cause
    const afterMatch = triageOutput.slice(match.index + match[0].length);
    const evidenceLines: string[] = [];
    const missingLines: string[] = [];
    for (const line of afterMatch.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("- ✅") || trimmed.startsWith("- 🔍") || trimmed.startsWith("- 🚫")) {
        evidenceLines.push(trimmed.replace(/^-\s*/, ""));
      } else if (trimmed.startsWith("- ⚠️")) {
        missingLines.push(trimmed.replace(/^-\s*/, ""));
      } else if (trimmed.startsWith(`**${idx + 1}.`) || trimmed === "") {
        if (evidenceLines.length > 0 || missingLines.length > 0) break;
      }
    }

    causes.push({ label, confidence: conf, category: cat, stage, evidence: evidenceLines, missing: missingLines });
  }
  return causes;
}

function buildVerdict(
  topSuspect: string,
  rootCauses: ParsedRootCause[],
  report: ETLAnalysisReport | null,
  structure: TraceStructure | null,
): string {
  const primary = rootCauses[0];
  const confidence = primary ? `${primary.confidence}%` : "Unknown";
  const confLabel = primary && primary.confidence >= 70 ? "High" : primary && primary.confidence >= 50 ? "Moderate" : "Low";

  // Build impact statement
  let impact = "The host application may be in an unexpected state.";
  if (topSuspect.toLowerCase().includes("navigation")) {
    impact = "The host app was never notified that navigation finished. If it waits on this event before showing content, the result is a **blank but responsive UI**.";
  } else if (topSuspect.toLowerCase().includes("auth") || topSuspect.toLowerCase().includes("token")) {
    impact = "Authentication failures may prevent content from loading, resulting in blank or error pages.";
  } else if (topSuspect.toLowerCase().includes("renderer") || topSuspect.toLowerCase().includes("crash")) {
    impact = "Renderer instability means the page cannot render reliably — content may flash or go blank.";
  } else if (topSuspect.toLowerCase().includes("service worker")) {
    impact = "Service worker delays may cause prolonged blank pages before content appears.";
  }

  // Build key action
  let keyAction = "Compare with a working trace to confirm this is the divergence point.";
  if (topSuspect.toLowerCase().includes("navigation") && topSuspect.toLowerCase().includes("completed")) {
    keyAction = "Compare with a working trace to confirm divergence. Check if event handlers (`add_NavigationCompleted`) were registered before navigation began.";
  }

  const missingNote = primary?.missing?.length
    ? `, but missing \`${primary.missing[0]?.replace(/^⚠️\s*Expected\s*/i, "").replace(/\s*not found$/i, "")}\` weakens temporal correlation`
    : "";

  const out: string[] = [
    "## 🎯 Verdict",
    "",
    "| | |",
    "|---|---|",
    `| **Finding** | \`${topSuspect || "Unknown"}\` — ${primary?.stage ? `at the ${primary.stage} stage` : "root cause could not be determined"}. |`,
    `| **Confidence** | **${confidence}** (${confLabel})${missingNote ? ` — strong event evidence${missingNote}` : ""} |`,
    `| **Impact** | ${impact} |`,
    `| **Key Action** | ${keyAction} |`,
    "",
  ];
  return out.join("\n");
}

function buildAnnotatedTimeline(
  structure: TraceStructure,
  topSuspect: string
): string | null {
  const issueIncs = structure.incarnations.filter(i => i.hasIssue);
  if (issueIncs.length === 0 && structure.incarnations.length === 0) return null;

  const targetInc = issueIncs.length > 0 ? issueIncs[0] : structure.incarnations[0];
  if (targetInc.keyEvents.length === 0) return null;

  const baseTs = targetInc.creationTs;
  const events = targetInc.keyEvents.sort((a, b) => a.ts - b.ts);

  const out: string[] = [
    `## ⏱️ Annotated Timeline (Incarnation #${targetInc.id} — ${targetInc.issueHint || "where it broke"})`,
    "",
    "```",
    "Time          Event                              PID     What happened",
    "─────────────────────────────────────────────────────────────────────────────────",
  ];

  let prevTs = baseTs;
  for (const e of events.slice(0, 20)) {
    const relMs = (e.ts - baseTs) / 1000;
    const deltaMs = (e.ts - prevTs) / 1000;
    const phase = describeEvent(e.event);

    // Insert gap annotation for large gaps
    if (deltaMs > 500 && prevTs !== baseTs) {
      out.push(`              │`);
      out.push(`              │  ⚠️ ${formatMs(deltaMs)} gap — ${inferGapReason(events, e)}`);
      out.push(`              │`);
    }

    const timeStr = formatMsAligned(relMs);
    const eventName = e.event.length > 35 ? e.event.slice(0, 32) + "..." : e.event;
    out.push(`${timeStr}${padRight(eventName, 35)} ${padRight(String(e.pid), 8)}${phase}`);
    prevTs = e.ts;
  }

  // Add break annotation if navigation-related and missing events
  if (topSuspect.toLowerCase().includes("navigation")) {
    out.push(`              │`);
    out.push(`              │  ❌ BREAK — Expected events that never arrived:`);
    out.push(`              │     • WebView2_NavigationStarting  (host was never told nav started)`);
    out.push(`              │     • WebView2_NavigationCompleted  (host was never told nav finished)`);
    out.push(`              │     • WebView2_DOMContentLoaded     (host never got DOM ready)`);
    out.push(`              │`);
    out.push(`              └── Host is now stuck waiting for NavigationCompleted that will never come`);
  }

  if (events.length > 20) {
    out.push(`              ... +${events.length - 20} more events`);
  }
  out.push("```");

  // Suspicious gaps summary
  const gaps: { fromEvent: string; toEvent: string; gapMs: number }[] = [];
  for (let i = 1; i < events.length; i++) {
    const gapMs = (events[i].ts - events[i - 1].ts) / 1000;
    if (gapMs > 500) {
      gaps.push({ fromEvent: events[i - 1].event, toEvent: events[i].event, gapMs });
    }
  }
  if (gaps.length > 0) {
    out.push("");
    for (const g of gaps.slice(0, 3)) {
      out.push(`**Suspicious gap**: ${formatMs(g.gapMs)} between \`${g.fromEvent}\` → \`${g.toEvent}\``);
    }
  }

  out.push("");
  return out.join("\n");
}

function buildSequenceVisualization(
  filteredFile: string,
  report: ETLAnalysisReport | null,
): string {
  // Define the expected Navigate flow steps
  const steps = [
    { name: "WebView2_APICalled (API=Navigate)", short: "API Called", key: "WebView2_APICalled" },
    { name: "WebView2_NavigationStarting", short: "NavStarting", key: "WebView2_NavigationStarting" },
    { name: "NavigationRequest::Create", short: "Create", key: "NavigationRequest::Create" },
    { name: "NavigationRequest::BeginNavigation", short: "BeginNav", key: "NavigationRequest::BeginNavigation" },
    { name: "NavigationRequest::StartNavigation", short: "StartNav", key: "NavigationRequest::StartNavigation" },
    { name: "WebView2_SourceChanged", short: "SrcChanged", key: "WebView2_SourceChanged" },
    { name: "WebView2_ContentLoading", short: "Content", key: "WebView2_ContentLoading" },
    { name: "NavigationRequest::CommitNavigation", short: "Commit", key: "NavigationRequest::CommitNavigation" },
    { name: "NavigationRequest::DidCommitNavigation", short: "DidCommit", key: "NavigationRequest::DidCommitNavigation" },
    { name: "WebView2_HistoryChanged", short: "History", key: "WebView2_HistoryChanged" },
    { name: "WebView2_DOMContentLoaded", short: "DOM", key: "WebView2_DOMContentLoaded" },
    { name: "WebView2_NavigationCompleted", short: "NavCompleted", key: "WebView2_NavigationCompleted" },
    { name: "NavigationCompletedHandler dispatched", short: "Handler", key: "WebView2_Event_NavigationCompletedHandler" },
  ];

  // Check which events exist in the filtered file
  let content = "";
  try { content = readFileSync(filteredFile, "utf-8"); } catch { /* empty */ }

  const out: string[] = [
    "## 🧭 Navigation Sequence Validation",
    "",
    "Expected vs. actual events for the [Navigate flow](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/navigation-events):",
    "",
    "```",
    "Step  Expected Event                          Status    Notes",
    "───────────────────────────────────────────────────────────────",
  ];

  let lastFoundIdx = -1;
  let firstMissingIdx = -1;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const found = content.includes(s.key);
    const status = found ? "✅ Found" : "❌ MISSING";
    let notes = "";

    if (found) {
      // Count occurrences
      const count = (content.match(new RegExp(s.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "g")) || []).length;
      notes = count > 1 ? `${count} occurrences` : "";
      lastFoundIdx = i;
    } else {
      if (firstMissingIdx === -1) firstMissingIdx = i;
      if (s.key === "WebView2_NavigationCompleted") notes = "← Root cause";
      else if (s.key === "WebView2_Event_NavigationCompletedHandler") notes = "← Host callback never fired";
      else if (s.key === "WebView2_NavigationStarting") notes = "Host never notified";
    }

    const stepNum = padRight(String(i + 1), 6);
    const eventName = padRight(s.name, 40);
    out.push(`${stepNum}${eventName}${padRight(status, 10)}${notes}`);
  }
  out.push("```");

  // Interpretation
  out.push("");
  const foundBrowser = steps.filter((s, i) => content.includes(s.key) && s.key.includes("NavigationRequest")).length;
  const foundHost = steps.filter((s, i) => content.includes(s.key) && s.key.includes("WebView2_")).length;

  if (foundBrowser > 0 && firstMissingIdx !== -1) {
    out.push(`**Interpretation**: The browser-side navigation completed normally (${foundBrowser} browser events found). But **host-facing events were not delivered** — either the handlers weren't registered in time, or events were suppressed.`);
  }

  out.push("");
  return out.join("\n");
}

function buildRCASection(rootCauses: ParsedRootCause[], report: ETLAnalysisReport | null): string {
  const out: string[] = [
    "## 🔍 Root Cause Analysis",
    "",
  ];

  if (rootCauses.length === 0) {
    out.push("No root causes identified with sufficient confidence.");
    return out.join("\n");
  }

  // Primary
  const primary = rootCauses[0];
  out.push(`### 🟥 Primary: ${primary.label} (${primary.confidence}%)`);
  out.push("");
  out.push(`**Stage**: ${primary.stage}`);
  out.push("");

  if (primary.evidence.length > 0 || primary.missing.length > 0) {
    out.push("| Evidence | Detail |");
    out.push("|----------|--------|");
    for (const e of primary.evidence) {
      // Strip leading emoji markers and clean up for display
      const cleaned = e.replace(/^[✅🔍🚫]\s*/, "").replace(/^[^\w]*/, "");
      const icon = e.startsWith("✅") ? "✅ Present" : e.startsWith("🚫") ? "🚫 Confirmed absent" : "🔍 Detected";
      out.push(`| ${icon} | ${cleaned} |`);
    }
    for (const m of primary.missing) {
      out.push(`| ⚠️ Unexpectedly absent | ${m.replace(/^⚠️\s*/, "")} |`);
    }
    out.push("");
  }

  // Alternative explanations from structured report
  if (report?.rootCauseAnalysis?.primary) {
    const rca = report.rootCauseAnalysis;
    if (rca.secondary && rca.secondary.length > 0) {
      // Will be covered by contributing factors below
    }
  }

  // Contributing factors
  for (let i = 1; i < rootCauses.length; i++) {
    const rc = rootCauses[i];
    out.push(`### 🟡 Contributing: ${rc.label} (${rc.confidence}%)`);
    out.push("");
    if (rc.evidence.length > 0) {
      out.push("| Evidence | Detail |");
      out.push("|----------|--------|");
      for (const e of rc.evidence) {
        const cleaned = e.replace(/^[✅🔍🚫]\s*/, "").replace(/^[^\w]*/, "");
        out.push(`| 🔍 Detected | ${cleaned} |`);
      }
      out.push("");
    }
  }

  return out.join("\n");
}

function buildMetricsTable(report: ETLAnalysisReport): string {
  const m = report.computedMetrics;
  const out: string[] = [
    "## 📊 Key Metrics",
    "",
    "| Metric | Observed | Baseline (p95) | Assessment |",
    "|--------|----------|----------------|------------|",
  ];

  if (m.creationTimeMs != null) {
    const assess = m.creationTimeMs > 3000 ? "🔴 **Slow**" : m.creationTimeMs > 1500 ? "⚠️ **Above baseline**" : "✅ Normal";
    out.push(`| WebView2 Creation | ${formatMs(m.creationTimeMs)} | < 3,000ms | ${assess} |`);
  }
  if (m.browserToRendererStartupMs != null) {
    const assess = m.browserToRendererStartupMs > 1000 ? "🔴 **Slow**" : m.browserToRendererStartupMs > 500 ? "⚠️ **Slow**" : "✅ Normal";
    out.push(`| Browser → Renderer Startup | ${formatMs(m.browserToRendererStartupMs)} | < 500ms | ${assess} |`);
  }
  if (m.rendererLifetimeMs != null) {
    out.push(`| Renderer Lifetime | ${formatMs(m.rendererLifetimeMs)} | — | ℹ️ |`);
  }

  const rendererCount = report.processTopology.renderers.length;
  if (rendererCount > 0) {
    const assess = rendererCount > 5 ? "⚠️ **Abnormal**" : "✅ Normal";
    out.push(`| Renderer Processes | ${rendererCount} | 1-3 | ${assess} |`);
  }

  out.push(`| GPU Restarts | ${m.gpuRestartCount} | 0 | ${m.gpuRestartCount > 0 ? "⚠️ **Unstable**" : "✅ Healthy"} |`);

  if (m.dllLoadCount > 0) {
    const assess = m.dllLoadCount > 200 ? "⚠️ **High**" : "✅ Normal";
    out.push(`| DLLs Loaded | ${m.dllLoadCount} | < 50 | ${assess} |`);
  }

  if (report.networkActivity.longPendingRequests > 0) {
    out.push(`| Pending Network Requests | ${report.networkActivity.longPendingRequests} | — | ℹ️ Many requests never got responses |`);
  }

  out.push("");
  return out.join("\n");
}

function buildCollapsedProcessSummary(structure: TraceStructure): string {
  const out: string[] = [
    "## 🌲 Process Summary",
    "",
    "```",
  ];

  // Group: show host and browser prominently, collapse renderers
  const hosts = structure.processes.filter(p => p.role === "host").sort((a, b) => b.eventCount - a.eventCount);
  const browsers = structure.processes.filter(p => p.role === "browser" || p.role === "webview2");
  const renderers = structure.processes.filter(p => p.role === "renderer").sort((a, b) => b.eventCount - a.eventCount);
  const errorStr = (p: { errors: string[] }) => p.errors.length > 0 ? `, ⚠️ ${p.errors.length} errors` : "";

  for (const h of hosts) {
    out.push(`📦 ${h.name} (PID ${h.pid}) [HOST] — ${h.eventCount.toLocaleString()} events${errorStr(h)}`);
    for (const b of browsers) {
      out.push(`  └── 🌐 ${b.name} (PID ${b.pid}) [BROWSER] — ${b.eventCount.toLocaleString()} events`);
      // Show top 3 renderers, collapse rest
      const topRenderers = renderers.slice(0, 3);
      const restCount = renderers.length - 3;
      for (const r of topRenderers) {
        const note = r === topRenderers[0] ? "  (most active)" : "";
        out.push(`      ├── 📄 PID ${r.pid} [RENDERER] — ${r.eventCount.toLocaleString()} events${note}`);
      }
      if (restCount > 0) {
        const avgEvents = Math.round(renderers.slice(3).reduce((s, r) => s + r.eventCount, 0) / restCount);
        out.push(`      └── ... +${restCount} more renderers (avg ~${avgEvents} events each)`);
      }
    }
  }

  out.push("```");
  out.push("");

  // Incarnation summary
  if (structure.incarnations.length > 0) {
    out.push(`**${structure.incarnations.length} WebView2 incarnation(s)** detected:`);
    for (const inc of structure.incarnations) {
      const ts = (inc.creationTs / 1_000_000).toFixed(3);
      const status = inc.hasIssue ? `🔴 **${inc.issueHint}**` : "✅ OK";
      out.push(`- **#${inc.id}** (ts ${ts}s): ${inc.durationMs.toFixed(0)}ms duration — ${status}`);
    }
    out.push("");
  }

  // Host errors
  const hostsWithErrors = hosts.filter(h => h.errors.length > 0);
  if (hostsWithErrors.length > 0) {
    for (const h of hostsWithErrors) {
      out.push(`**Host errors** (PID ${h.pid}): \`${h.errors.slice(0, 5).join("`, `")}\``);
    }
    out.push("");
  }

  return out.join("\n");
}

function buildWarningsSection(structure: TraceStructure): string {
  const out: string[] = [
    "## ⚡ Initial Warnings",
    "",
    "| Severity | Signal |",
    "|----------|--------|",
  ];

  for (const issue of structure.issues.slice(0, 10)) {
    out.push(`| ${issue.severity} | ${issue.message}: \`${issue.evidence.slice(0, 80)}\` |`);
  }

  out.push("");
  return out.join("\n");
}

function buildConfigSnapshot(structure: TraceStructure): string {
  const c = structure.config;
  const out: string[] = [
    "## 📋 Configuration Snapshot",
    "",
    "### System & Runtime",
    "",
    "| Property | Value |",
    "|----------|-------|",
    `| Runtime Version | ${c.runtimeVersion || "—"} |`,
    `| SDK Version | ${c.sdkVersion || "—"} |`,
    `| Browser Version | ${c.browserVersion || "—"} |`,
    `| Channel | ${c.channelName || "—"} |`,
  ];

  // Extract chromium version from command line args
  const chromiumVer = c.commandLineArgs.find(a => a.includes("chromium-version="));
  if (chromiumVer) {
    const ver = chromiumVer.split("=").slice(1).join("=");
    out.push(`| Chromium Version | ${ver} |`);
  }

  // OS Build from environmentInfo
  const osInfo = c.environmentInfo.find(e => /windows/i.test(e) || /osbuild/i.test(e) || /osversion/i.test(e));
  out.push(`| OS Build | ${osInfo || "—"} |`);

  // Architecture
  const archInfo = c.environmentInfo.find(e => /architecture/i.test(e));
  if (archInfo) {
    out.push(`| ${archInfo} |`);
  }

  out.push(`| User Data Folder | ${c.userDataFolder || "—"} |`);

  out.push(`| Trace Duration | ${formatMs(structure.traceSpanMs)} (~${(structure.traceSpanMs / 60000).toFixed(1)} min) |`);
  out.push(`| Total Events | ${structure.totalEvents.toLocaleString()} (from ${structure.totalLines.toLocaleString()} lines) |`);
  out.push(`| Processes | ${structure.processes.length} |`);
  out.push("");

  // Feature flags section
  if (c.enabledFeatures.length > 0) {
    out.push("### Enabled Features");
    out.push("```");
    for (const f of c.enabledFeatures.slice(0, 30)) out.push(f);
    if (c.enabledFeatures.length > 30) out.push(`... +${c.enabledFeatures.length - 30} more`);
    out.push("```");
    out.push("");
  }
  if (c.disabledFeatures.length > 0) {
    out.push("### Disabled Features");
    out.push("```");
    for (const f of c.disabledFeatures.slice(0, 20)) out.push(f);
    if (c.disabledFeatures.length > 20) out.push(`... +${c.disabledFeatures.length - 20} more`);
    out.push("```");
    out.push("");
  }

  // WebView2-specific flags
  if (c.webview2Flags.length > 0) {
    out.push("### WebView2-Specific Flags");
    out.push("```");
    for (const f of c.webview2Flags) out.push(f);
    out.push("```");
    out.push("");
  }

  // Field trials
  if (c.fieldTrials.length > 0) {
    out.push("### Field Trials");
    out.push("```");
    for (const f of c.fieldTrials.slice(0, 15)) out.push(f);
    if (c.fieldTrials.length > 15) out.push(`... +${c.fieldTrials.length - 15} more`);
    out.push("```");
    out.push("");
  }

  // Notable command line args
  const notableArgs = c.commandLineArgs.filter(a =>
    a.includes("embedded-browser") || a.includes("device-scale") || a.includes("js-flags") ||
    a.includes("disable-gpu") || a.includes("proxy") || a.includes("user-data-dir") ||
    a.includes("no-sandbox") || a.includes("single-process") || a.includes("remote-debugging")
  ).slice(0, 10);
  if (notableArgs.length > 0) {
    out.push("### Notable Command Line Args");
    out.push("```");
    for (const a of notableArgs) out.push(a);
    out.push("```");
    out.push("");
  }

  // System / environment info
  const sysInfo = c.environmentInfo.filter(e => !/architecture/i.test(e));
  if (sysInfo.length > 0) {
    out.push("### Environment Info");
    out.push("```");
    for (const e of sysInfo.slice(0, 10)) out.push(e);
    if (sysInfo.length > 10) out.push(`... +${sysInfo.length - 10} more`);
    out.push("```");
    out.push("");
  }

  return out.join("\n");
}

function buildUserFriendlyNextSteps(
  topSuspect: string,
  isNav: boolean,
  hasCpu: boolean,
  hasTimeline: boolean,
  structure: TraceStructure | null,
): string {
  const out: string[] = [
    "## ▶️ Recommended Next Steps",
    "",
    "### For this specific issue:",
    "",
    '1. **Compare with a working trace** — Capture an ETL when the app works normally. Ask Copilot:',
    '   > *"Analyze bad trace with good trace good.etl for ' + (structure ? structure.processes.find(p => p.role === "host")?.name || "the host app" : "the host app") + '"*',
    "",
  ];

  if (isNav) {
    out.push("2. **Check event handler timing** — Verify that `add_NavigationCompleted` is called *before* `Navigate()` in the host app code.");
    out.push("");
  }

  if (!hasCpu && structure) {
    const browserPid = structure.processes.find(p => p.role === "browser" || p.role === "webview2")?.pid;
    if (browserPid) {
      out.push(`${isNav ? "3" : "2"}. **Investigate with CPU profiling** — Ask Copilot:`);
      out.push(`   > *"Re-analyze with CPU profiling for PID ${browserPid}"*`);
      out.push("");
    }
  }

  out.push("### 🧠 Share what you learned:");
  out.push("");
  out.push('- **Share learnings** — New events and timings were auto-discovered from this trace. Help improve analysis for everyone:');
  out.push('  > *"Share my learnings"*');
  out.push("");
  out.push("### For deeper analysis:");
  out.push("");

  if (!hasTimeline) {
    out.push('- **Timeline slice** around the issue window:');
    out.push('  > *"Analyze with start_time and end_time around the issue"*');
    out.push("");
  }

  out.push('- **Decode API IDs** to see which specific APIs were called:');
  out.push('  > *"Decode WebView2 API IDs 3, 5, 10"*');
  out.push("");

  return out.join("\n");
}

function buildAppendixSection(outputDir: string): string {
  return [
    "## 📎 Appendix",
    "",
    `- **Full evidence JSON**: [\`evidence_data.json\`](${join(outputDir, "evidence_data.json").replace(/\\/g, "/")}) — machine-readable structured data`,
    `- **Filtered trace data**: [\`filtered.txt\`](${join(outputDir, "filtered.txt").replace(/\\/g, "/")}) — extracted WebView2 + host app events`,
    `- **Feature flags**: [\`feature_flags.txt\`](${join(outputDir, "feature_flags.txt").replace(/\\/g, "/")}) — all browser command-line arguments`,
    "",
  ].join("\n");
}

// ─── Utility functions ──────────────────────────────────────────────

function formatMs(ms: number): string {
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)} min`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function formatMsAligned(ms: number): string {
  const str = ms >= 1000 ? `+${(ms / 1000).toFixed(1)}s` : `+${Math.round(ms)}ms`;
  return padRight(str, 14);
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s + " " : s + " ".repeat(len - s.length);
}

function describeEvent(event: string): string {
  if (event.includes("FactoryCreate")) return "Host creates WebView2 environment";
  if (event.includes("Creation_Client")) return "WebView2 creation lifecycle";
  if (event.includes("NavigationRequest::Create")) return "Browser begins navigation";
  if (event.includes("BeginNavigation")) return "Network requests start";
  if (event.includes("StartNavigation")) return "Navigation fetch begins";
  if (event.includes("CommitNavigation")) return "Document committed to renderer";
  if (event.includes("NavigationCompleted")) return "Navigation finished";
  if (event.includes("APICalled")) return "API activity";
  if (event.includes("ProcessFailure")) return "Process crashed";
  return event;
}

function inferGapReason(events: { event: string }[], currentEvent: { event: string }): string {
  if (currentEvent.event.includes("NavigationRequest")) return "browser process cold-starting";
  if (currentEvent.event.includes("Creation")) return "WebView2 environment initialization";
  return "possible contention or delay";
}

function extractTopSuspect(triageOutput: string): string {
  const match = triageOutput.match(/\*\*1\.\s+(.+?)\*\*\s*\(\d+%/);
  if (match) return match[1].trim();
  const fallback = triageOutput.match(/#1\s+(\S+)/);
  return fallback ? fallback[1] : "";
}

function isNavigationScenario(symptom: string, triageOutput: string): boolean {
  const navKeywords = [
    "navigation", "navigate", "NavigationCompleted", "NavigationStarting",
    "nav_completed", "nav_stalled", "blank_page", "stuck",
    "ContentLoading", "DOMContentLoaded", "SourceChanged",
  ];
  const combined = (symptom + " " + triageOutput).toLowerCase();
  return navKeywords.some(k => combined.includes(k.toLowerCase()));
}
