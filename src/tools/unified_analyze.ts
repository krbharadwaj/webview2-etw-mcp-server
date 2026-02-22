/**
 * unified_analyze: Single tool that does everything.
 *
 * Phase 1 (no filtered_file): generates extraction commands.
 * Phase 2 (filtered_file provided): runs full analysis pipeline:
 *   config → process tree → activity → initial issues → triage → nav_playbook → evidence_pack → timeline_slice → CPU (opt-in)
 *
 * All sub-analyses are combined into one comprehensive report.
 */

import { existsSync, readFileSync } from "fs";
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

  // ── Header ──
  sections.push([
    "# 🔍 WebView2 ETL Analysis Report",
    "",
    `**ETL**: ${etlPath}`,
    `**Host App**: ${hostApp}`,
    symptom ? `**Symptom**: ${symptom}` : "",
    `**Filtered Data**: ${filteredFile}`,
    "",
  ].filter(Boolean).join("\n"));

  // ── Structured Analysis: Config → Process Tree → Activity → Incarnations → Issues ──
  let traceStructure: ReturnType<typeof extractTraceStructure> | null = null;
  try {
    const structure = extractTraceStructure(filteredFile, hostApp);
    traceStructure = structure;
    const structuredReport = formatTraceStructureReport(structure, hostApp);
    sections.push(structuredReport);
    sections.push("---\n");
  } catch (err) {
    sections.push(`> ⚠️ Structured trace analysis skipped: ${(err as Error).message}\n`);
  }

  // ── Step 1: TRIAGE — fast root-cause scoring ──
  const triageResult = triage(filteredFile, symptom);
  sections.push(triageResult);

  // Extract the top suspect from triage output for evidence pack
  const topSuspect = extractTopSuspect(triageResult);

  // ── Step 1b: PROCESS ATTRIBUTION — connect root cause to specific processes ──
  if (topSuspect && traceStructure) {
    const attribution = buildProcessAttribution(traceStructure, topSuspect, triageResult);
    if (attribution) {
      sections.push(attribution);
    }
  }

  // ── Step 1c: PROBABLE TIMELINE — focused timeline around suspected issue ──
  if (topSuspect && traceStructure) {
    const suspectTimeline = buildSuspectTimeline(traceStructure, topSuspect);
    if (suspectTimeline) {
      sections.push(suspectTimeline);
    }
  }

  // ── Step 2: NAVIGATION PLAYBOOK — if navigation-related ──
  const isNavRelated = isNavigationScenario(symptom, triageResult);
  if (isNavRelated) {
    sections.push("---\n");
    const playbook = navPlaybook(filteredFile);
    sections.push(playbook);
  }

  // ── Step 3: EVIDENCE PACK — for top suspect ──
  if (topSuspect) {
    sections.push("---\n");
    const evidence = evidencePack(filteredFile, topSuspect, symptom);
    sections.push(evidence);
  }

  // ── Step 4: TIMELINE SLICE — if timing params given ──
  if (startTime && endTime) {
    sections.push("---\n");
    const slice = timelineSlice(filteredFile, startTime, endTime, pid);
    sections.push(slice);
  }

  // ── Step 5: COMPARISON — if good ETL/filtered provided ──
  if (goodEtl || goodFiltered) {
    sections.push("---\n");
    const comparison = compareEtls(
      goodEtl || "",
      etlPath,
      hostApp,
      goodFiltered,
      filteredFile
    );
    sections.push(comparison);
  }

  // ── Step 6: CPU ANALYSIS — only if explicitly requested ──
  if (includeCpu) {
    sections.push("---\n");
    if (!pid) {
      sections.push([
        "## ⏳ CPU Analysis",
        "",
        "CPU analysis was requested but no `pid` was provided.",
        "Check the process discovery output above and re-run with the PID.",
      ].join("\n"));
    } else {
      const keywords = cpuKeywords || ["msedge.dll", "msedgewebview2.dll", "webview2", "ntdll"];
      const cpu = analyzeCpu(
        etlPath,
        pid,
        keywords,
        startTime,
        endTime,
        undefined
      );
      sections.push(cpu);
    }
  }

  // ── Footer: next actions ──
  sections.push("---\n");
  sections.push(buildNextActions(topSuspect, isNavRelated, includeCpu, !!startTime));

  // ── STRUCTURED JSON REPORT — 12-section analysis ──
  if (traceStructure) {
    try {
      const evidenceResult = topSuspect ? evidencePack(filteredFile, topSuspect, symptom) : "";
      const structuredReport = buildStructuredReport(
        filteredFile,
        etlPath,
        hostApp,
        traceStructure,
        triageResult,
        evidenceResult,
      );
      sections.push("\n---\n");
      sections.push(formatStructuredReportMarkdown(structuredReport));
    } catch (err) {
      sections.push(`\n> ⚠️ Structured JSON report skipped: ${(err as Error).message}\n`);
    }
  }

  return sections.join("\n");
}

