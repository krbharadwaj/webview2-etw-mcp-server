#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { decodeApiId, decodeApiIdBatch, listApisByCategory } from "./tools/decode.js";
import { lookupEvent, listEventsByCategory } from "./tools/lookup.js";
import { diagnose, listRootCauses } from "./tools/diagnose.js";
import { contributeEvent, contributeRootCause, contributeTiming } from "./tools/contribute.js";
import { analyzeEtl, generateFilterCommand } from "./tools/analyze.js";
import { compareIncarnations } from "./tools/compare.js";
import { compareEtls } from "./tools/compare_etls.js";
import { analyzeCpu } from "./tools/analyze_cpu.js";
import { timelineSlice } from "./tools/timeline_slice.js";
import { validateTrace } from "./tools/validate_trace.js";
import { triage } from "./tools/triage.js";
import { evidencePack } from "./tools/evidence_pack.js";
import { navPlaybook } from "./tools/nav_playbook.js";
import { rcaFeedback } from "./tools/rca_feedback.js";
import { initSync, pullLatest, pushLearnings, getSyncStatus, previewLearnings, confirmAndPush } from "./knowledge/sync.js";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { join } from "path";

const server = new McpServer({
  name: "webview2-etw-analysis",
  version: "1.0.0",
});

// ─── Tool: decode_api_id ───
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

// ─── Tool: lookup_event ───
server.tool(
  "lookup_event",
  "Look up a WebView2 ETW event by name. Returns description, parameters, severity, related events. Supports partial matching.",
  {
    event_name: z.string().describe("Event name to look up (e.g., 'WebView2_FactoryCreate', 'Creation_Client', 'NavigationContext')"),
    category: z.string().optional().describe("Optional: list all events in a category (e.g., 'Factory & Creation', 'Navigation', 'Error')"),
  },
  async ({ event_name, category }) => {
    const result = category ? listEventsByCategory(category) : lookupEvent(event_name);
    return { content: [{ type: "text", text: result }] };
  }
);

// ─── Tool: diagnose ───
server.tool(
  "diagnose",
  "Get a diagnosis decision tree for a WebView2 symptom. Returns step-by-step investigation commands, known root causes, and recommended next actions.",
  {
    symptom: z.string().describe("Symptom to diagnose: 'stuck', 'crash', 'slow_init', 'slow_navigation', 'auth_failure', 'blank_page', 'event_missing'"),
    list_root_causes: z.boolean().optional().describe("Set to true to list all known root causes in the knowledge base"),
  },
  async ({ symptom, list_root_causes }) => {
    const result = list_root_causes ? listRootCauses() : diagnose(symptom);
    return { content: [{ type: "text", text: result }] };
  }
);

// ─── Tool: analyze_etl ───
server.tool(
  "analyze_etl",
  "Generate analysis commands for a WebView2 ETL trace file. Returns copy-paste PowerShell commands for extraction, process discovery, and timeline building.",
  {
    etl_path: z.string().describe("Full path to the .etl file"),
    host_app: z.string().describe("Host application name (e.g., 'SearchHost', 'Teams', 'Outlook')"),
    output_dir: z.string().optional().describe("Output directory for filtered data (default: C:\\temp\\etl_analysis)"),
    additional_patterns: z.array(z.string()).optional().describe("Additional grep patterns to include in the filter"),
  },
  async ({ etl_path, host_app, output_dir, additional_patterns }) => {
    let result: string;
    if (additional_patterns && additional_patterns.length > 0) {
      result = generateFilterCommand(etl_path, host_app, additional_patterns);
    } else {
      result = analyzeEtl(etl_path, host_app, output_dir);
    }
    return { content: [{ type: "text", text: result }] };
  }
);

// ─── Tool: compare_incarnations ───
server.tool(
  "compare_incarnations",
  "Compare SUCCESS vs FAILURE WebView2 incarnations side-by-side. Identifies the first divergence point. Provide event lines from filtered ETL dumps for both incarnations.",
  {
    success_events: z.string().describe("Event lines from the SUCCESS incarnation (from filtered ETL dump)"),
    failure_events: z.string().describe("Event lines from the FAILURE incarnation (from filtered ETL dump)"),
  },
  async ({ success_events, failure_events }) => {
    const result = compareIncarnations(success_events, failure_events);
    return { content: [{ type: "text", text: result }] };
  }
);

