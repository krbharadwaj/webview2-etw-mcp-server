import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { generatePreprocessStep } from "./etlx_cache.js";

const XPERF_PATH = "C:\\Program Files (x86)\\Windows Kits\\10\\Windows Performance Toolkit\\xperf.exe";

// TraceEvent-based extractor (fast, single-pass, no xperf text dump)
function getEtlExtractPath(): string | null {
  // Try multiple locations in priority order
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // 1. Dev/source layout: src/tools/ or dist/tools/ → ../../tools/etl-extract/bin/
    join(thisDir, "..", "..", "tools", "etl-extract", "bin", "EtlExtract.exe"),
    // 2. npm package layout: dist/ → ../tools/etl-extract/bin/
    join(thisDir, "..", "tools", "etl-extract", "bin", "EtlExtract.exe"),
    // 3. User's source checkout
    join(homedir(), "source", "webview2-etw-mcp-server", "tools", "etl-extract", "bin", "EtlExtract.exe"),
    // 4. C:\temp checkout (common for linked installs)
    "C:\\temp\\webview2-etw-mcp-server\\tools\\etl-extract\\bin\\EtlExtract.exe",
    // 5. Published self-contained output
    join(thisDir, "..", "..", "tools", "etl-extract", "EtlExtract", "bin", "Release", "net10.0", "win-x64", "EtlExtract.exe"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
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

export function analyzeEtl(etlPath: string, hostApp: string, outDir?: string, pid?: string): string {
  if (!existsSync(etlPath)) {
    return `❌ ETL file not found: ${etlPath}`;
  }

  const outputDir = outDir || "C:\\temp\\etl_analysis";
  const etlExtractPath = getEtlExtractPath();
  const useTraceEvent = etlExtractPath !== null;

  if (!useTraceEvent && !existsSync(XPERF_PATH)) {
    return [
      "❌ No ETL extraction tool found.",
      "",
      "Option 1 (recommended — handles all ETL formats including compressed/relogged):",
      "  Build the TraceEvent extractor:",
      "  cd tools/etl-extract/EtlExtract && dotnet publish -c Release -r win-x64 --self-contained false -o ../bin",
      "",
      "Option 2 (legacy — may fail on compressed/relogged ETL files):",
      "  Install Windows Performance Toolkit from Windows SDK:",
      "  https://developer.microsoft.com/en-us/windows/downloads/windows-sdk/",
      "",
      "⚠️ Note: xperf cannot handle 'Sequential Relogged Compressed' ETL files",
      "  (common with WPR captures, SearchHost, and Windows system traces).",
      "  Use Option 1 for reliable extraction of all ETL formats.",
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
      `& "${etlExtractPath}" "${etlPath}" "${hostApp}" "$outDir\\filtered.txt" --feature-flags "$outDir\\feature_flags.txt"${pid ? ` --pid ${pid}` : ""}`,
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
  // WARNING: xperf cannot decode TraceLogging event names without registered manifests.
  // WebView2 uses TraceLogging — names like "WebView2_APICalled" are embedded in the ETL
  // but xperf may not resolve them on machines without Edge installed.
  return [
    `## ETL Analysis Setup for ${hostApp} (xperf — legacy mode)`,
    "",
    "### ⚠️ IMPORTANT: xperf Limitations",
    "",
    "**xperf may not resolve WebView2 event names** on machines without Edge/WebView2 Runtime installed.",
    "WebView2 uses TraceLogging (self-describing events), but xperf requires the provider to be",
    "registered on the analysis machine. If you see GUID-based event names (e.g., `e34441d9/EventID(5)`)",
    "instead of `WebView2_APICalled`, **build the TraceEvent extractor** for reliable analysis:",
    "",
    "```powershell",
    "cd tools/etl-extract/EtlExtract && dotnet publish -c Release -r win-x64 --self-contained true -o ../bin",
    "```",
    "",
    "The TraceEvent-based extractor uses Microsoft.Diagnostics.Tracing.TraceEvent which properly",
    "decodes TraceLogging metadata embedded in the ETL — no manifest registration needed.",
    "",
    "---",
    "",
    "If Step 2 produces 0 lines or only GUID-based names, see the **Fallback** section below.",
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
    ``,
    `# Verify extraction produced output`,
    `$lineCount = (Get-Content $filtered -ErrorAction SilentlyContinue | Measure-Object).Count`,
    `if ($lineCount -eq 0) {`,
    `  Write-Host "❌ xperf produced 0 lines. This ETL may be in a format xperf cannot handle." -ForegroundColor Red`,
    `  Write-Host "   Common cause: 'Sequential Relogged Compressed' format (WPR captures, SearchHost traces)." -ForegroundColor Yellow`,
    `  Write-Host "   → Use the TraceEvent-based extractor instead (see Fallback section below)." -ForegroundColor Yellow`,
    `} else {`,
    `  Write-Host "Done: $lineCount lines"`,
    `}`,
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
    "### 🔄 Fallback: Build TraceEvent Extractor (if xperf fails)",
    "",
    "If xperf produced 0 lines, the ETL is likely in a compressed/relogged format.",
    "Build the TraceEvent-based extractor which handles **all** ETL formats:",
    "",
    "```powershell",
    `# Option A: Build from source (requires .NET SDK)`,
    `$mcpDir = (npm root -g) + "\\webview2-etw-mcp-server"`,
    `if (Test-Path "$mcpDir\\tools\\etl-extract\\EtlExtract\\EtlExtract.csproj") {`,
    `  Push-Location "$mcpDir\\tools\\etl-extract\\EtlExtract"`,
    `  dotnet publish -c Release -r win-x64 --self-contained false -o ../bin`,
    `  Pop-Location`,
    `  # Now re-run extraction with the fast extractor:`,
    `  & "$mcpDir\\tools\\etl-extract\\bin\\EtlExtract.exe" "${etlPath}" "${hostApp}" "$outDir\\filtered.txt" --feature-flags "$outDir\\feature_flags.txt"`,
    `} else {`,
    `  Write-Host "Source not found. Clone and build manually:" -ForegroundColor Yellow`,
    `  Write-Host "  git clone https://github.com/krbharadwaj/webview2-etw-mcp-server.git C:\\temp\\webview2-etw-mcp-server"`,
    `  Write-Host "  cd C:\\temp\\webview2-etw-mcp-server\\tools\\etl-extract\\EtlExtract"`,
    `  Write-Host "  dotnet publish -c Release -r win-x64 --self-contained false -o ../bin"`,
    `}`,
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
  if (etlExtractPath) {
    return [
      "```powershell",
      `& "${etlExtractPath}" "${etlPath}" "${hostApp}" "C:\\temp\\etl_analysis\\filtered.txt" --feature-flags "C:\\temp\\etl_analysis\\feature_flags.txt"`,
      "```",
    ].join("\n");
  }

  // Legacy xperf fallback — warn about potential format issues
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
    "⚠️ Using xperf fallback — may fail on compressed/relogged ETL files.",
    "If extraction produces 0 lines, build the TraceEvent extractor:",
    "  `cd tools/etl-extract/EtlExtract && dotnet publish -c Release -r win-x64 --self-contained false -o ../bin`",
    "",
    "```powershell",
    `& "${XPERF_PATH}" -i "${etlPath}" -quiet -a dumper 2>$null |`,
    `  Select-String -Pattern "${patterns.join("|")}" |`,
    `  Where-Object { $_.Line -notmatch "Process Name \\( PID\\)" } |`,
    `  Out-File "C:\\temp\\etl_analysis\\filtered.txt" -Encoding utf8`,
    ``,
    `# Verify extraction succeeded`,
    `$count = (Get-Content "C:\\temp\\etl_analysis\\filtered.txt" -ErrorAction SilentlyContinue | Measure-Object).Count`,
    `if ($count -eq 0) { Write-Host "❌ xperf produced 0 lines — ETL may be compressed/relogged. Build TraceEvent extractor instead." -ForegroundColor Red }`,
    `else { Write-Host "✅ Extracted $count lines" }`,
    "```",
  ].join("\n");
}
