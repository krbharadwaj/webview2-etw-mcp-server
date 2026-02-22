import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { generatePreprocessStep } from "./etlx_cache.js";

const XPERF_PATH = "C:\\Program Files (x86)\\Windows Kits\\10\\Windows Performance Toolkit\\xperf.exe";

// TraceEvent-based extractor (fast, single-pass, no xperf text dump)
function getEtlExtractPath(): string {
  // Resolve relative to this file: ../tools/etl-extract/bin/EtlExtract.exe
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const toolPath = join(thisDir, "..", "..", "tools", "etl-extract", "bin", "EtlExtract.exe");
  return toolPath;
}

interface AnalyzeResult {
  processMap: ProcessInfo[];
  timeline: TimelineEvent[];
  summary: string;
}

interface ProcessInfo {
  name: string;
  pid: number;
  role: string;
  eventCount: number;
}

interface TimelineEvent {
  timestamp: number;
  event: string;
  process: string;
  pid: number;
  details: string;
}

export function analyzeEtl(etlPath: string, hostApp: string, outDir?: string): string {
  if (!existsSync(etlPath)) {
    return `❌ ETL file not found: ${etlPath}`;
  }

  const outputDir = outDir || "C:\\temp\\etl_analysis";
  const etlExtractPath = getEtlExtractPath();
  const useTraceEvent = existsSync(etlExtractPath);

  if (!useTraceEvent && !existsSync(XPERF_PATH)) {
    return [
      "❌ No ETL extraction tool found.",
      "",
      "Option 1 (fast): Build the TraceEvent extractor:",
      "  cd tools/etl-extract/EtlExtract && dotnet publish -c Release -r win-x64 --self-contained false -o ../bin",
      "",
      "Option 2 (legacy): Install Windows Performance Toolkit from Windows SDK:",
      "  https://developer.microsoft.com/en-us/windows/downloads/windows-sdk/",
    ].join("\n");
  }

  if (useTraceEvent) {
    // Fast path: single-pass extraction using TraceEvent (replaces Steps 0-3)
    return [
      `## ETL Analysis Setup for ${hostApp}`,
      "",
      "### Extract & Filter (single-pass, ~20-30s via TraceEvent)",
      "```powershell",
      `$outDir = "${outputDir}"`,
      `New-Item -ItemType Directory -Path $outDir -Force | Out-Null`,
      ``,
      `# Fast extraction using TraceEvent — replaces xperf dumper + Select-String`,
      `# Single pass extracts both filtered events and feature flags`,
      `& "${etlExtractPath}" "${etlPath}" "${hostApp}" "$outDir\\filtered.txt" --feature-flags "$outDir\\feature_flags.txt"`,
      ``,
      `$filtered = "$outDir\\filtered.txt"`,
      `$featureFlags = "$outDir\\feature_flags.txt"`,
      "```",
      "",
      "### Parse Feature Flags",
      "```powershell",
      `Write-Host "=== ENABLED FEATURES ==="`,
      `Select-String -Path $featureFlags -Pattern "enable-features[=:]([^\\s;]+)" -AllMatches | ForEach-Object {`,
      `  $_.Matches | ForEach-Object { $_.Groups[1].Value -split ',' } } | Sort-Object -Unique`,
      ``,
      `Write-Host "=== DISABLED FEATURES ==="`,
      `Select-String -Path $featureFlags -Pattern "disable-features[=:]([^\\s;]+)" -AllMatches | ForEach-Object {`,
      `  $_.Matches | ForEach-Object { $_.Groups[1].Value -split ',' } } | Sort-Object -Unique`,
      ``,
      `Write-Host "=== WebView2-SPECIFIC FLAGS ==="`,
      `Select-String -Path $featureFlags -Pattern "msWebView2\\w+|EdgeWebView\\w+|WebView2Feature\\w+" -AllMatches | ForEach-Object {`,
      `  $_.Matches | ForEach-Object { $_.Value } } | Sort-Object -Unique`,
      "```",
      "",
      "### Process Discovery",
      "```powershell",
      `Select-String -Path $filtered -Pattern "${hostApp}" | ForEach-Object { if ($_.Line -match '${hostApp}\\.exe\\s*\\((\\d+)\\)') { $matches[1] } } | Sort-Object -Unique`,
      `Select-String -Path $filtered -Pattern "msedgewebview2" | ForEach-Object { if ($_.Line -match 'msedgewebview2\\.exe.*?\\((\\d+)\\)') { $matches[1] } } | Sort-Object -Unique`,
      "```",
      "",
      "### Build Timeline",
      "```powershell",
      `Select-String -Path $filtered -Pattern "WebView2_Creation_Client|WebView2_APICalled|WebView2_Event|NavigationRequest|WebView2_CreationFailure|WebView2_BrowserProcessFailure" |`,
      `  Sort-Object { if ($_.Line -match ',\\s*(\\d+)') { [long]$matches[1] } } |`,
      `  Select-Object -First 100`,
      "```",
      "",
      "### Next Steps",
      "After running the above, use these tools:",
      "- `validate_trace` — validate API calls against expected happy-path sequences",
      "- `decode_api_id` — to decode API IDs from WebView2_APICalled events",
      "- `lookup_event` — to understand unfamiliar events",
      "- `diagnose` — if you spot a symptom (stuck, crash, slow_init, etc.)",
      "- `timeline_slice` — to zoom into a specific time window",
    ].join("\n");
  }

  // Legacy fallback: xperf-based extraction (slow, two passes)
  return [
    `## ETL Analysis Setup for ${hostApp} (xperf — legacy mode)`,
    "",
    "### Step 1: Set Variables",
    "```powershell",
    `$etl = "${etlPath}"`,
    `$outDir = "${outputDir}"`,
    `$hostApp = "${hostApp}"`,
    `$xperf = "${XPERF_PATH}"`,
    `$env:_NT_SYMBOL_PATH = "srv*C:\\Symbols*http://msdl.microsoft.com/download/symbols"`,
    `$filtered = "$outDir\\filtered.txt"`,
    `$featureFlags = "$outDir\\feature_flags.txt"`,
    `New-Item -ItemType Directory -Path $outDir -Force | Out-Null`,
    "```",
    "",
    ...generatePreprocessStep("$etl", outputDir),
    "### Step 2: Extract & Filter (run this — may take 5-15 min)",
    "```powershell",
    `& $xperf -i $etl -quiet -a dumper 2>$null |`,
    `  Select-String -Pattern "$hostApp|WebView2_|msedgewebview2|NavigationRequest|ServiceWorker|TokenBroker|WebTokenRequest|BrowserMain|DocumentLoader|RendererMain|v8\\." |`,
    `  Where-Object { $_.Line -notmatch "Process Name \\( PID\\)" } |`,
    `  Out-File $filtered -Encoding utf8`,
    `Write-Host "Done: $((Get-Content $filtered | Measure-Object).Count) lines"`,
    "```",
    "",
    "### Step 3: Extract Feature Flags & Experiments",
    "```powershell",
    `& $xperf -i $etl -quiet -a dumper 2>$null |`,
    `  Select-String -Pattern "enable-features|disable-features|field-trial|msWebView2|EdgeWebView|WebView2Feature|ExperimentalFeature|FeatureList|CommandLine|Process/Start" |`,
    `  Out-File $featureFlags -Encoding utf8`,
    ``,
    `Write-Host "=== ENABLED FEATURES ==="`,
    `Select-String -Path $featureFlags -Pattern "enable-features[=:]([^\\s;]+)" -AllMatches | ForEach-Object {`,
    `  $_.Matches | ForEach-Object { $_.Groups[1].Value -split ',' } } | Sort-Object -Unique`,
    ``,
    `Write-Host "=== DISABLED FEATURES ==="`,
    `Select-String -Path $featureFlags -Pattern "disable-features[=:]([^\\s;]+)" -AllMatches | ForEach-Object {`,
    `  $_.Matches | ForEach-Object { $_.Groups[1].Value -split ',' } } | Sort-Object -Unique`,
    ``,
    `Write-Host "=== WebView2-SPECIFIC FLAGS ==="`,
    `Select-String -Path $featureFlags -Pattern "msWebView2\\w+|EdgeWebView\\w+|WebView2Feature\\w+" -AllMatches | ForEach-Object {`,
    `  $_.Matches | ForEach-Object { $_.Value } } | Sort-Object -Unique`,
    "```",
    "",
    "### Step 4: Process Discovery",
    "```powershell",
    `Select-String -Path $filtered -Pattern "${hostApp}" | ForEach-Object { if ($_.Line -match '${hostApp}\\.exe\\s*\\((\\d+)\\)') { $matches[1] } } | Sort-Object -Unique`,
    `Select-String -Path $filtered -Pattern "msedgewebview2" | ForEach-Object { if ($_.Line -match 'msedgewebview2\\.exe.*?\\((\\d+)\\)') { $matches[1] } } | Sort-Object -Unique`,
    "```",
    "",
    "### Step 5: Build Timeline",
    "```powershell",
    `Select-String -Path $filtered -Pattern "WebView2_Creation_Client|WebView2_APICalled|WebView2_Event|NavigationRequest::(Create|CommitNavigation|DidCommitNavigation|OnRequestFailed)|WebView2_CreationFailure|WebView2_BrowserProcessFailure" |`,
    `  Sort-Object { if ($_.Line -match ',\\s*(\\d+)') { [long]$matches[1] } } |`,
    `  Select-Object -First 100`,
    "```",
    "",
    "### Next Steps",
    "After running the above, use these tools:",
    "- `validate_trace` — validate API calls against expected happy-path sequences",
    "- `decode_api_id` — to decode API IDs from WebView2_APICalled events",
    "- `lookup_event` — to understand unfamiliar events",
    "- `diagnose` — if you spot a symptom (stuck, crash, slow_init, etc.)",
    "- `timeline_slice` — to zoom into a specific time window",
  ].join("\n");
}

