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
    const extractionCmds = analyzeEtl(params.etlPath, params.hostApp, params.outputDir, params.pid);

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

  // ── Check for unresolved TraceLogging events (GUID-based names) ──
  // WebView2 uses TraceLogging (self-describing events). If the extraction tool
  // didn't decode TraceLogging metadata, event names appear as GUID/EventID(N)
  // instead of human-readable names like WebView2_APICalled.
  let hasUnresolvedEvents = false;
  try {
    const content = readFileSync(filteredFile, "utf-8");
    const sampleLines = content.split("\n").slice(0, 5000);
    const guidPattern = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/EventID\(\d+\)/i;
    const unresolvedCount = sampleLines.filter(l => guidPattern.test(l)).length;
    const webview2Count = sampleLines.filter(l => l.includes("WebView2_")).length;
    if (unresolvedCount > 10 && webview2Count === 0) {
      hasUnresolvedEvents = true;
    }
  } catch { /* ignore */ }

  if (hasUnresolvedEvents) {
    return [
      "# ⚠️ Unresolved WebView2 ETW Events",
      "",
      "The filtered trace contains **GUID-based event names** (e.g., `e34441d9/EventID(5)`) instead of",
      "human-readable names like `WebView2_APICalled`. This means the extraction tool could not decode",
      "the TraceLogging metadata embedded in the ETL.",
      "",
      "**Root cause**: The trace was likely extracted using `xperf -a dumper` on a machine without",
      "the WebView2/Edge ETW provider registered. xperf cannot decode TraceLogging metadata without",
      "provider registration.",
      "",
      "## Fix: Use the TraceEvent-based extractor",
      "",
      "The built-in TraceEvent extractor (`EtlExtract.exe`) properly decodes TraceLogging metadata",
      "from the ETL file itself — no provider registration needed.",
      "",
      "```powershell",
      "# Build the extractor (one-time)",
      "cd <mcp-server-path>/tools/etl-extract/EtlExtract",
      "dotnet publish -c Release -r win-x64 --self-contained true -o ../bin",
      "",
      "# Re-extract the trace",
      `& <mcp-server-path>/tools/etl-extract/bin/EtlExtract.exe "${etlPath}" "${hostApp}" "${outputDir}\\filtered.txt"`,
      "```",
      "",
      "Then re-run the analysis with the new filtered file.",
    ].join("\n");
  }

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
    `**ETL**: \`${etlName}\`${sizeStr} | **Host App**: ${hostApp}`,
    "",
  ].join("\n"));

  // ── 2. METADATA & CONFIGURATION ──
  if (traceStructure) {
    sections.push("---\n");
    sections.push(buildConfigSnapshot(traceStructure));
  }

  // ── 3. SYMPTOM ──
  sections.push("---\n");
  sections.push(buildSymptomSection(symptom, traceStructure, structuredReport));

  // ── 4. IMPACT ──
  sections.push("---\n");
  sections.push(buildImpactSection(topSuspect, structuredReport, traceStructure));

  // ── 5. ROOT CAUSE HYPOTHESIS ──
  // Includes: incarnation PID groups, trace path vs expected path, annotated timeline
  sections.push("---\n");
  sections.push(buildRootCauseHypothesisSection(
    rootCauses, structuredReport, traceStructure, filteredFile, topSuspect, isNavRelated
  ));

  // ── 6. EVIDENCE ──
  sections.push("---\n");
  sections.push(buildEvidenceSection(structuredReport, traceStructure));

  // ── 7. CONFIDENCE LEVEL ──
  sections.push("---\n");
  sections.push(buildConfidenceLevelSection(rootCauses, structuredReport));

  // ── 8. DEEP DIVE WITH CPU TRACES ──
  sections.push("---\n");
  sections.push(buildCpuDeepDiveSection(
    includeCpu, etlPath, pid, cpuKeywords, startTime, endTime, traceStructure
  ));

  // ── 9. NEXT ACTION ──
  sections.push("---\n");
  sections.push(buildNextActionSection(topSuspect, isNavRelated, includeCpu, !!startTime, traceStructure));

  // ── 10. OPEN QUESTIONS ──
  sections.push("---\n");
  sections.push(buildOpenQuestionsSection(rootCauses, structuredReport, traceStructure, includeCpu, goodEtl));

  // ── OPTIONAL: Timeline slice, comparison ──
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

  // ── APPENDIX ──
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

