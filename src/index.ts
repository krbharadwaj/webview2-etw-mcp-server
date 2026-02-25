#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { decodeApiId, decodeApiIdBatch, listApisByCategory } from "./tools/decode.js";
import { unifiedAnalyze } from "./tools/unified_analyze.js";
import { deepDive } from "./tools/deep_dive.js";
import { getExpectedTraceEvents } from "./tools/expected_events.js";
import { lookupFlag, listFlagsByCategory, listAllCategories, findFlagsForScenario } from "./tools/feature_flags.js";
import { initSync, pullLatest, getSyncStatus, previewLearnings, confirmAndPush } from "./knowledge/sync.js";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { join } from "path";

const server = new McpServer({
  name: "webview2-etw-analysis",
  version: "3.0.0",
});

// ─── Tool 1: analyze_etl ───
// The ONE tool for all ETL analysis. Handles extraction, triage, playbook, evidence, timeline, CPU, comparison.
server.tool(
  "analyze_etl",
  `Unified WebView2 ETL analysis tool. Two phases:

Phase 1 (no filtered_file): Generates PowerShell extraction commands for the ETL. Run them to get filtered.txt.
Phase 2 (filtered_file provided): Runs full analysis automatically — triage → navigation playbook → evidence pack.

Optional: add start_time/end_time for timeline slice, include_cpu=true for CPU profiling, good_etl for comparison.`,
  {
    etl_path: z.string().describe("Full path to the .etl file"),
    host_app: z.string().describe("Host application name (e.g., 'Teams', 'SearchHost', 'Outlook')"),
    symptom: z.string().optional().describe("Symptom description (e.g., 'NavigationCompleted not received', 'stuck', 'blank page')"),
    filtered_file: z.string().optional().describe("Path to already-filtered ETL text file. When provided, skips extraction and runs full analysis."),
    include_cpu: z.boolean().optional().describe("Include CPU profiling in analysis (default: false). Only set true when timeline suggests CPU contention."),
    pid: z.string().optional().describe("Process ID for CPU analysis or timeline filtering"),
    cpu_keywords: z.array(z.string()).optional().describe("Keywords for CPU stack search (default: ['msedge.dll', 'msedgewebview2.dll'])"),
    start_time: z.string().optional().describe("Timeline slice start timestamp (microseconds from xperf)"),
    end_time: z.string().optional().describe("Timeline slice end timestamp"),
    good_etl: z.string().optional().describe("Path to a working/good ETL for comparison"),
    good_filtered: z.string().optional().describe("Path to filtered data from a working/good trace"),
    output_dir: z.string().optional().describe("Output directory for filtered data (default: C:\\temp\\etl_analysis)"),
  },
  async ({ etl_path, host_app, symptom, filtered_file, include_cpu, pid, cpu_keywords, start_time, end_time, good_etl, good_filtered, output_dir }) => {
    const result = unifiedAnalyze({
      etlPath: etl_path,
      hostApp: host_app,
      symptom: symptom || undefined,
      filteredFile: filtered_file || undefined,
      includeCpu: include_cpu || false,
      pid: pid || undefined,
      cpuKeywords: cpu_keywords || undefined,
      startTime: start_time || undefined,
      endTime: end_time || undefined,
      goodEtl: good_etl || undefined,
      goodFiltered: good_filtered || undefined,
      outputDir: output_dir || undefined,
    });
    return { content: [{ type: "text", text: result }] };
  }
);

// ─── Tool 2: deep_dive ───
// Automatically identifies suspicious windows and drills into them.
server.tool(
  "deep_dive",
  `Automatically identify and analyze suspicious windows in a filtered ETL trace.

No manual start_time/end_time needed — it finds stuck navigations, large gaps, timeout clusters,
and renderer failures, then runs focused timeline analysis on each. Optionally triggers CPU profiling.

Requires a filtered file from a prior analyze_etl run.`,
  {
    filtered_file: z.string().describe("Path to the filtered ETL text file from a prior analyze_etl extraction"),
    etl_path: z.string().describe("Full path to the original .etl file (needed for CPU profiling)"),
    host_app: z.string().describe("Host application name (e.g., 'Teams', 'SearchHost', 'Outlook')"),
    symptom: z.string().optional().describe("Symptom description"),
    auto_cpu: z.boolean().optional().describe("Auto-trigger CPU profiling commands for windows with contention signals (default: true)"),
    output_dir: z.string().optional().describe("Output directory for the deep dive report (default: C:\\temp\\etl_analysis)"),
  },
  async ({ filtered_file, etl_path, host_app, symptom, auto_cpu, output_dir }) => {
    const result = deepDive({
      filteredFile: filtered_file,
      etlPath: etl_path,
      hostApp: host_app,
      symptom: symptom || undefined,
      autoCpu: auto_cpu !== undefined ? auto_cpu : true,
      outputDir: output_dir || undefined,
    });
    return { content: [{ type: "text", text: result }] };
  }
);