export function generateFilterCommand(etlPath: string, hostApp: string, additionalPatterns?: string[]): string {
  const etlExtractPath = getEtlExtractPath();
  if (existsSync(etlExtractPath)) {
    return [
      "```powershell",
      `& "${etlExtractPath}" "${etlPath}" "${hostApp}" "C:\\temp\\etl_analysis\\filtered.txt" --feature-flags "C:\\temp\\etl_analysis\\feature_flags.txt"`,
      "```",
    ].join("\n");
  }

  // Legacy xperf fallback
  const patterns = [
    hostApp,
    "WebView2_",
    "msedgewebview2",
    "NavigationRequest",
    "ServiceWorker",
    "TokenBroker",
    "WebTokenRequest",
    "BrowserMain",
    "DocumentLoader",
    "RendererMain",
    "v8\\.",
    ...(additionalPatterns || []),
  ];

  return [
    "```powershell",
    `& "${XPERF_PATH}" -i "${etlPath}" -quiet -a dumper 2>$null |`,
    `  Select-String -Pattern "${patterns.join("|")}" |`,
    `  Where-Object { $_.Line -notmatch "Process Name \\( PID\\)" } |`,
    `  Out-File "C:\\temp\\etl_analysis\\filtered.txt" -Encoding utf8`,
    "```",
  ].join("\n");
}