// ─── New Report Section Builders ────────────────────────────────────

function buildSymptomSection(
  symptom: string,
  structure: TraceStructure | null,
  report: ETLAnalysisReport | null,
): string {
  const out: string[] = [
    "## 🎯 Symptom",
    "",
  ];

  if (symptom) {
    out.push(`**Reported**: ${symptom}`);
  } else {
    out.push("**Reported**: Not specified by user");
  }
  out.push("");

  // Add observed symptoms from trace analysis
  const observed: string[] = [];
  if (report?.failureSignals?.rendererCrashDuringNavigation) observed.push("Renderer crashed during navigation");
  if (report?.failureSignals?.navigationCommitWithoutComplete) observed.push("Navigation committed but never completed");
  if (report?.failureSignals?.browserProcessFailure) observed.push("Browser process terminated unexpectedly");
  if (report?.failureSignals?.rendererStartupSlow) observed.push("Renderer startup was abnormally slow");
  if (report?.failureSignals?.creationFailure) observed.push("WebView2 creation failed");
  if (report?.failureSignals?.serviceWorkerTimeout) observed.push("Service worker timed out");
  if (report?.failureSignals?.authenticationFailure) observed.push("Authentication failure detected");
  if (report?.failureSignals?.gpuCrash) observed.push("GPU process crashed");
  if (report?.failureSignals?.networkStallDetected) observed.push("Network stall detected");

  if (structure) {
    const issueIncs = structure.incarnations.filter(i => i.hasIssue);
    for (const inc of issueIncs) {
      if (inc.issueHint && !observed.some(o => o.includes(inc.issueHint.substring(0, 20)))) {
        observed.push(inc.issueHint);
      }
    }
  }

  if (observed.length > 0) {
    out.push("**Observed from trace**:");
    for (const o of observed) {
      out.push(`- ${o}`);
    }
    out.push("");
  }

  return out.join("\n");
}

function buildImpactSection(
  topSuspect: string,
  report: ETLAnalysisReport | null,
  structure: TraceStructure | null,
): string {
  const out: string[] = [
    "## 💥 Impact",
    "",
  ];

  const suspect = topSuspect.toLowerCase();

  if (suspect.includes("navigation") && suspect.includes("completed")) {
    out.push("The host app was never notified that navigation finished. If it waits on this event before showing content, the result is a **blank but responsive UI**.");
    out.push("");
    out.push("**User-facing**: The end user sees a blank page or loading indicator that never resolves, even though the underlying browser process is running normally.");
  } else if (suspect.includes("navigation")) {
    out.push("Navigation did not complete as expected. The page content may not have loaded properly.");
    out.push("");
    out.push("**User-facing**: The end user may see a blank page, partial content, or an error page.");
  } else if (suspect.includes("auth") || suspect.includes("token")) {
    out.push("Authentication failures prevent secure content from loading.");
    out.push("");
    out.push("**User-facing**: Login prompts may fail, pages requiring auth may show errors, or SSO may be broken.");
  } else if (suspect.includes("renderer") || suspect.includes("crash")) {
    out.push("Renderer instability means the page cannot render reliably.");
    out.push("");
    out.push("**User-facing**: Content may flash, go blank, or show an error page unexpectedly.");
  } else if (suspect.includes("service worker")) {
    out.push("Service worker delays prevent content from appearing promptly.");
    out.push("");
    out.push("**User-facing**: Prolonged blank page before content finally appears, or stale cached content displayed.");
  } else if (suspect.includes("creation") || suspect.includes("initialization")) {
    out.push("WebView2 environment failed to initialize.");
    out.push("");
    out.push("**User-facing**: The application window shows no web content at all — the WebView2 control never appeared.");
  } else {
    out.push("The host application may be in an unexpected state due to the detected issue.");
    out.push("");
    out.push("**User-facing**: Application behavior is degraded or functionality is broken.");
  }

  // Add scope info
  if (structure) {
    const issueCount = structure.incarnations.filter(i => i.hasIssue).length;
    const totalCount = structure.incarnations.length;
    if (totalCount > 0) {
      out.push("");
      out.push(`**Scope**: ${issueCount} of ${totalCount} WebView2 incarnation(s) affected.`);
    }
  }

  out.push("");
  return out.join("\n");
}

