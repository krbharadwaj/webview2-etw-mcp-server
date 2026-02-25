/**
 * deep_dive: Automatically identifies suspicious windows in a filtered ETL trace
 * and runs focused timeline analysis + optional CPU profiling on each.
 *
 * Detects:
 *   - Stuck incarnations (navigation started but never completed)
 *   - Large trace gaps (>2s)
 *   - Incarnations with errors/failures
 *   - Timeout/unresponsive signals → triggers CPU profiling recommendation
 *
 * No manual start_time/end_time needed — it figures them out.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { extractTraceStructure, type TraceStructure, type Incarnation } from "./trace_structure.js";
import { timelineSlice } from "./timeline_slice.js";
import { analyzeCpu } from "./analyze_cpu.js";
import { triage } from "./triage.js";

export interface DeepDiveParams {
  filteredFile: string;
  etlPath: string;
  hostApp: string;
  symptom?: string;
  autoCpu?: boolean;     // auto-trigger CPU profiling if contention detected (default: true)
  outputDir?: string;
}

interface SuspiciousWindow {
  label: string;
  reason: string;
  startUs: number;
  endUs: number;
  pid?: number;
  severity: "critical" | "warning" | "info";
  cpuRecommended: boolean;
}

export function deepDive(params: DeepDiveParams): string {
  const {
    filteredFile,
    etlPath,
    hostApp,
    symptom = "",
    autoCpu = true,
    outputDir = "C:\\temp\\etl_analysis",
  } = params;

  if (!filteredFile || !existsSync(filteredFile)) {
    return `❌ Filtered file not found: ${filteredFile}. Run analyze_etl extraction first.`;
  }

  const sections: string[] = [];

  // ── 1. Extract trace structure ──
  let structure: TraceStructure;
  try {
    structure = extractTraceStructure(filteredFile, hostApp);
  } catch (err: any) {
    return `❌ Failed to extract trace structure: ${err.message}`;
  }

  // ── 2. Identify suspicious windows ──
  const windows = identifySuspiciousWindows(structure, filteredFile);

  if (windows.length === 0) {
    return [
      "# 🔍 Deep Dive Analysis",
      "",
      "✅ **No suspicious windows detected.** The trace appears healthy.",
      "",
      "If you suspect an issue, try:",
      "- Re-running `analyze_etl` with a specific `start_time` / `end_time`",
      "- Comparing with a known-good trace using `good_etl`",
    ].join("\n");
  }

  // ── 3. Header ──
  const etlName = etlPath.split(/[/\\]/).pop() || etlPath;
  sections.push([
    "# 🔬 Deep Dive Analysis",
    "",
    `**ETL**: \`${etlName}\` | **Host App**: ${hostApp} | **Symptom**: ${symptom || "Not specified"}`,
    "",
    `Found **${windows.length} suspicious window(s)** to investigate:`,
    "",
  ].join("\n"));

  // Summary table
  sections.push("| # | Window | Severity | Reason | CPU? |");
  sections.push("|---|--------|----------|--------|------|");
  windows.forEach((w, i) => {
    const cpuFlag = w.cpuRecommended ? "🔥 Yes" : "—";
    const sevIcon = w.severity === "critical" ? "🔴" : w.severity === "warning" ? "🟡" : "🔵";
    sections.push(`| ${i + 1} | ${w.label} | ${sevIcon} ${w.severity} | ${w.reason} | ${cpuFlag} |`);
  });
  sections.push("");

  // ── 4. Analyze each window ──
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    sections.push("---\n");
    sections.push(`## 🔎 Window ${i + 1}: ${w.label}`);
    sections.push("");
    sections.push(`**Reason**: ${w.reason}`);
    sections.push(`**Time range**: ${formatUs(w.startUs)} → ${formatUs(w.endUs)} (${formatDuration(w.endUs - w.startUs)})`);
    if (w.pid) sections.push(`**Focus PID**: ${w.pid}`);
    sections.push("");

    // Run timeline slice
    const sliceResult = timelineSlice(
      filteredFile,
      w.startUs.toString(),
      w.endUs.toString(),
      w.pid?.toString()
    );
    sections.push(sliceResult);

    // CPU profiling
    if (w.cpuRecommended && autoCpu) {
      sections.push("");
      const targetPid = w.pid?.toString() || "";
      if (targetPid && existsSync(etlPath)) {
        sections.push("### 🔥 CPU Profiling");
        sections.push("");
        const cpuResult = analyzeCpu(
          etlPath,
          targetPid,
          ["msedge.dll", "msedgewebview2.dll", "ntdll", hostApp.toLowerCase()],
          w.startUs.toString(),
          w.endUs.toString(),
          undefined
        );
        sections.push(cpuResult);
      } else {
        sections.push(`> ⚠️ CPU profiling recommended for PID ${targetPid || "unknown"} but ETL not available at \`${etlPath}\`.`);
      }
    }
  }

  // ── 5. Summary & Recommendations ──
  sections.push("\n---\n");
  sections.push("## 📋 Deep Dive Summary");
  sections.push("");

  const criticalCount = windows.filter(w => w.severity === "critical").length;
  const cpuCount = windows.filter(w => w.cpuRecommended).length;

  sections.push(`- **${windows.length}** suspicious window(s) analyzed`);
  sections.push(`- **${criticalCount}** critical issue(s)`);
  if (cpuCount > 0) {
    sections.push(`- **${cpuCount}** window(s) with CPU profiling ${autoCpu ? "results" : "recommended"}`);
  }
  sections.push("");

  if (!autoCpu && cpuCount > 0) {
    sections.push("### To run CPU profiling:");
    sections.push("Re-run deep_dive with `auto_cpu=true`, or run analyze_etl with `include_cpu=true` and the relevant PID.");
    sections.push("");
  }

  sections.push("### Next Steps");
  sections.push("");
  sections.push("1. **Review the timeline slices above** — look for unexpected gaps, error bursts, or missing events");
  if (cpuCount > 0 && autoCpu) {
    sections.push("2. **Review the CPU profiling results** above to see where CPU time is spent");
  }
  sections.push(`${cpuCount > 0 && autoCpu ? "3" : "2"}. **Compare with a working trace** to confirm these windows diverge from normal behavior`);

  const fullReport = sections.join("\n");

  // Save report
  try {
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }
    const reportPath = join(outputDir, "deep_dive_report.md");
    writeFileSync(reportPath, fullReport, "utf-8");
    return fullReport + `\n\n---\n✅ Deep dive report saved to: **${reportPath}**`;
  } catch {
    return fullReport;
  }
}

// ─── Suspicious Window Detection ────────────────────────────────────

function identifySuspiciousWindows(
  structure: TraceStructure,
  filteredFile: string
): SuspiciousWindow[] {
  const windows: SuspiciousWindow[] = [];
  const paddingUs = 500_000; // 500ms padding around events

  // 1. Stuck/problematic incarnations
  for (const inc of structure.incarnations) {
    if (!inc.hasIssue) continue;

    const keyTs = inc.keyEvents.map(e => e.ts);
    const minTs = Math.min(inc.creationTs, ...keyTs);
    const maxTs = Math.max(inc.creationTs, ...keyTs);

    // Extend window by padding
    const startUs = Math.max(0, minTs - paddingUs);
    const endUs = maxTs + paddingUs;

    const isNavStuck = inc.issueHint.includes("never completed");
    const isRendererIssue = inc.issueHint.includes("unresponsive") || inc.issueHint.includes("Renderer");
    const isProcessFailure = inc.issueHint.includes("process failure");

    windows.push({
      label: `Incarnation #${inc.id} — ${inc.issueHint}`,
      reason: inc.issueHint,
      startUs,
      endUs,
      pid: inc.browserPid || inc.hostPid || undefined,
      severity: isProcessFailure ? "critical" : isNavStuck ? "critical" : "warning",
      cpuRecommended: isRendererIssue || isNavStuck,
    });
  }

  // 2. Large gaps from issues
  for (const issue of structure.issues) {
    if (!issue.message.includes("Large gap")) continue;

    // Parse gap timestamps from evidence: "Gap between events at +84ms and +17677ms"
    const gapMatch = issue.evidence.match(/\+(\d+)ms and \+(\d+)ms/);
    if (!gapMatch) continue;

    // Get base timestamp from first event in trace
    const baseTs = getFirstTimestamp(filteredFile);
    if (baseTs === null) continue;

    const gapStartMs = parseInt(gapMatch[1]);
    const gapEndMs = parseInt(gapMatch[2]);
    const gapStartUs = baseTs + gapStartMs * 1000;
    const gapEndUs = baseTs + gapEndMs * 1000;

    // Don't duplicate windows that already overlap with incarnation windows
    const overlaps = windows.some(w =>
      w.startUs <= gapEndUs && w.endUs >= gapStartUs
    );
    if (overlaps) continue;

    windows.push({
      label: `Large gap: ${gapStartMs}ms → ${gapEndMs}ms`,
      reason: issue.message,
      startUs: gapStartUs,
      endUs: gapEndUs,
      severity: "info",
      cpuRecommended: false,
    });
  }

  // 3. Timeout clusters — scan filtered file for dense timeout regions
  const timeoutWindows = findTimeoutClusters(filteredFile);
  for (const tw of timeoutWindows) {
    const overlaps = windows.some(w =>
      w.startUs <= tw.endUs && w.endUs >= tw.startUs
    );
    if (overlaps) {
      // Mark the overlapping window as CPU-recommended instead
      const overlapping = windows.find(w =>
        w.startUs <= tw.endUs && w.endUs >= tw.startUs
      );
      if (overlapping) overlapping.cpuRecommended = true;
      continue;
    }

    windows.push({
      label: `Timeout cluster (${tw.count} timeouts)`,
      reason: `${tw.count} timeout/unresponsive events in ${formatDuration(tw.endUs - tw.startUs)}`,
      startUs: tw.startUs,
      endUs: tw.endUs,
      pid: tw.pid,
      severity: "warning",
      cpuRecommended: true,
    });
  }

  // Sort by severity (critical first), then by start time
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  windows.sort((a, b) => {
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return a.startUs - b.startUs;
  });

  // Limit to top 5 most important windows
  return windows.slice(0, 5);
}

function findTimeoutClusters(
  filteredFile: string
): { startUs: number; endUs: number; count: number; pid?: number }[] {
  const lines = readFileSync(filteredFile, "utf-8").split("\n");
  const timeoutEvents: { ts: number; pid?: number }[] = [];

  for (const line of lines) {
    if (line.match(/Timeout|Unresponsive|hung|not responding/i) &&
        !line.match(/Process Name \( PID\)/i)) {
      const ts = extractTs(line);
      if (ts !== null) {
        const pidMatch = line.match(/\((\d+)\)/);
        timeoutEvents.push({ ts, pid: pidMatch ? parseInt(pidMatch[1]) : undefined });
      }
    }
  }

  if (timeoutEvents.length < 5) return [];

  // Find clusters: groups of ≥5 timeouts within 2s of each other
  timeoutEvents.sort((a, b) => a.ts - b.ts);
  const clusters: { startUs: number; endUs: number; count: number; pid?: number }[] = [];
  let clusterStart = 0;

  for (let i = 1; i < timeoutEvents.length; i++) {
    if (timeoutEvents[i].ts - timeoutEvents[i - 1].ts > 2_000_000) {
      // Gap > 2s — close current cluster
      const clusterSize = i - clusterStart;
      if (clusterSize >= 5) {
        clusters.push({
          startUs: timeoutEvents[clusterStart].ts - 500_000,
          endUs: timeoutEvents[i - 1].ts + 500_000,
          count: clusterSize,
          pid: timeoutEvents[clusterStart].pid,
        });
      }
      clusterStart = i;
    }
  }
  // Handle last cluster
  const lastClusterSize = timeoutEvents.length - clusterStart;
  if (lastClusterSize >= 5) {
    clusters.push({
      startUs: timeoutEvents[clusterStart].ts - 500_000,
      endUs: timeoutEvents[timeoutEvents.length - 1].ts + 500_000,
      count: lastClusterSize,
      pid: timeoutEvents[clusterStart].pid,
    });
  }

  return clusters;
}

// ─── Helpers ────────────────────────────────────────────────────────

function extractTs(line: string): number | null {
  const m = line.match(/,\s*(\d{5,})/);
  return m ? parseInt(m[1]) : null;
}

function getFirstTimestamp(filteredFile: string): number | null {
  const lines = readFileSync(filteredFile, "utf-8").split("\n");
  for (const line of lines) {
    const ts = extractTs(line);
    if (ts !== null) return ts;
  }
  return null;
}

function formatUs(us: number): string {
  if (us >= 1_000_000) {
    return `${(us / 1_000_000).toFixed(3)}s`;
  }
  return `${(us / 1000).toFixed(1)}ms`;
}

function formatDuration(us: number): string {
  if (us >= 1_000_000) {
    return `${(us / 1_000_000).toFixed(2)}s`;
  }
  return `${(us / 1000).toFixed(1)}ms`;
}