// ─── Tool: contribute_event ───
server.tool(
  "contribute_event",
  "Add a new event or update an existing event in the knowledge base. Use after discovering an undocumented WebView2 ETW event.",
  {
    event_name: z.string().describe("Event name (e.g., 'WebView2_NewFeatureEvent')"),
    description: z.string().describe("What this event means"),
    category: z.string().optional().describe("Category (e.g., 'Navigation', 'Factory & Creation', 'Error')"),
    severity: z.string().optional().describe("Severity: 'Critical', 'Error', 'Warning', 'Info', 'Debug'"),
    params: z.array(z.object({
      index: z.number(),
      name: z.string(),
      type: z.string(),
      description: z.string(),
    })).optional().describe("Event parameters with field index, name, type, and description"),
    related_events: z.array(z.string()).optional().describe("Names of related events"),
    source_file: z.string().optional().describe("Source code file where this event is defined"),
    contributor: z.string().optional().describe("Your email for attribution"),
  },
  async ({ event_name, description, category, severity, params, related_events, source_file, contributor }) => {
    const result = contributeEvent({
      eventName: event_name,
      description,
      category,
      severity,
      params,
      relatedEvents: related_events,
      sourceFile: source_file,
      contributor,
    });
    return { content: [{ type: "text", text: result }] };
  }
);

// ─── Tool: contribute_root_cause ───
server.tool(
  "contribute_root_cause",
  "Add a new root cause to the knowledge base. Use after completing an ETL analysis that reveals a new failure pattern.",
  {
    key: z.string().describe("Unique key for this root cause (e.g., 'service_worker_timeout')"),
    symptom: z.string().describe("User-visible symptom"),
    root_cause: z.string().describe("Technical root cause explanation"),
    evidence: z.array(z.string()).describe("Evidence items that confirm this root cause"),
    classification: z.string().describe("Classification (e.g., 'Race Condition', 'Performance', 'Authentication Failure')"),
    resolution: z.array(z.string()).describe("Possible resolutions"),
    code_references: z.array(z.string()).optional().describe("Source code file references"),
    discovered_from: z.string().optional().describe("ETL file this was discovered from"),
    discovered_by: z.string().optional().describe("Your email for attribution"),
  },
  async ({ key, symptom, root_cause, evidence, classification, resolution, code_references, discovered_from, discovered_by }) => {
    const result = contributeRootCause({
      key,
      symptom,
      rootCause: root_cause,
      evidence,
      classification,
      resolution,
      codeReferences: code_references,
      discoveredFrom: discovered_from,
      discoveredBy: discovered_by,
    });
    return { content: [{ type: "text", text: result }] };
  }
);

// ─── Tool: contribute_timing ───
server.tool(
  "contribute_timing",
  "Update timing baselines with a new observation. Baselines improve with each analysis, helping detect anomalies.",
  {
    key: z.string().describe("Timing baseline key (e.g., 'about_blank_navigation', 'creation_client_cold_start')"),
    observed_ms: z.number().describe("Observed duration in milliseconds"),
    notes: z.string().optional().describe("Additional context about this observation"),
  },
  async ({ key, observed_ms, notes }) => {
    const result = contributeTiming({ key, observedMs: observed_ms, notes });
    return { content: [{ type: "text", text: result }] };
  }
);

// ─── Tool: compare_etls ───
server.tool(
  "compare_etls",
  "Compare two ETL trace files (SUCCESS vs FAILURE) side-by-side. In setup mode, generates extraction commands for both ETLs. In compare mode (when filtered files exist), analyzes event differences, missing events, timing gaps, and errors unique to failure.",
  {
    success_etl: z.string().describe("Path to the SUCCESS/working ETL file"),
    failure_etl: z.string().describe("Path to the FAILURE/broken ETL file"),
    host_app: z.string().describe("Host application name (e.g., 'Teams', 'SearchHost', 'Outlook')"),
    success_filtered: z.string().optional().describe("Path to already-filtered SUCCESS data (skip extraction if provided)"),
    failure_filtered: z.string().optional().describe("Path to already-filtered FAILURE data (skip extraction if provided)"),
  },
  async ({ success_etl, failure_etl, host_app, success_filtered, failure_filtered }) => {
    const result = compareEtls(success_etl, failure_etl, host_app, success_filtered, failure_filtered);
    return { content: [{ type: "text", text: result }] };
  }
);