function buildRootCauseHypothesisSection(
  rootCauses: ParsedRootCause[],
  report: ETLAnalysisReport | null,
  structure: TraceStructure | null,
  filteredFile: string,
  topSuspect: string,
  isNavRelated: boolean,
): string {
  const out: string[] = [
    "## 🧠 Root Cause Hypothesis",
    "",
  ];

  // Primary hypothesis
  if (rootCauses.length > 0) {
    const primary = rootCauses[0];
    out.push(`### Primary: ${primary.label}`);
    out.push("");
    out.push(`**Stage**: ${primary.stage} | **Category**: ${primary.category}`);
    out.push("");
  } else {
    out.push("### Primary: Undetermined");
    out.push("");
    out.push("Insufficient evidence to form a root cause hypothesis.");
    out.push("");
  }

  // ── Process Incarnation Map (PID groups) ──
  if (structure && structure.incarnations.length > 0) {
    out.push("### 🔄 Process Incarnation Map");
    out.push("");
    for (const inc of structure.incarnations) {
      const status = inc.hasIssue ? `🔴 **${inc.issueHint}**` : "✅ OK";
      out.push(`#### Incarnation #${inc.id} — ${status} (${formatMs(inc.durationMs)})`);
      out.push("");
      out.push("| Role | PID | Events | Errors |");
      out.push("|------|-----|--------|--------|");

      // Group processes by role
      const hostProc = inc.processes.find(p => p.role === "host");
      const browserProc = inc.processes.find(p => p.role === "browser" || p.role === "webview2");
      const renderers = inc.processes.filter(p => p.role === "renderer");
      const gpuProc = inc.processes.find(p => p.role === "gpu");
      const utilities = inc.processes.filter(p => p.role === "utility");
      const others = inc.processes.filter(p =>
        !["host", "browser", "webview2", "renderer", "gpu", "utility"].includes(p.role)
      );

      if (hostProc) {
        out.push(`| 📦 Host | ${hostProc.pid} | ${hostProc.eventCount} | ${hostProc.errors.length > 0 ? hostProc.errors.slice(0, 2).join(", ") : "—"} |`);
      }
      if (browserProc) {
        out.push(`| 🌐 Browser | ${browserProc.pid} | ${browserProc.eventCount} | ${browserProc.errors.length > 0 ? browserProc.errors.slice(0, 2).join(", ") : "—"} |`);
      }
      for (const r of renderers.slice(0, 5)) {
        out.push(`| 📄 Renderer | ${r.pid} | ${r.eventCount} | ${r.errors.length > 0 ? r.errors.slice(0, 2).join(", ") : "—"} |`);
      }
      if (renderers.length > 5) {
        out.push(`| 📄 Renderer | +${renderers.length - 5} more | — | — |`);
      }
      if (gpuProc) {
        out.push(`| 🎮 GPU | ${gpuProc.pid} | ${gpuProc.eventCount} | ${gpuProc.errors.length > 0 ? gpuProc.errors.slice(0, 2).join(", ") : "—"} |`);
      }
      for (const u of utilities.slice(0, 3)) {
        out.push(`| ⚙️ Utility | ${u.pid} | ${u.eventCount} | — |`);
      }
      out.push("");
    }
  }

  // ── Trace Path vs Expected Path ──
  if (isNavRelated) {
    out.push("### 🧭 Trace Path vs Expected Path");
    out.push("");
    out.push(buildSequenceVisualization(filteredFile, report));
    out.push("");
  }

  // ── Annotated Timeline ──
  if (structure) {
    const timeline = buildAnnotatedTimeline(structure, topSuspect);
    if (timeline) {
      out.push("### ⏱️ Annotated Timeline");
      out.push("");
      out.push(timeline);
    }
  }

  // ── Contributing Factors ──
  if (rootCauses.length > 1) {
    out.push("### 🟡 Contributing Factors");
    out.push("");
    for (let i = 1; i < rootCauses.length; i++) {
      const rc = rootCauses[i];
      out.push(`**${i}. ${rc.label}** (${rc.confidence}% — ${rc.stage})`);
      if (rc.evidence.length > 0) {
        for (const e of rc.evidence.slice(0, 3)) {
          out.push(`   - ${e.replace(/^[✅🔍🚫]\s*/, "")}`);
        }
      }
      out.push("");
    }
  }

  // ── Additional analysis signals ──
  if (structure && structure.issues.length > 0) {
    out.push("### ⚡ Additional Signals");
    out.push("");
    out.push("| Severity | Signal |");
    out.push("|----------|--------|");
    for (const issue of structure.issues.slice(0, 10)) {
      out.push(`| ${issue.severity} | ${issue.message}: \`${issue.evidence.slice(0, 80)}\` |`);
    }
    out.push("");
  }

  return out.join("\n");
}