// ─── Helpers ────────────────────────────────────────────────────────

// ─── Process Attribution & Suspect Timeline ─────────────────────────

function buildProcessAttribution(
  structure: TraceStructure,
  topSuspect: string,
  triageResult: string
): string | null {
  const out: string[] = [];
  out.push("## 🎯 Process-Level Root Cause Attribution");
  out.push("");
  out.push(`**Top Suspect**: ${topSuspect}`);
  out.push("");

  // Map suspect categories to process roles
  const suspectLower = topSuspect.toLowerCase();
  let suspectRole = "unknown";
  let suspectRationale = "";

  if (suspectLower.includes("vdi") || suspectLower.includes("dll") || suspectLower.includes("loading")) {
    suspectRole = "browser";
    suspectRationale = "DLL loading delays occur in the browser process during startup";
  } else if (suspectLower.includes("navigation") || suspectLower.includes("nav")) {
    suspectRole = "browser";
    suspectRationale = "Navigation lifecycle is managed by the browser process";
  } else if (suspectLower.includes("renderer") || suspectLower.includes("hung") || suspectLower.includes("unresponsive")) {
    suspectRole = "renderer";
    suspectRationale = "Renderer process handles DOM, JS execution, and page rendering";
  } else if (suspectLower.includes("service worker") || suspectLower.includes("sw")) {
    suspectRole = "renderer";
    suspectRationale = "Service workers run in renderer/utility processes";
  } else if (suspectLower.includes("auth") || suspectLower.includes("token") || suspectLower.includes("wam")) {
    suspectRole = "browser";
    suspectRationale = "Authentication flows are managed by the browser process";
  } else if (suspectLower.includes("crash") || suspectLower.includes("failure")) {
    suspectRole = "browser";
    suspectRationale = "Browser process crash/failure";
  } else if (suspectLower.includes("host") || suspectLower.includes("handler") || suspectLower.includes("deadlock")) {
    suspectRole = "host";
    suspectRationale = "Issue originates in the host application's event handling";
  }

  // Find processes matching the suspect role
  const suspectProcesses = structure.processes.filter(p => p.role === suspectRole || p.role === "webview2");
  const errorProcesses = structure.processes.filter(p => p.errors.length > 0).sort((a, b) => b.errors.length - a.errors.length);

  if (suspectProcesses.length > 0) {
    out.push(`**Suspect Process Role**: ${suspectRole}`);
    out.push(`**Rationale**: ${suspectRationale}`);
    out.push("");
    out.push("| Process | PID | Role | Events | Errors | Verdict |");
    out.push("|---------|-----|------|--------|--------|---------|");
    for (const p of suspectProcesses) {
      const verdict = p.errors.length > 0 ? "🔴 Likely root cause" : "🟡 Review needed";
      out.push(`| ${p.name} | ${p.pid} | ${p.role} | ${p.eventCount} | ${p.errors.length > 0 ? `⚠️ ${p.errors.length}` : "0"} | ${verdict} |`);
    }
    out.push("");
  }

  // Show processes with errors regardless of role
  if (errorProcesses.length > 0) {
    out.push("**All processes with errors (ranked by error count):**");
    out.push("");
    out.push("| Process | PID | Role | Error Count | Top Errors |");
    out.push("|---------|-----|------|-------------|------------|");
    for (const p of errorProcesses.slice(0, 8)) {
      out.push(`| ${p.name} | ${p.pid} | ${p.role} | ${p.errors.length} | ${p.errors.slice(0, 2).join("; ").slice(0, 80)} |`);
    }
    out.push("");
  }

  // Incarnation-level attribution
  if (structure.incarnations.length > 0) {
    const issueIncs = structure.incarnations.filter(i => i.hasIssue);
    if (issueIncs.length > 0) {
      out.push("**Incarnation(s) with issues:**");
      out.push("");
      for (const inc of issueIncs) {
        out.push(`- **Incarnation #${inc.id}** (ts ${inc.creationTs}, ${inc.durationMs.toFixed(0)}ms): ${inc.issueHint}`);
        out.push(`  PIDs: ${inc.associatedPids.join(", ")} | Host: ${inc.hostPid || "?"} | Browser: ${inc.browserPid || "?"}`);
      }
      out.push("");
    }
  }

  return out.join("\n");
}