// ─── Tool: analyze_cpu ───
server.tool(
  "analyze_cpu",
  "Analyze CPU traces for specific keywords using symbol servers. Generates symbolized CPU extraction commands, or parses already-extracted symbolized data to show CPU time per keyword, top functions, and module breakdown. Use SEPARATELY from analyze_etl — this is for CPU profiling only.",
  {
    etl_path: z.string().describe("Path to the ETL file"),
    pid: z.string().describe("Process ID to analyze CPU for"),
    keywords: z.array(z.string()).describe("Keywords to search in CPU stacks (e.g., ['msedge.dll', 'ntdll', 'webview2'])"),
    range_start_us: z.string().optional().describe("Time range start in microseconds (from xperf timestamp)"),
    range_end_us: z.string().optional().describe("Time range end in microseconds"),
    symbolized_file: z.string().optional().describe("Path to already-extracted symbolized CPU data (skip extraction if provided)"),
  },
  async ({ etl_path, pid, keywords, range_start_us, range_end_us, symbolized_file }) => {
    const result = analyzeCpu(etl_path, pid, keywords, range_start_us, range_end_us, symbolized_file);
    return { content: [{ type: "text", text: result }] };
  }
);

// ─── Tool: timeline_slice ───
server.tool(
  "timeline_slice",
  "Show what happened between two timestamps in a filtered ETL dump. Breaks down events by category, active processes, errors, and silent gaps. Use to understand 'what was going on during this time window?'",
  {
    filtered_file: z.string().describe("Path to the filtered ETL text file (from analyze_etl extraction)"),
    start_timestamp: z.string().describe("Start timestamp (microseconds from xperf, or seconds with decimal)"),
    end_timestamp: z.string().describe("End timestamp (microseconds from xperf, or seconds with decimal)"),
    pid: z.string().optional().describe("Optional PID to filter events to a single process"),
  },
  async ({ filtered_file, start_timestamp, end_timestamp, pid }) => {
    const result = timelineSlice(filtered_file, start_timestamp, end_timestamp, pid);
    return { content: [{ type: "text", text: result }] };
  }
);

// ─── Tool: validate_trace ───
server.tool(
  "validate_trace",
  "Validate a filtered ETL trace against known API happy-path sequences. Identifies missing events, wrong ordering, and deviations. Use 'learn_good' mode on successful traces to auto-mine new API→event sequences. Use 'learn_bad' on failure traces to capture failure patterns.",
  {
    filtered_file: z.string().describe("Path to the filtered ETL text file (from analyze_etl extraction)"),
    mode: z.enum(["validate", "learn_good", "learn_bad"]).optional().describe("Mode: 'validate' (default) checks against known sequences, 'learn_good' mines patterns from successful traces, 'learn_bad' captures failure patterns"),
  },
  async ({ filtered_file, mode }) => {
    const result = validateTrace(filtered_file, mode || "validate");
    let learningSummary = "";
    if (mode === "learn_good" || mode === "learn_bad") {
      learningSummary = "\n\n💡 **Tip**: Run `share_learnings` to preview and push these learnings to the shared knowledge base.";
    }
    return { content: [{ type: "text", text: result + learningSummary }] };
  }
);

// ─── Tool: triage ───
server.tool(
  "triage",
  "Fast root-cause-first triage of a filtered ETL trace. Produces a compact Triage Card with top 2-3 suspected root causes, confidence scores, evidence pointers, missing signals, and recommended next actions. Use as the FIRST tool when analyzing any ETL trace — before deep dives.",
  {
    filtered_file: z.string().describe("Path to the filtered ETL text file (from analyze_etl extraction)"),
    symptom: z.string().optional().describe("User-reported symptom (e.g., 'NavigationCompleted not received', 'WebView2 stuck', 'blank page'). Improves root-cause matching."),
  },
  async ({ filtered_file, symptom }) => {
    const result = triage(filtered_file, symptom || "");
    return { content: [{ type: "text", text: result }] };
  }
);