function buildEvidenceSection(
  report: ETLAnalysisReport | null,
  structure: TraceStructure | null,
): string {
  const out: string[] = [
    "## 📊 Evidence",
    "",
  ];

  // Key metrics
  if (report) {
    const m = report.computedMetrics;
    out.push("### Key Metrics");
    out.push("");
    out.push("| Metric | Observed | Baseline (p95) | Assessment |");
    out.push("|--------|----------|----------------|------------|");

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

    // Root cause evidence details
    if (report.rootCauseAnalysis?.primary) {
      const rcaPrimary = report.rootCauseAnalysis.primary;
      out.push("### Root Cause Evidence");
      out.push("");
      out.push("| Signal | Detail |");
      out.push("|--------|--------|");
      out.push(`| Type | ${rcaPrimary.type} |`);
      out.push(`| Stage | ${rcaPrimary.stage} |`);
      out.push(`| Confidence | ${rcaPrimary.confidence}% |`);
      out.push("");
    }

    // DLL injection evidence
    if (report.injectionAndEnvironment.thirdPartyDllsDetected.length > 0 || report.injectionAndEnvironment.suspectedVDIEnvironment) {
      out.push("### Environment Evidence");
      out.push("");
      if (report.injectionAndEnvironment.suspectedVDIEnvironment) {
        out.push("⚠️ **VDI environment detected** — indicators: " +
          report.injectionAndEnvironment.vdiIndicators.slice(0, 3).join(", "));
        out.push("");
      }
      if (report.injectionAndEnvironment.thirdPartyDllsDetected.length > 0) {
        out.push(`**Third-party DLLs injected** (${report.injectionAndEnvironment.thirdPartyDllsDetected.length}):`);
        for (const dll of report.injectionAndEnvironment.thirdPartyDllsDetected.slice(0, 5)) {
          out.push(`- \`${dll}\``);
        }
        out.push("");
      }
    }
  }

  return out.join("\n");
}

function buildConfidenceLevelSection(
  rootCauses: ParsedRootCause[],
  report: ETLAnalysisReport | null,
): string {
  const out: string[] = [
    "## 🎲 Confidence Level",
    "",
  ];

  if (rootCauses.length === 0) {
    out.push("**Level**: ❓ **Low** — Insufficient data to form a hypothesis.");
    out.push("");
    out.push("**Reasoning**: No clear root cause pattern was identified in the trace data.");
    out.push("");
    return out.join("\n");
  }

  const primary = rootCauses[0];
  const confPct = primary.confidence;
  let confLabel = "Low";
  let confIcon = "🟡";
  if (confPct >= 80) { confLabel = "High"; confIcon = "🟢"; }
  else if (confPct >= 60) { confLabel = "Moderate-High"; confIcon = "🟢"; }
  else if (confPct >= 40) { confLabel = "Moderate"; confIcon = "🟡"; }
  else { confLabel = "Low"; confIcon = "🔴"; }

  out.push(`**Level**: ${confIcon} **${confLabel}** (${confPct}%)`);
  out.push("");

  // Evidence strength breakdown
  out.push("**Supporting signals**:");
  if (primary.evidence.length > 0) {
    for (const e of primary.evidence) {
      const cleaned = e.replace(/^[✅🔍🚫]\s*/, "").replace(/^[^\w]*/, "");
      const icon = e.startsWith("✅") ? "✅" : e.startsWith("🚫") ? "🚫" : "🔍";
      out.push(`- ${icon} ${cleaned}`);
    }
  }
  out.push("");

  // Weakening signals
  if (primary.missing.length > 0) {
    out.push("**Weakening signals**:");
    for (const m of primary.missing) {
      out.push(`- ⚠️ ${m.replace(/^⚠️\s*/, "")}`);
    }
    out.push("");
  }

  // Confidence model from structured report
  if (report?.confidenceModel) {
    const cm = report.confidenceModel;
    out.push("**Scoring breakdown**:");
    out.push(`- Signal agreement: ${cm.signalAgreementScore ?? "—"}`);
    out.push(`- Temporal correlation: ${cm.temporalCorrelationScore ?? "—"}`);
    out.push(`- Noise level: ${cm.noiseLevelScore ?? "—"}`);
    out.push(`- Final confidence: ${cm.finalConfidence ?? "—"}%`);
    out.push("");
  }

  return out.join("\n");
}

