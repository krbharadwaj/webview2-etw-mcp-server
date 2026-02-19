/**
 * Auto-learn module: Silently grows the knowledge base from every analysis.
 * No user action required — learning happens automatically whenever
 * the server processes ETL data.
 */

import { loadJson, saveJson } from "../knowledge/loader.js";

interface EventEntry {
  description: string;
  category: string;
  severity: string;
  params: any[];
  relatedEvents: string[];
  sourceFile?: string;
  autoDiscovered?: boolean;
  firstSeenDate?: string;
  seenCount?: number;
}

interface TimingBaseline {
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  notes: string;
  sampleCount: number;
}

// Batch buffer — collect discoveries during a single tool call, flush at end
let pendingEvents: Map<string, Partial<EventEntry>> = new Map();
let pendingTimings: Map<string, number> = new Map();
let learnStats = { eventsDiscovered: 0, timingsRecorded: 0 };

/**
 * Call this with lines from any filtered ETL file.
 * It silently catalogs unknown events and extracts timings.
 */
export function learnFromLines(lines: string[]): void {
  const events = loadJson<Record<string, EventEntry>>("events.json");

  for (const line of lines) {
    // 1. Discover unknown events
    const eventName = extractEventName(line);
    if (eventName && !events[eventName] && !pendingEvents.has(eventName)) {
      pendingEvents.set(eventName, {
        description: inferDescription(eventName),
        category: inferCategory(eventName),
        severity: inferSeverity(eventName),
        params: [],
        relatedEvents: [],
        autoDiscovered: true,
        firstSeenDate: new Date().toISOString().split("T")[0],
        seenCount: 1,
      });
    } else if (eventName && pendingEvents.has(eventName)) {
      const entry = pendingEvents.get(eventName)!;
      entry.seenCount = (entry.seenCount || 1) + 1;
    }

    // 2. Extract timing from known timing events
    extractTimingFromLine(line);
  }
}

/**
 * Flush all pending discoveries to disk.
 * Call this at the end of any tool that processes ETL data.
 * Returns a summary string (empty if nothing learned).
 */
export function flushLearnings(): string {
  const summaryParts: string[] = [];

  // Flush events
  if (pendingEvents.size > 0) {
    const events = loadJson<Record<string, EventEntry>>("events.json");
    let added = 0;
    for (const [name, entry] of pendingEvents) {
      if (!events[name]) {
        events[name] = entry as EventEntry;
        added++;
      }
    }
    if (added > 0) {
      saveJson("events.json", events);
      summaryParts.push(`📚 Auto-discovered ${added} new event${added > 1 ? "s" : ""}`);
      learnStats.eventsDiscovered += added;
    }
    pendingEvents.clear();
  }

  // Flush timings
  if (pendingTimings.size > 0) {
    const baselines = loadJson<Record<string, TimingBaseline>>("timing_baselines.json");
    let updated = 0;
    for (const [key, valueMs] of pendingTimings) {
      if (baselines[key]) {
        // Update with running statistics
        const b = baselines[key];
        const n = b.sampleCount + 1;
        // Approximate percentile update using exponential moving average
        const alpha = 2 / (n + 1);
        b.p50_ms = b.p50_ms + alpha * (valueMs - b.p50_ms);
        b.p95_ms = Math.max(b.p95_ms, b.p95_ms + alpha * (valueMs - b.p95_ms));
        b.p99_ms = Math.max(b.p99_ms, b.p99_ms + alpha * (valueMs - b.p99_ms));
        b.sampleCount = n;
        updated++;
      } else {
        // Create new baseline
        baselines[key] = {
          p50_ms: valueMs,
          p95_ms: valueMs,
          p99_ms: valueMs,
          notes: `Auto-learned from ETL analysis`,
          sampleCount: 1,
        };
        updated++;
      }
    }
    if (updated > 0) {
      saveJson("timing_baselines.json", baselines);
      summaryParts.push(`⏱️ Updated ${updated} timing baseline${updated > 1 ? "s" : ""}`);
      learnStats.timingsRecorded += updated;
    }
    pendingTimings.clear();
  }

  if (summaryParts.length === 0) return "";
  return "\n\n---\n🧠 **Auto-learned**: " + summaryParts.join(" | ");
}

/**
 * Get cumulative stats for this session.
 */
export function getLearnStats(): { eventsDiscovered: number; timingsRecorded: number } {
  return { ...learnStats };
}

// --- Internal helpers ---

function extractEventName(line: string): string | null {
  const match = line.match(/^\s*(\S+?)[\s,\/]/);
  if (!match) return null;
  const name = match[1].replace(/[,\/]+$/, "");

  // Filter out noise — only catalog meaningful event names
  if (name.length < 3) return null;
  if (/^\d+$/.test(name)) return null; // pure numbers
  if (name.startsWith("---")) return null;
  if (name === "Process" || name === "Thread" || name === "Unknown") return null;

  return name;
}