// ─── Tool: evidence_pack ───
server.tool(
  "evidence_pack",
  "Generate a structured, RCA-ready evidence pack for a specific hypothesis. Includes evidence table, timeline, counter-evidence, alternative explanations, confidence scoring, and timing anomalies. Use AFTER triage to build a complete root-cause narrative.",
  {
    filtered_file: z.string().describe("Path to the filtered ETL text file"),
    hypothesis: z.string().describe("The root-cause hypothesis to build evidence for (e.g., 'navigation_stalled', 'initializing_navigation_suppression')"),
    symptom: z.string().optional().describe("Original symptom for context"),
  },
  async ({ filtered_file, hypothesis, symptom }) => {
    const result = evidencePack(filtered_file, hypothesis, symptom || "");
    return { content: [{ type: "text", text: result }] };
  }
);

// ─── Tool: nav_playbook ───
server.tool(
  "nav_playbook",
  "Run a deterministic navigation lifecycle playbook against a filtered ETL trace. Checks each stage of the WebView2 navigation pipeline (Navigate→NavigationStarting→SourceChanged→ContentLoading→HistoryChanged→DOMContentLoaded→NavigationCompleted), correlates by NavigationId, and identifies exactly where the pipeline breaks. Also checks host-vs-runtime boundary delivery and detects IFrame removal, NoHandlers, and NavIdNotFound issues.",
  {
    filtered_file: z.string().describe("Path to the filtered ETL text file"),
    scenario: z.string().optional().describe("Scenario to check (default: 'nav_completed_not_received'). Future: 'slow_navigation', 'init_lifecycle'."),
  },
  async ({ filtered_file, scenario }) => {
    const result = navPlaybook(filtered_file, scenario);
    return { content: [{ type: "text", text: result }] };
  }
);

// ─── Tool: rca_feedback ───
server.tool(
  "rca_feedback",
  "Capture structured feedback after an RCA analysis. Updates the knowledge base with confirmed root causes, missing event names, and timing baselines. Only safe, additive changes are auto-applied; destructive changes are logged for review.",
  {
    feedback: z.string().describe("JSON object with: { confirmedRootCause: 'yes'|'no'|'unknown', proposedRootCause: string, wrongSuspects?: [{name, reason}], missingEvents?: string[], timingUpdates?: {stage: ms}, goodEtlPath?: string, notes?: string }"),
  },
  async ({ feedback }) => {
    const result = await rcaFeedback(feedback);
    return { content: [{ type: "text", text: result }] };
  }
);

// ─── Tool: share_learnings ───
server.tool(
  "share_learnings",
  "Share your locally-learned knowledge with all users via GitHub. Use 'preview' (default) to see what would be shared, then 'confirm' to push. Two-step flow: preview → review → confirm.",
  {
    action: z.enum(["preview", "confirm"]).optional().describe("'preview' (default) shows a diff of what's new locally. 'confirm' pushes the changes to GitHub after you've reviewed."),
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

// ─── Tool: sync_status ───
server.tool(
  "sync_status",
  "Check the GitHub sync status of the shared knowledge base. Shows whether learnings are being shared with other users.",
  {},
  async () => {
    const status = getSyncStatus();
    return { content: [{ type: "text", text: status }] };
  }
);

// ─── Helper: resolve knowledge dir and push ───
async function pushToGitHub(): Promise<string> {
  try {
    const knowledgeDir = resolveKnowledgeDir();
    return await pushLearnings(knowledgeDir);
  } catch {
    return "";
  }
}

function resolveKnowledgeDir(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  // Check same patterns as loader.ts
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

// ─── Start Server ───
async function main() {
  // Initialize GitHub sync
  initSync();

  // Pull latest knowledge from GitHub (non-blocking)
  try {
    const knowledgeDir = resolveKnowledgeDir();
    const syncResult = await pullLatest(knowledgeDir);
    if (syncResult) console.error(syncResult);
  } catch (err: any) {
    console.error(`[sync] Pull failed (non-critical): ${err.message}`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("WebView2 ETW Analysis MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