function buildCpuDeepDiveSection(
  includeCpu: boolean,
  etlPath: string,
  pid: string | undefined,
  cpuKeywords: string[] | undefined,
  startTime: string | undefined,
  endTime: string | undefined,
  structure: TraceStructure | null,
): string {
  const out: string[] = [
    "## ⚡ Deep Dive: CPU Traces for Suspicious Timing",
    "",
  ];

  if (includeCpu && pid) {
    const keywords = cpuKeywords || ["msedge.dll", "msedgewebview2.dll", "webview2", "ntdll"];
    const cpuResult = analyzeCpu(etlPath, pid, keywords, startTime, endTime, undefined);
    out.push(cpuResult);
  } else if (includeCpu && !pid) {
    out.push("CPU analysis requested but no `pid` provided.");
    out.push("");
    if (structure) {
      const browserPid = structure.processes.find(p => p.role === "browser" || p.role === "webview2")?.pid;
      if (browserPid) {
        out.push(`Recommended PID: **${browserPid}** (browser process). Re-run with \`pid=${browserPid}\`.`);
      }
    }
  } else {
    // CPU not requested — show guidance for suspicious timing
    out.push("CPU profiling was not requested for this analysis.");
    out.push("");

    // Identify suspicious gaps that would benefit from CPU analysis
    if (structure) {
      const suspiciousGaps: { incarnation: number; fromEvent: string; toEvent: string; gapMs: number; pid: number }[] = [];
      for (const inc of structure.incarnations) {
        const events = inc.keyEvents.sort((a, b) => a.ts - b.ts);
        for (let i = 1; i < events.length; i++) {
          const gapMs = (events[i].ts - events[i - 1].ts) / 1000;
          if (gapMs > 500) {
            suspiciousGaps.push({
              incarnation: inc.id,
              fromEvent: events[i - 1].event,
              toEvent: events[i].event,
              gapMs,
              pid: events[i].pid,
            });
          }
        }
      }

      if (suspiciousGaps.length > 0) {
        out.push("### Suspicious Timing Gaps (candidates for CPU deep dive)");
        out.push("");
        out.push("| Gap | Between | PID | Recommended Action |");
        out.push("|-----|---------|-----|--------------------|");
        for (const g of suspiciousGaps.slice(0, 5)) {
          const action = `Re-run with \`pid=${g.pid}, include_cpu=true\``;
          out.push(`| ${formatMs(g.gapMs)} | \`${g.fromEvent.slice(0, 30)}\` → \`${g.toEvent.slice(0, 30)}\` | ${g.pid} | ${action} |`);
        }
        out.push("");
      } else {
        out.push("No suspicious timing gaps detected. CPU profiling may not be needed for this trace.");
      }
    }
  }

  out.push("");
  return out.join("\n");
}

