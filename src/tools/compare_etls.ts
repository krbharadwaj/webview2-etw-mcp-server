import { existsSync, readFileSync } from "fs";
import { generatePreprocessStep } from "./etlx_cache.js";

const XPERF_PATH = "C:\\Program Files (x86)\\Windows Kits\\10\\Windows Performance Toolkit\\xperf.exe";

/**
 * Compare two ETL files — generates side-by-side extraction commands,
 * or if filtered files are already provided, does the actual comparison.
 */
export function compareEtls(
  successEtl: string,
  failureEtl: string,
  hostApp: string,
  successFiltered?: string,
  failureFiltered?: string
): string {
  // Mode 1: Filtered files already exist — do the comparison
  if (successFiltered && failureFiltered) {
    if (!existsSync(successFiltered)) {
      return `❌ Success filtered file not found: ${successFiltered}. Run the extraction commands first.`;
    }
    if (!existsSync(failureFiltered)) {
      return `❌ Failure filtered file not found: ${failureFiltered}. Run the extraction commands first.`;
    }
    return doComparison(successFiltered, failureFiltered, hostApp);
  }

  // Mode 2: Generate extraction commands for both ETLs
  return generateExtractionCommands(successEtl, failureEtl, hostApp);
}

function generateExtractionCommands(
  successEtl: string,
  failureEtl: string,
  hostApp: string
): string {
  const successExists = existsSync(successEtl);
  const failureExists = existsSync(failureEtl);

  const lines = [
    `## ETL Comparison Setup: SUCCESS vs FAILURE`,
    "",
    `| | SUCCESS | FAILURE |`,
    `|---|---------|---------|`,
    `| ETL | \`${successEtl}\` | \`${failureEtl}\` |`,
    `| Exists | ${successExists ? "✅" : "❌"} | ${failureExists ? "✅" : "❌"} |`,
    `| Host App | ${hostApp} | ${hostApp} |`,
    "",
  ];

  if (!successExists || !failureExists) {
    lines.push("⚠️ One or both ETL files not found. Check paths and try again.");
    return lines.join("\n");
  }

  lines.push(
    "### Step 1: Set Variables",
    "```powershell",
    `$xperf = "${XPERF_PATH}"`,
    `$env:_NT_SYMBOL_PATH = "srv*C:\\Symbols*http://msdl.microsoft.com/download/symbols"`,
    `$hostApp = "${hostApp}"`,
    `$successEtl = "${successEtl}"`,
    `$failureEtl = "${failureEtl}"`,
    `$outDir = "C:\\temp\\etl_compare"`,
    `New-Item -ItemType Directory -Path $outDir -Force | Out-Null`,
    "```",
    "",
    "### Step 1.5: Pre-process SUCCESS ETL",
    ...generatePreprocessStep("$successEtl", "C:\\temp\\etl_compare"),
    "### Step 1.6: Pre-process FAILURE ETL",
    ...generatePreprocessStep("$failureEtl", "C:\\temp\\etl_compare"),
    "### Step 2: Extract SUCCESS ETL",
    "```powershell",
    `Write-Host "Extracting SUCCESS ETL..."`,
    `& $xperf -i $successEtl -quiet -a dumper 2>$null |`,
    `  Select-String -Pattern "$hostApp|WebView2_|msedgewebview2|NavigationRequest|ServiceWorker|TokenBroker|BrowserMain|v8\\." |`,
    `  Where-Object { $_.Line -notmatch "Process Name \\( PID\\)" } |`,
    `  Out-File "$outDir\\success_filtered.txt" -Encoding utf8`,
    `Write-Host "SUCCESS: $((Get-Content "$outDir\\success_filtered.txt" | Measure-Object).Count) lines"`,
    "```",
    "",
    "### Step 3: Extract FAILURE ETL",
    "```powershell",
    `Write-Host "Extracting FAILURE ETL..."`,
    `& $xperf -i $failureEtl -quiet -a dumper 2>$null |`,
    `  Select-String -Pattern "$hostApp|WebView2_|msedgewebview2|NavigationRequest|ServiceWorker|TokenBroker|BrowserMain|v8\\." |`,
    `  Where-Object { $_.Line -notmatch "Process Name \\( PID\\)" } |`,
    `  Out-File "$outDir\\failure_filtered.txt" -Encoding utf8`,
    `Write-Host "FAILURE: $((Get-Content "$outDir\\failure_filtered.txt" | Measure-Object).Count) lines"`,
    "```",
    "",
    "### Step 4: Quick Summary of Both",
    "```powershell",
    `Write-Host "\\n=== SUCCESS ETL ==="`,
    `Write-Host "Host PIDs:"`,
    `Select-String -Path "$outDir\\success_filtered.txt" -Pattern "$hostApp" |`,
    `  ForEach-Object { if ($_.Line -match "$hostApp\\.exe\\s*\\((\\d+)\\)") { $matches[1] } } | Sort-Object -Unique`,
    `Write-Host "WebView2 PIDs:"`,
    `Select-String -Path "$outDir\\success_filtered.txt" -Pattern "msedgewebview2" |`,
    `  ForEach-Object { if ($_.Line -match 'msedgewebview2\\.exe.*?\\((\\d+)\\)') { $matches[1] } } | Sort-Object -Unique`,
    "",
    `Write-Host "\\n=== FAILURE ETL ==="`,
    `Write-Host "Host PIDs:"`,
    `Select-String -Path "$outDir\\failure_filtered.txt" -Pattern "$hostApp" |`,
    `  ForEach-Object { if ($_.Line -match "$hostApp\\.exe\\s*\\((\\d+)\\)") { $matches[1] } } | Sort-Object -Unique`,
    `Write-Host "WebView2 PIDs:"`,
    `Select-String -Path "$outDir\\failure_filtered.txt" -Pattern "msedgewebview2" |`,
    `  ForEach-Object { if ($_.Line -match 'msedgewebview2\\.exe.*?\\((\\d+)\\)') { $matches[1] } } | Sort-Object -Unique`,
    "```",
    "",
    "### Step 5: Compare (after extraction is done)",
    `Once both extractions complete, ask Copilot:`,
    "",
    `> *"Compare the ETL results: success is C:\\temp\\etl_compare\\success_filtered.txt and failure is C:\\temp\\etl_compare\\failure_filtered.txt for ${hostApp}"*`,
    "",
    "This will run the actual comparison and show you:",
    "- Event count differences",
    "- Events present in SUCCESS but missing in FAILURE (and vice versa)",
    "- Timing differences for key lifecycle events",
    "- Error events unique to FAILURE",
  );

  return lines.join("\n");
}

