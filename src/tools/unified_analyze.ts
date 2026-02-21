/**
 * unified_analyze: Single tool that does everything.
 *
 * Phase 1 (no filtered_file): generates extraction commands.
 * Phase 2 (filtered_file provided): runs full analysis pipeline:
 *   triage → nav_playbook → evidence_pack → timeline_slice → CPU (opt-in)
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

  // ── Step 1: TRIAGE — fast root-cause scoring ──
  const triageResult = triage(filteredFile, symptom);
  sections.push(triageResult);

  // Extract the top suspect from triage output for evidence pack
  const topSuspect = extractTopSuspect(triageResult);

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

  return sections.join("\n");
}

// ─── Helpers ────────────────────────────────────────────────────────

function extractTopSuspect(triageOutput: string): string {
  // Parse "🔴 #1 <name> (confidence X.XX)" pattern from triage card
  const match = triageOutput.match(/🔴\s*#1\s+(\S+)/);
  if (match) return match[1];

  // Fallback: look for any ranked suspect
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