function buildSuspectTimeline(
  structure: TraceStructure,
  topSuspect: string
): string | null {
  // Find the incarnation(s) with issues and build a focused timeline
  const issueIncs = structure.incarnations.filter(i => i.hasIssue);
  if (issueIncs.length === 0 && structure.incarnations.length === 0) return null;

  const targetInc = issueIncs.length > 0 ? issueIncs[0] : structure.incarnations[0];
  if (targetInc.keyEvents.length === 0) return null;

  const out: string[] = [];
  out.push("## ⏱️ Probable Timeline for Suspected Issue");
  out.push("");
  out.push(`**Focused on**: Incarnation #${targetInc.id} (${targetInc.issueHint || topSuspect})`);
  out.push(`**Duration**: ${targetInc.durationMs.toFixed(0)}ms`);
  out.push("");

  // Calculate relative timestamps from the creation event
  const baseTs = targetInc.creationTs;
  const events = targetInc.keyEvents.sort((a, b) => a.ts - b.ts);

  out.push("| Relative Time | Event | PID | Line | Phase |");
  out.push("|---------------|-------|-----|------|-------|");

  let prevTs = baseTs;
  for (const e of events.slice(0, 30)) {
    const relMs = ((e.ts - baseTs) / 1000).toFixed(1);
    const deltaMs = ((e.ts - prevTs) / 1000).toFixed(1);
    const phase = inferEventPhase(e.event);
    const deltaNote = parseFloat(deltaMs) > 1000 ? ` ⚠️ (+${deltaMs}ms gap)` : "";
    out.push(`| +${relMs}ms${deltaNote} | \`${e.event}\` | ${e.pid} | L${e.line} | ${phase} |`);
    prevTs = e.ts;
  }
  if (events.length > 30) out.push(`| ... | +${events.length - 30} more events | | | |`);
  out.push("");

  // Highlight large gaps
  const gaps: { fromEvent: string; toEvent: string; gapMs: number }[] = [];
  for (let i = 1; i < events.length; i++) {
    const gapMs = (events[i].ts - events[i - 1].ts) / 1000;
    if (gapMs > 500) {
      gaps.push({
        fromEvent: events[i - 1].event,
        toEvent: events[i].event,
        gapMs,
      });
    }
  }

  if (gaps.length > 0) {
    out.push("### ⚠️ Suspicious Gaps");
    out.push("");
    for (const g of gaps.slice(0, 5)) {
      out.push(`- **${g.gapMs.toFixed(0)}ms** gap between \`${g.fromEvent}\` → \`${g.toEvent}\``);
    }
    out.push("");
  }

  return out.join("\n");
}

function inferEventPhase(event: string): string {
  if (event.includes("Creation") || event.includes("Factory")) return "🏗️ Creation";
  if (event.includes("NavigationRequest::Create") || event.includes("NavigationStarting")) return "🚀 Nav Start";
  if (event.includes("BeginNavigation")) return "📡 Nav Begin";
  if (event.includes("CommitNavigation")) return "📝 Nav Commit";
  if (event.includes("NavigationCompleted")) return "✅ Nav Complete";
  if (event.includes("ContentLoading") || event.includes("DOMContent")) return "📄 Content Load";
  if (event.includes("APICalled")) return "📞 API Call";
  if (event.includes("ProcessFailure") || event.includes("ProcessFailed")) return "💥 Crash";
  if (event.includes("NoHandlers") || event.includes("DroppedEvent")) return "⚠️ Dropped";
  if (event.includes("Unresponsive")) return "🔒 Hung";
  return "📋 Runtime";
}

function extractTopSuspect(triageOutput: string): string {
  // Parse "**1. <label>** (XX% confidence)" pattern from triage card
  const match = triageOutput.match(/\*\*1\.\s+(.+?)\*\*\s*\(\d+%/);
  if (match) return match[1].trim();

  // Fallback: "🔴 #1 <name>"
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

function buildNextActions(
  topSuspect: string,
  isNav: boolean,
  hasCpu: boolean,
  hasTimeline: boolean
): string {
  const actions: string[] = [
    "## 💡 What You Can Do Next",
    "",
  ];

  if (!hasTimeline) {
    actions.push("- **Zoom into a time range**: Call `analyze_etl` with `start_time` and `end_time` to focus on a specific window.");
  }
  if (!hasCpu) {
    actions.push("- **CPU profiling** (if CPU contention suspected): Call `analyze_etl` with `include_cpu=true` and the `pid`.");
  }
  actions.push("- **Compare with a good trace**: Call `analyze_etl` with `good_etl` or `good_filtered` to diff against a working trace.");
  actions.push("- **Decode API IDs**: Use `decode_api_id` for any numeric IDs in WebView2_APICalled events.");
  actions.push("- **Expected events for a flow**: Use `get_expected_trace_events` to see what events should occur for a given scenario.");
  actions.push("- **Share findings**: Use `share_learnings` to push discoveries to the shared knowledge base.");

  return actions.join("\n");
}