function doComparison(successPath: string, failurePath: string, hostApp: string): string {
  const successLines = readFileSync(successPath, "utf-8").split("\n").filter(l => l.trim().length > 0);
  const failureLines = readFileSync(failurePath, "utf-8").split("\n").filter(l => l.trim().length > 0);

  // Extract event names from both
  const successEvents = extractEventCounts(successLines);
  const failureEvents = extractEventCounts(failureLines);

  // Extract key lifecycle events with timestamps
  const successLifecycle = extractLifecycleEvents(successLines);
  const failureLifecycle = extractLifecycleEvents(failureLines);

  // Extract errors
  const successErrors = extractErrors(successLines);
  const failureErrors = extractErrors(failureLines);

  // Extract PIDs
  const successPids = extractPids(successLines, hostApp);
  const failurePids = extractPids(failureLines, hostApp);

  const lines: string[] = [
    `## ETL Comparison: SUCCESS vs FAILURE`,
    "",
    "### Overview",
    `| Metric | SUCCESS | FAILURE |`,
    `|--------|---------|---------|`,
    `| Total event lines | ${successLines.length.toLocaleString()} | ${failureLines.length.toLocaleString()} |`,
    `| Unique event types | ${successEvents.size} | ${failureEvents.size} |`,
    `| Host app PIDs | ${successPids.host.join(", ") || "none"} | ${failurePids.host.join(", ") || "none"} |`,
    `| WebView2 PIDs | ${successPids.webview.join(", ") || "none"} | ${failurePids.webview.join(", ") || "none"} |`,
    `| Error events | ${successErrors.length} | ${failureErrors.length} |`,
    "",
  ];

  // Events present in one but not the other
  const onlyInSuccess: string[] = [];
  const onlyInFailure: string[] = [];
  const inBoth: { event: string; successCount: number; failureCount: number }[] = [];

  for (const [event, count] of successEvents) {
    const failCount = failureEvents.get(event);
    if (failCount === undefined) {
      onlyInSuccess.push(`${event} (×${count})`);
    } else {
      inBoth.push({ event, successCount: count, failureCount: failCount });
    }
  }
  for (const [event, count] of failureEvents) {
    if (!successEvents.has(event)) {
      onlyInFailure.push(`${event} (×${count})`);
    }
  }

  if (onlyInSuccess.length > 0) {
    lines.push("### ✅ Events ONLY in SUCCESS (missing from failure)");
    for (const e of onlyInSuccess.slice(0, 20)) {
      lines.push(`- \`${e}\``);
    }
    if (onlyInSuccess.length > 20) lines.push(`- ... and ${onlyInSuccess.length - 20} more`);
    lines.push("");
  }

  if (onlyInFailure.length > 0) {
    lines.push("### ❌ Events ONLY in FAILURE (not in success)");
    for (const e of onlyInFailure.slice(0, 20)) {
      lines.push(`- \`${e}\``);
    }
    if (onlyInFailure.length > 20) lines.push(`- ... and ${onlyInFailure.length - 20} more`);
    lines.push("");
  }

  // Count differences for events in both
  const bigDiffs = inBoth
    .filter(e => {
      const ratio = Math.max(e.successCount, e.failureCount) / Math.max(Math.min(e.successCount, e.failureCount), 1);
      return ratio > 2 || Math.abs(e.successCount - e.failureCount) > 10;
    })
    .sort((a, b) => {
      const ratioA = Math.max(a.successCount, a.failureCount) / Math.max(Math.min(a.successCount, a.failureCount), 1);
      const ratioB = Math.max(b.successCount, b.failureCount) / Math.max(Math.min(b.successCount, b.failureCount), 1);
      return ratioB - ratioA;
    });

  if (bigDiffs.length > 0) {
    lines.push("### ⚠️ Significant Count Differences");
    lines.push("| Event | SUCCESS | FAILURE | Ratio |");
    lines.push("|-------|---------|---------|-------|");
    for (const e of bigDiffs.slice(0, 15)) {
      const ratio = (Math.max(e.successCount, e.failureCount) / Math.max(Math.min(e.successCount, e.failureCount), 1)).toFixed(1);
      const indicator = e.failureCount > e.successCount ? "⬆️" : "⬇️";
      lines.push(`| \`${e.event}\` | ${e.successCount} | ${e.failureCount} | ${ratio}x ${indicator} |`);
    }
    lines.push("");
  }

  // Lifecycle event comparison
  if (successLifecycle.length > 0 || failureLifecycle.length > 0) {
    lines.push("### 🕐 Lifecycle Event Timing");
    lines.push("| Event | SUCCESS (first seen) | FAILURE (first seen) |");
    lines.push("|-------|---------------------|---------------------|");
    const allLifecycle = new Set([...successLifecycle.map(e => e.event), ...failureLifecycle.map(e => e.event)]);
    for (const event of allLifecycle) {
      const s = successLifecycle.find(e => e.event === event);
      const f = failureLifecycle.find(e => e.event === event);
      lines.push(`| \`${event}\` | ${s ? `T=${s.timestamp}` : "❌ missing"} | ${f ? `T=${f.timestamp}` : "❌ missing"} |`);
    }
    lines.push("");
  }

  // Error comparison
  if (failureErrors.length > 0) {
    lines.push("### 🔴 Errors in FAILURE ETL");
    for (const err of failureErrors.slice(0, 10)) {
      lines.push(`- \`${err}\``);
    }
    if (failureErrors.length > 10) lines.push(`- ... and ${failureErrors.length - 10} more`);
    lines.push("");

    const successOnlyErrors = successErrors.filter(e => !failureErrors.some(f => f.startsWith(e.split(",")[0])));
    if (successOnlyErrors.length > 0) {
      lines.push("### 🟢 Errors in SUCCESS ETL (for comparison)");
      for (const err of successOnlyErrors.slice(0, 5)) {
        lines.push(`- \`${err}\``);
      }
      lines.push("");
    }
  }

  // Recommendations
  lines.push("### 📋 Next Steps");
  if (onlyInSuccess.length > 0) {
    lines.push(`1. **Missing events in FAILURE**: ${onlyInSuccess.length} event types are in SUCCESS but not FAILURE. Use \`lookup_event\` to understand what's missing.`);
  }
  if (onlyInFailure.length > 0) {
    lines.push(`2. **Extra events in FAILURE**: ${onlyInFailure.length} event types appear only in FAILURE. These may be error/recovery events.`);
  }
  if (failureErrors.length > 0) {
    lines.push(`3. **${failureErrors.length} error events** in FAILURE — investigate with \`diagnose\`.`);
  }
  lines.push(`4. Use \`compare_incarnations\` with specific PIDs for detailed timeline comparison.`);

  return lines.join("\n");
}