function extractTimingFromLine(line: string): void {
  // NavigationTotal with duration
  if (line.includes("NavigationTotal")) {
    const dur = extractDurationMs(line);
    if (dur !== null) pendingTimings.set("navigation_total", dur);
  }
  // BeginNavigationToCommit
  if (line.includes("BeginNavigationToCommit")) {
    const dur = extractDurationMs(line);
    if (dur !== null) pendingTimings.set("begin_navigation_to_commit", dur);
  }
  // CommitToDidCommit
  if (line.includes("CommitToDidCommit") && !line.includes("RendererCommitToDidCommit")) {
    const dur = extractDurationMs(line);
    if (dur !== null) pendingTimings.set("commit_to_did_commit", dur);
  }
  // WebView2_CreationTime
  if (line.includes("WebView2_CreationTime")) {
    const dur = extractDurationMs(line);
    if (dur !== null) pendingTimings.set("creation_client_cold_start", dur);
  }
  // WebView2_FirstNavigationTime
  if (line.includes("WebView2_FirstNavigationTime")) {
    const dur = extractDurationMs(line);
    if (dur !== null) pendingTimings.set("first_navigation_to_web", dur);
  }
  // ForwardServiceWorkerToWorkerReady
  if (line.includes("ForwardServiceWorkerToWorkerReady")) {
    const dur = extractDurationMs(line);
    if (dur !== null) pendingTimings.set("sw_forward_to_worker_ready", dur);
  }
  // FetchHandlerStartToFetchHandlerEnd
  if (line.includes("FetchHandlerStartToFetchHandlerEnd")) {
    const dur = extractDurationMs(line);
    if (dur !== null) pendingTimings.set("sw_fetch_handler_execution", dur);
  }
  // WAM token request
  if (line.includes("WebTokenRequestResultOperation_ActivityStop")) {
    const durMatch = line.match(/DurationTotal_ms[=:]\s*(\d+)/i);
    if (durMatch) pendingTimings.set("wam_token_request", parseInt(durMatch[1], 10));
  }
}

function extractDurationMs(line: string): number | null {
  // Look for duration patterns: "duration=123", "123 ms", field with large number that's a duration
  const patterns = [
    /duration[=:]\s*([\d.]+)/i,
    /([\d.]+)\s*ms/i,
    /total_time_ms[=:]\s*([\d.]+)/i,
    /navigation_time[=:]\s*([\d.]+)/i,
  ];
  for (const p of patterns) {
    const m = line.match(p);
    if (m) return parseFloat(m[1]);
  }
  return null;
}

function inferCategory(eventName: string): string {
  if (eventName.startsWith("WebView2_Factory")) return "Factory & Creation";
  if (eventName.startsWith("WebView2_Creation")) return "Factory & Creation";
  if (eventName.includes("Navigation")) return "Navigation";
  if (eventName.startsWith("WebView2_API")) return "API Calls";
  if (eventName.startsWith("WebView2_Event")) return "Event Dispatch";
  if (eventName.includes("ServiceWorker")) return "Service Worker";
  if (eventName.includes("URLLoader") || eventName.includes("CorsURL")) return "Network";
  if (eventName.includes("TokenBroker") || eventName.includes("WebTokenRequest")) return "Authentication";
  if (eventName.includes("Failed") || eventName.includes("Error") || eventName.includes("Failure")) return "Error & Failure";
  if (eventName.startsWith("WebView2_FGBoost")) return "Performance";
  if (eventName.includes("Memory") || eventName.includes("Suspend")) return "Memory";
  if (eventName.includes("Process") || eventName.includes("Launch")) return "Process Management";
  if (eventName.startsWith("WebView2_")) return "WebView2 Other";
  if (eventName.startsWith("BrowserMain") || eventName.startsWith("BrowserTask")) return "Browser Startup";
  if (eventName.startsWith("v8.")) return "V8 JavaScript";
  if (eventName.startsWith("Blink.")) return "Blink Rendering";
  return "Uncategorized";
}

function inferSeverity(eventName: string): string {
  if (eventName.includes("Failed") || eventName.includes("Failure") || eventName.includes("Error")) return "Warning";
  if (eventName.includes("Timeout") || eventName.includes("Unresponsive")) return "Critical";
  if (eventName.includes("Create") || eventName.includes("Start") || eventName.includes("Init")) return "Info";
  if (eventName.includes("Debug") || eventName.includes("Trace")) return "Debug";
  return "Info";
}

function inferDescription(eventName: string): string {
  // Build a human-readable description from the event name
  const parts = eventName
    .replace(/::/g, " ")
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .trim()
    .toLowerCase();
  return `Auto-discovered: ${parts}`;
}
