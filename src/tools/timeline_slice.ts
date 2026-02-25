import { existsSync, readFileSync } from "fs";
import { loadJson } from "../knowledge/loader.js";

/**
 * Analyzes what happened between two timestamps in a filtered ETL dump.
 * Shows event categories, key events, process activity, and potential issues.
 */
export function timelineSlice(
  filteredFile: string,
  startTimestamp: string,
  endTimestamp: string,
  pid?: string
): string {
  if (!existsSync(filteredFile)) {
    return `❌ Filtered file not found: ${filteredFile}. Run analyze_etl extraction first.`;
  }

  // Find first event timestamp for relative offset support
  const firstEventTs = findFirstTimestamp(filteredFile);

  const startUs = parseMicroseconds(startTimestamp, firstEventTs);
  const endUs = parseMicroseconds(endTimestamp, firstEventTs);

  if (startUs === null || endUs === null) {
    return [
      `❌ Could not parse timestamps.`,
      "",
      "**Accepted formats:**",
      "- Microseconds: `17677000` (any length)",
      "- Milliseconds with suffix: `84ms`, `17677ms`",
      "- Seconds with decimal: `32456.789`",
      "- Seconds with suffix: `17.6s`",
      "- Relative offset from trace start: `+84ms`, `+17.6s`",
      "- Raw from xperf: `32456789012`",
      "",
      firstEventTs !== null
        ? `ℹ️ First event in trace: ${firstEventTs}µs (${(firstEventTs / 1_000_000).toFixed(3)}s)`
        : "⚠️ Could not determine first event timestamp for relative offsets.",
      "",
      "Tip: Copy timestamps directly from xperf/filtered output, or use relative offsets like `+84ms`.",
    ].join("\n");
  }

  if (endUs <= startUs) {
    return `❌ End timestamp (${endTimestamp}) must be after start (${startTimestamp}).`;
  }

  const allLines = readFileSync(filteredFile, "utf-8")
    .split("\n")
    .filter(l => l.trim().length > 0);

  // Extract lines in the time window
  const windowLines: { line: string; ts: number }[] = [];
  for (const line of allLines) {
    const ts = extractTimestamp(line);
    if (ts !== null && ts >= startUs && ts <= endUs) {
      if (pid && !line.includes(`(${pid})`)) continue;
      windowLines.push({ line, ts });
    }
  }

  if (windowLines.length === 0) {
    return [
      `❌ No events found between ${startTimestamp} and ${endTimestamp}${pid ? ` for PID ${pid}` : ""}.`,
      "",
      "Possible causes:",
      "- Timestamps may be outside the trace range",
      "- PID filter may be too restrictive",
      "- Filtered file may not contain events in this window",
      "",
      `File has ${allLines.length} total lines.`,
      allLines.length > 0 ? `First timestamp: ${extractTimestamp(allLines[0]) || "?"}` : "",
      allLines.length > 0 ? `Last timestamp: ${extractTimestamp(allLines[allLines.length - 1]) || "?"}` : "",
    ].join("\n");
  }

  windowLines.sort((a, b) => a.ts - b.ts);
  const durationUs = endUs - startUs;
  const durationMs = (durationUs / 1000).toFixed(1);

  const result: string[] = [
    `## Timeline Slice: ${formatTimestamp(startUs)} → ${formatTimestamp(endUs)}`,
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Duration | ${durationMs}ms (${durationUs.toLocaleString()} µs) |`,
    `| Events in window | ${windowLines.length.toLocaleString()} |`,
    `| PID filter | ${pid || "all"} |`,
    `| Source | \`${filteredFile}\` |`,
    "",
  ];

  // Categorize events
  const categories = new Map<string, { count: number; events: string[]; firstTs: number; lastTs: number }>();
  const eventCounts = new Map<string, number>();
  const processCounts = new Map<string, number>();
  const errors: { ts: number; line: string }[] = [];

  const knownEvents = loadJson<Record<string, any>>("events.json");

  for (const { line, ts } of windowLines) {
    // Extract event name
    const eventName = extractEventName(line);
    if (eventName) {
      eventCounts.set(eventName, (eventCounts.get(eventName) || 0) + 1);

      // Categorize using knowledge base or heuristic
      const cat = categorizeEvent(eventName, knownEvents);
      if (!categories.has(cat)) {
        categories.set(cat, { count: 0, events: [], firstTs: ts, lastTs: ts });
      }
      const c = categories.get(cat)!;
      c.count++;
      if (!c.events.includes(eventName)) c.events.push(eventName);
      c.firstTs = Math.min(c.firstTs, ts);
      c.lastTs = Math.max(c.lastTs, ts);
    }

    // Extract process
    const procMatch = line.match(/(\S+\.exe)\s*\((\d+)\)/);
    if (procMatch) {
      const proc = `${procMatch[1]} (${procMatch[2]})`;
      processCounts.set(proc, (processCounts.get(proc) || 0) + 1);
    }

    // Detect errors
    if (line.match(/Failed|Failure|Error|Invalid|Timeout|Unresponsive/i) &&
        !line.match(/Process Name \( PID\)/i)) {
      errors.push({ ts, line: line.trim().substring(0, 150) });
    }
  }

  // Event categories summary
  const sortedCats = Array.from(categories.entries())
    .sort((a, b) => b[1].count - a[1].count);

  result.push("### 📊 Event Categories in Window");
  result.push("| Category | Events | Count | Time Span |");
  result.push("|----------|--------|-------|-----------|");
  for (const [cat, info] of sortedCats) {
    const span = info.lastTs > info.firstTs
      ? `${((info.lastTs - info.firstTs) / 1000).toFixed(1)}ms`
      : "instant";
    const evNames = info.events.slice(0, 3).join(", ") + (info.events.length > 3 ? ` +${info.events.length - 3}` : "");
    result.push(`| **${cat}** | ${evNames} | ${info.count} | ${span} |`);
  }
  result.push("");

  // Process activity
  if (processCounts.size > 0) {
    const sortedProcs = Array.from(processCounts.entries())
      .sort((a, b) => b[1] - a[1]);

    result.push("### 🔄 Active Processes");
    result.push("| Process (PID) | Events |");
    result.push("|---------------|--------|");
    for (const [proc, count] of sortedProcs.slice(0, 10)) {
      result.push(`| \`${proc}\` | ${count} |`);
    }
    result.push("");
  }

  // Top events
  const sortedEvents = Array.from(eventCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  result.push("### 🔝 Top Events");
  result.push("| Event | Count |");
  result.push("|-------|-------|");
  for (const [evt, count] of sortedEvents) {
    result.push(`| \`${evt}\` | ${count} |`);
  }
  result.push("");

  // First & last 5 events (timeline)
  result.push("### ⏱️ Timeline (first/last events)");
  result.push("```");
  const showLines = windowLines.length <= 10
    ? windowLines
    : [...windowLines.slice(0, 5), { line: `... ${windowLines.length - 10} more events ...`, ts: 0 }, ...windowLines.slice(-5)];

  for (const { line, ts } of showLines) {
    if (ts === 0) {
      result.push(line);
    } else {
      const offsetMs = ((ts - startUs) / 1000).toFixed(2);
      const eventName = extractEventName(line) || "?";
      const procMatch = line.match(/(\S+\.exe)\s*\((\d+)\)/);
      const proc = procMatch ? `${procMatch[1]}(${procMatch[2]})` : "?";
      result.push(`+${offsetMs.padStart(8)}ms  ${proc.padEnd(30)} ${eventName}`);
    }
  }
  result.push("```");
  result.push("");

  // Errors
  if (errors.length > 0) {
    result.push("### 🔴 Errors in Window");
    for (const err of errors.slice(0, 10)) {
      const offsetMs = ((err.ts - startUs) / 1000).toFixed(2);
      result.push(`- **+${offsetMs}ms**: \`${err.line}\``);
    }
    if (errors.length > 10) result.push(`- ... and ${errors.length - 10} more`);
    result.push("");
  }

  // Gaps analysis — find silent periods > 100ms within the window
  const gaps: { afterTs: number; beforeTs: number; gapMs: number }[] = [];
  for (let i = 1; i < windowLines.length; i++) {
    const gapUs = windowLines[i].ts - windowLines[i - 1].ts;
    if (gapUs > 100_000) { // > 100ms
      gaps.push({
        afterTs: windowLines[i - 1].ts,
        beforeTs: windowLines[i].ts,
        gapMs: gapUs / 1000,
      });
    }
  }

  if (gaps.length > 0) {
    result.push("### ⏸️ Silent Gaps (>100ms with no events)");
    result.push("| After (offset) | Before (offset) | Gap |");
    result.push("|----------------|-----------------|-----|");
    for (const gap of gaps.slice(0, 10)) {
      const afterMs = ((gap.afterTs - startUs) / 1000).toFixed(1);
      const beforeMs = ((gap.beforeTs - startUs) / 1000).toFixed(1);
      result.push(`| +${afterMs}ms | +${beforeMs}ms | **${gap.gapMs.toFixed(0)}ms** |`);
    }
    result.push("");
    result.push("Silent gaps may indicate:");
    result.push("- Waiting for I/O (disk, network)");
    result.push("- Blocked on a lock or synchronization primitive");
    result.push("- CPU doing work not captured by event filters");
    result.push("- Use `analyze_cpu` with this time range to see what the CPU was doing");
    result.push("");
  }

  // Recommendations
  result.push("### 📋 Next Steps");
  if (errors.length > 0) {
    result.push(`1. **${errors.length} errors** found — use \`diagnose\` to check known patterns`);
  }
  if (gaps.length > 0) {
    result.push(`2. **${gaps.length} silent gaps** — use \`analyze_cpu\` with the gap time range to see CPU activity`);
  }
  result.push(`3. Use \`lookup_event\` on unfamiliar events`);
  result.push(`4. Narrow further with a tighter time range or specific PID`);

  return result.join("\n");
}

// --- Helpers ---

function extractTimestamp(line: string): number | null {
  // xperf format: EventName, Timestamp, ProcessName (PID), ...
  const match = line.match(/,\s*(\d{5,})/);
  if (match) return parseInt(match[1], 10);
  return null;
}

function parseMicroseconds(ts: string, firstEventTs?: number | null): number | null {
  const s = ts.trim();

  // Relative offset from trace start: "+84ms", "+17.6s", "+500ms"
  const relMsMatch = s.match(/^\+(\d+(?:\.\d+)?)\s*ms$/i);
  if (relMsMatch) {
    const offsetMs = parseFloat(relMsMatch[1]);
    const base = firstEventTs ?? 0;
    return base + Math.round(offsetMs * 1_000);
  }
  const relSecMatch = s.match(/^\+(\d+(?:\.\d+)?)\s*s$/i);
  if (relSecMatch) {
    const offsetSec = parseFloat(relSecMatch[1]);
    const base = firstEventTs ?? 0;
    return base + Math.round(offsetSec * 1_000_000);
  }

  // Milliseconds with suffix: "84ms", "17677ms"
  const msMatch = s.match(/^(\d+(?:\.\d+)?)\s*ms$/i);
  if (msMatch) return Math.round(parseFloat(msMatch[1]) * 1_000);

  // Seconds with suffix: "17.6s", "150s"
  const secSuffix = s.match(/^(\d+(?:\.\d+)?)\s*s$/i);
  if (secSuffix) return Math.round(parseFloat(secSuffix[1]) * 1_000_000);

  // Seconds with decimal but no suffix (e.g., "32456.789")
  const secMatch = s.match(/^(\d+)\.(\d+)$/);
  if (secMatch) return Math.round(parseFloat(s) * 1_000_000);

  // Raw integer — assume microseconds (any digit count, not just 8+)
  if (/^\d+$/.test(s)) return parseInt(s, 10);

  return null;
}

/** Scan filtered file to find the first real event timestamp (skip -1 / header lines). */
function findFirstTimestamp(filteredFile: string): number | null {
  const lines = readFileSync(filteredFile, "utf-8").split("\n");
  for (const line of lines) {
    const ts = extractTimestamp(line);
    if (ts !== null && ts > 0) return ts;
  }
  return null;
}

function formatTimestamp(us: number): string {
  if (us >= 1_000_000) {
    const sec = (us / 1_000_000).toFixed(3);
    return `${sec}s (${us.toLocaleString()}µs)`;
  }
  if (us >= 1_000) {
    const ms = (us / 1_000).toFixed(1);
    return `${ms}ms (${us.toLocaleString()}µs)`;
  }
  return `${us}µs`;
}

function extractEventName(line: string): string | null {
  // xperf: "EventName/SubEvent/,  Timestamp, ..."
  const match = line.match(/^\s*(\S+?)[\s,\/]/);
  if (match) {
    let name = match[1];
    // Remove trailing slashes or commas
    name = name.replace(/[,\/]+$/, "");
    return name;
  }
  return null;
}

function categorizeEvent(eventName: string, knownEvents: Record<string, any>): string {
  // Check knowledge base first
  if (knownEvents[eventName] && knownEvents[eventName].category) {
    return knownEvents[eventName].category;
  }

  // Heuristic categorization
  if (eventName.startsWith("WebView2_Factory")) return "Factory & Creation";
  if (eventName.startsWith("WebView2_Creation")) return "Factory & Creation";
  if (eventName.includes("Navigation")) return "Navigation";
  if (eventName.startsWith("WebView2_API")) return "API Calls";
  if (eventName.startsWith("WebView2_Event")) return "Event Dispatch";
  if (eventName.includes("ServiceWorker")) return "Service Worker";
  if (eventName.includes("URLLoader") || eventName.includes("CorsURL")) return "Network";
  if (eventName.includes("TokenBroker") || eventName.includes("WebTokenRequest")) return "Authentication";
  if (eventName.includes("Failed") || eventName.includes("Error") || eventName.includes("Failure")) return "Errors";
  if (eventName.startsWith("WebView2_FGBoost")) return "Performance";
  if (eventName.startsWith("WebView2_Memory") || eventName.includes("Memory")) return "Memory";
  if (eventName.startsWith("WebView2_Process") || eventName.includes("Process")) return "Process Management";
  if (eventName.startsWith("WebView2_")) return "WebView2 Other";
  if (eventName.startsWith("BrowserMain") || eventName.startsWith("BrowserTask")) return "Browser Startup";
  if (eventName.startsWith("v8.")) return "V8 JavaScript";
  return "Other";
}
