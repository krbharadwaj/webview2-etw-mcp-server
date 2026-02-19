import { loadJson, type TimingBaseline } from "../knowledge/loader.js";

const timingBaselines = loadJson<Record<string, TimingBaseline>>("timing_baselines.json");

export function compareIncarnations(
  successEvents: string,
  failureEvents: string
): string {
  // Parse event lines into structured data
  const success = parseEventLines(successEvents);
  const failure = parseEventLines(failureEvents);

  if (success.length === 0 && failure.length === 0) {
    return [
      "❌ No events provided. To use this tool, provide event lines from the filtered ETL dump.",
      "",
      "### How to get event lines",
      "```powershell",
      "# For SUCCESS incarnation (replace PID):",
      "Select-String -Path $filtered -Pattern 'WebView2_APICalled|WebView2_Event|WebView2_Creation|NavigationRequest' |",
      "  Select-String '(SUCCESS_PID)' | Out-File success_events.txt",
      "",
      "# For FAILURE incarnation (replace PID):",
      "Select-String -Path $filtered -Pattern 'WebView2_APICalled|WebView2_Event|WebView2_Creation|NavigationRequest' |",
      "  Select-String '(FAILURE_PID)' | Out-File failure_events.txt",
      "```",
      "",
      "Then pass the file contents to this tool.",
    ].join("\n");
  }

  const lines: string[] = [
    "## Incarnation Comparison",
    "",
    `SUCCESS: ${success.length} events | FAILURE: ${failure.length} events`,
    "",
    "### Side-by-Side Timeline",
    "| # | SUCCESS Event | Δ(ms) | FAILURE Event | Δ(ms) | Match |",
    "|---|--------------|-------|---------------|-------|-------|",
  ];

  // Align events by type
  const maxLen = Math.max(success.length, failure.length);
  let firstDivergence = -1;

  for (let i = 0; i < Math.min(maxLen, 30); i++) {
    const s = success[i];
    const f = failure[i];
    const sName = s?.event || "—";
    const fName = f?.event || "—";
    const sDelta = s ? `+${s.deltaMs}` : "—";
    const fDelta = f ? `+${f.deltaMs}` : "—";
    const match = sName === fName ? "✅" : "❌";

    if (match === "❌" && firstDivergence === -1) {
      firstDivergence = i;
    }

    lines.push(`| ${i + 1} | ${sName} | ${sDelta} | ${fName} | ${fDelta} | ${match} |`);
  }

  if (maxLen > 30) {
    lines.push(`| ... | (${maxLen - 30} more) | | | | |`);
  }

  lines.push("");
  if (firstDivergence >= 0) {
    lines.push(`### ⚠️ First Divergence at Event #${firstDivergence + 1}`);
    const s = success[firstDivergence];
    const f = failure[firstDivergence];
    lines.push(`- SUCCESS: ${s?.event || "MISSING"} at Δ${s?.deltaMs || "?"}ms`);
    lines.push(`- FAILURE: ${f?.event || "MISSING"} at Δ${f?.deltaMs || "?"}ms`);
    lines.push("");
    lines.push("**This is likely where the root cause begins.** Use `diagnose` tool with the appropriate symptom for next steps.");
  } else {
    lines.push("### ✅ Event sequences match — investigate timing differences");
  }

  // Timing comparison
  lines.push("", "### Timing Comparison");
  const sTotal = success.length > 0 ? success[success.length - 1].deltaMs : 0;
  const fTotal = failure.length > 0 ? failure[failure.length - 1].deltaMs : 0;
  lines.push(`- SUCCESS total: ${sTotal}ms`);
  lines.push(`- FAILURE total: ${fTotal}ms`);
  if (fTotal > sTotal * 2) {
    lines.push(`- ⚠️ FAILURE is ${(fTotal / Math.max(sTotal, 1)).toFixed(1)}x slower`);
  }

  return lines.join("\n");
}

interface ParsedEvent {
  event: string;
  timestamp: number;
  deltaMs: number;
}

function parseEventLines(text: string): ParsedEvent[] {
  if (!text || text.trim().length === 0) return [];

  const lines = text.split("\n").filter(l => l.trim().length > 0);
  const events: ParsedEvent[] = [];
  let firstTimestamp = -1;

  for (const line of lines) {
    // Try to extract event name and timestamp from xperf format:
    // EventName/SubEvent,  Timestamp(µs),  ProcessName (PID), ...
    const parts = line.split(",").map(s => s.trim());
    if (parts.length < 2) continue;

    const event = parts[0].split("/")[0].trim();
    const timestamp = parseInt(parts[1]);
    if (isNaN(timestamp)) continue;

    if (firstTimestamp === -1) firstTimestamp = timestamp;
    const deltaMs = Math.round((timestamp - firstTimestamp) / 1000); // µs to ms

    events.push({ event, timestamp, deltaMs });
  }

  return events;
}