// ─── Tool 3: decode_api_id ───
server.tool(
  "decode_api_id",
  "Decode a WebView2 API ID number to its name and category. Use when you see WebView2_APICalled events with numeric Field1 values.",
  {
    id: z.number().describe("The API ID number (0-174) from WebView2_APICalled Field1"),
    batch: z.array(z.number()).optional().describe("Optional: decode multiple IDs at once"),
    category: z.string().optional().describe("Optional: list all APIs in a category (e.g., 'Navigation', 'EventRegistration')"),
  },
  async ({ id, batch, category }) => {
    let result: string;
    if (category) {
      result = listApisByCategory(category);
    } else if (batch && batch.length > 0) {
      result = decodeApiIdBatch(batch);
    } else {
      result = decodeApiId(id);
    }
    return { content: [{ type: "text", text: result }] };
  }
);

// ─── Tool 4: get_expected_trace_events ───
server.tool(
  "get_expected_trace_events",
  `Get the expected set of ETW trace events for a specific WebView2 flow/scenario.

Returns the complete event sequence with phases, required flags, failure variants, and known issues.
Optionally checks a filtered trace file to show which expected events are present vs missing.

Supported flows: navigation, initialization, Navigate, NavigateToString, Initialize, GoBack, Reload, and more.`,
  {
    flow: z.string().describe("Flow/scenario name (e.g., 'navigation', 'initialization', 'Navigate', 'GoBack', 'creation', 'error')"),
    filtered_file: z.string().optional().describe("Optional: path to filtered ETL text file. If provided, checks which expected events are present vs missing."),
  },
  async ({ flow, filtered_file }) => {
    const result = getExpectedTraceEvents(flow, filtered_file || undefined);
    return { content: [{ type: "text", text: result }] };
  }
);

// ─── Tool 5: lookup_feature_flags ───
server.tool(
  "lookup_feature_flags",
  `Look up WebView2 feature flags (browser arguments) — their purpose, risk level, and when to use them.

Modes:
- flag_name: Look up a specific flag by name (supports partial matching)
- category: List all flags in a category (security, network, performance, display, navigation, initialization, debugging, authentication, media)
- scenario: Find flags relevant to a problem scenario (e.g., "blank page", "proxy", "GPU crash", "slow startup")
- No parameters: Show all categories with counts`,
  {
    flag_name: z.string().optional().describe("Flag name to look up (e.g., 'disable-gpu', 'RendererAppContainer', 'proxy')"),
    category: z.string().optional().describe("List flags by category (e.g., 'security', 'performance', 'network', 'display')"),
    scenario: z.string().optional().describe("Find flags helpful for a scenario (e.g., 'blank page after navigation', 'GPU crash', 'slow startup', 'proxy auth failure')"),
  },
  async ({ flag_name, category, scenario }) => {
    let result: string;
    if (flag_name) {
      result = lookupFlag(flag_name);
    } else if (category) {
      result = listFlagsByCategory(category);
    } else if (scenario) {
      result = findFlagsForScenario(scenario);
    } else {
      result = listAllCategories();
    }
    return { content: [{ type: "text", text: result }] };
  }
);

// ─── Tool 6: share_learnings ───
server.tool(
  "share_learnings",
  "Share locally-learned knowledge with all users via GitHub. Use 'preview' to see what would be shared, then 'confirm' to push. Two-step: preview → review → confirm.",
  {
    action: z.enum(["preview", "confirm"]).optional().describe("'preview' (default) shows a diff of what's new locally. 'confirm' pushes to GitHub."),
  },
  async ({ action }) => {
    const knowledgeDir = resolveKnowledgeDir();
    let result: string;
    if (action === "confirm") {
      result = await confirmAndPush(knowledgeDir);
    } else {
      const preview = await previewLearnings(knowledgeDir);
      result = preview.summary;
    }
    return { content: [{ type: "text", text: result }] };
  }
);

// ─── Helper ─────────────────────────────────────────────────────────

function resolveKnowledgeDir(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(thisDir, "knowledge"),
    join(thisDir, "..", "src", "knowledge"),
    join(thisDir, "..", "knowledge"),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "api_ids.json"))) return dir;
  }
  return join(thisDir, "knowledge");
}

// ─── Start Server ───────────────────────────────────────────────────
async function main() {
  initSync();

  try {
    const knowledgeDir = resolveKnowledgeDir();
    const syncResult = await pullLatest(knowledgeDir);
    if (syncResult) console.error(syncResult);
  } catch (err: any) {
    console.error(`[sync] Pull failed (non-critical): ${err.message}`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("WebView2 ETW Analysis MCP Server running on stdio (6 tools)");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