function buildNextActionSection(
  topSuspect: string,
  isNav: boolean,
  hasCpu: boolean,
  hasTimeline: boolean,
  structure: TraceStructure | null,
): string {
  const out: string[] = [
    "## ▶️ Next Action",
    "",
    "### Immediate Steps",
    "",
  ];

  let step = 1;

  out.push(`${step}. **Compare with a working trace** — Capture an ETL when the app works normally:`);
  out.push(`   > *"Analyze bad trace with good trace good.etl for ${structure ? structure.processes.find(p => p.role === "host")?.name || "the host app" : "the host app"}"*`);
  out.push("");
  step++;

  if (isNav) {
    out.push(`${step}. **Check event handler timing** — Verify that \`add_NavigationCompleted\` is called *before* \`Navigate()\` in the host app code.`);
    out.push("");
    step++;
  }

  if (topSuspect.toLowerCase().includes("auth")) {
    out.push(`${step}. **Verify auth configuration** — Check WAM/TokenBroker setup and network connectivity to identity providers.`);
    out.push("");
    step++;
  }

  if (topSuspect.toLowerCase().includes("crash") || topSuspect.toLowerCase().includes("renderer")) {
    out.push(`${step}. **Check crash dumps** — Look in the WebView2 user data folder for crash dump files.`);
    out.push("");
    step++;
  }

  if (!hasCpu && structure) {
    const browserPid = structure.processes.find(p => p.role === "browser" || p.role === "webview2")?.pid;
    if (browserPid) {
      out.push(`${step}. **Run CPU profiling** for deeper analysis:`);
      out.push(`   > *"Re-analyze with CPU profiling for PID ${browserPid}"*`);
      out.push("");
      step++;
    }
  }

  out.push("### For Deeper Analysis");
  out.push("");

  if (!hasTimeline) {
    out.push('- **Timeline slice** around the issue window:');
    out.push('  > *"Analyze with start_time and end_time around the issue"*');
    out.push("");
  }

  out.push('- **Decode API IDs** to see which specific APIs were called:');
  out.push('  > *"Decode WebView2 API IDs 3, 5, 10"*');
  out.push("");

  out.push("### Share Your Findings");
  out.push("");
  out.push('- **Share learnings** — Help improve analysis for everyone:');
  out.push('  > *"Share my learnings"*');
  out.push("");

  return out.join("\n");
}

function buildOpenQuestionsSection(
  rootCauses: ParsedRootCause[],
  report: ETLAnalysisReport | null,
  structure: TraceStructure | null,
  hasCpu: boolean,
  goodEtl: string | undefined,
): string {
  const out: string[] = [
    "## ❓ Open Questions",
    "",
  ];

  const questions: string[] = [];

  // Missing confidence
  if (rootCauses.length > 0 && rootCauses[0].confidence < 70) {
    questions.push("Root cause confidence is below 70% — additional traces or logs may be needed to confirm the hypothesis.");
  }

  // Missing signals
  if (rootCauses.length > 0 && rootCauses[0].missing.length > 0) {
    for (const m of rootCauses[0].missing) {
      const cleaned = m.replace(/^⚠️\s*/, "");
      questions.push(`Expected signal not found: ${cleaned} — Was the trace started early enough to capture this event?`);
    }
  }

  // No comparison trace
  if (!goodEtl) {
    questions.push("No working trace was provided for comparison. Is this behavior consistently reproducible, or intermittent?");
  }

  // No CPU data
  if (!hasCpu) {
    questions.push("CPU profiling was not included. Are there performance or timeout symptoms that would benefit from CPU analysis?");
  }

  // Multiple incarnations
  if (structure && structure.incarnations.length > 1) {
    const issueCount = structure.incarnations.filter(i => i.hasIssue).length;
    if (issueCount < structure.incarnations.length) {
      questions.push(`Only ${issueCount} of ${structure.incarnations.length} incarnations showed issues. What differs between the working and failing incarnations?`);
    }
  }

  // VDI/injection
  if (report?.injectionAndEnvironment?.suspectedVDIEnvironment) {
    questions.push("VDI environment detected. Does the same issue reproduce on a non-VDI machine?");
  }

  // DLL injection
  if (report?.injectionAndEnvironment?.thirdPartyDllsDetected && report.injectionAndEnvironment.thirdPartyDllsDetected.length > 0) {
    questions.push("Third-party DLLs were injected into WebView2 processes. Can these be temporarily disabled to test if they are contributing to the issue?");
  }

  // Auth failures
  if (report?.failureSignals?.authenticationFailure) {
    questions.push("Authentication failure detected. Is the user account properly configured and are identity provider endpoints reachable?");
  }

  // Short trace
  if (structure && structure.traceSpanMs < 1000) {
    questions.push("The trace is very short (<1s). Was the capture stopped too early, before the issue fully manifested?");
  }

  if (questions.length === 0) {
    questions.push("No major open questions identified. The analysis appears comprehensive for the available data.");
  }

  for (let i = 0; i < questions.length; i++) {
    out.push(`${i + 1}. ${questions[i]}`);
  }
  out.push("");

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
    `**Incarnation #${targetInc.id}** — ${targetInc.issueHint || "key events"}`,
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

function buildConfigSnapshot(structure: TraceStructure): string {
  const c = structure.config;
  const out: string[] = [
    "## 📋 Metadata & Configuration",
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