function extractEventCounts(lines: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    // Extract event name (first field before comma or slash)
    const match = line.match(/^\s*(\S+?)[\s,\/]/);
    if (match) {
      const event = match[1];
      counts.set(event, (counts.get(event) || 0) + 1);
    }
  }
  return counts;
}

function extractLifecycleEvents(lines: string[]): { event: string; timestamp: string }[] {
  const lifecycle: { event: string; timestamp: string }[] = [];
  const seen = new Set<string>();
  const lifecyclePatterns = [
    "WebView2_Creation_Client",
    "WebView2_FactoryCreate",
    "WebView2_APICalled",
    "WebView2_CreationTime",
    "WebView2_WebViewProcessLaunchType",
    "WebView2_FirstNavigationTime",
    "NavigationRequest::Create",
    "NavigationRequest::CommitNavigation",
    "NavigationRequest::DidCommitNavigation",
    "WebView2_BrowserProcessFailure",
    "WebView2_ShuttingDown",
  ];

  for (const line of lines) {
    for (const pattern of lifecyclePatterns) {
      if (line.includes(pattern) && !seen.has(pattern)) {
        seen.add(pattern);
        const tsMatch = line.match(/,\s*(\d+)/);
        lifecycle.push({ event: pattern, timestamp: tsMatch ? tsMatch[1] : "?" });
        break;
      }
    }
  }
  return lifecycle;
}

function extractErrors(lines: string[]): string[] {
  const errors: string[] = [];
  for (const line of lines) {
    if (
      line.match(/Failed|Failure|Error|Invalid|Unresponsive|Timeout/i) &&
      !line.match(/Process Name \( PID\)/i)
    ) {
      const trimmed = line.trim().substring(0, 200);
      errors.push(trimmed);
      if (errors.length >= 50) break;
    }
  }
  return errors;
}

function extractPids(lines: string[], hostApp: string): { host: string[]; webview: string[] } {
  const hostPids = new Set<string>();
  const wv2Pids = new Set<string>();
  const hostRegex = new RegExp(`${hostApp}\\.exe\\s*\\((\\d+)\\)`);
  const wv2Regex = /msedgewebview2\.exe.*?\((\d+)\)/;

  for (const line of lines.slice(0, 5000)) { // Only scan first 5000 for speed
    const hMatch = line.match(hostRegex);
    if (hMatch) hostPids.add(hMatch[1]);
    const wMatch = line.match(wv2Regex);
    if (wMatch) wv2Pids.add(wMatch[1]);
  }

  return {
    host: Array.from(hostPids).slice(0, 10),
    webview: Array.from(wv2Pids).slice(0, 10),
  };
}
