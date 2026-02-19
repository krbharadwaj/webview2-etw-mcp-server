import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";

const XPERF_PATH = "C:\\Program Files (x86)\\Windows Kits\\10\\Windows Performance Toolkit\\xperf.exe";

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

  if (!existsSync(XPERF_PATH)) {
    return [
      "❌ xperf not found at expected path.",
      "",
      "Install Windows Performance Toolkit from Windows SDK:",
      "https://developer.microsoft.com/en-us/windows/downloads/windows-sdk/",
      "",
      "Or set XPERF_PATH environment variable to your xperf.exe location.",
    ].join("\n");
  }

  const outputDir = outDir || "C:\\temp\\etl_analysis";

  // Generate the analysis commands — don't execute directly (ETL analysis is slow)
  return [
    `## ETL Analysis Setup for ${hostApp}`,
    "",
    "### Step 1: Set Variables",
    "```powershell",
    `$etl = "${etlPath}"`,
    `$outDir = "${outputDir}"`,
    `$hostApp = "${hostApp}"`,
    `$xperf = "${XPERF_PATH}"`,
    `$env:_NT_SYMBOL_PATH = "srv*C:\\Symbols*http://msdl.microsoft.com/download/symbols"`,
    `$filtered = "$outDir\\filtered.txt"`,
    `New-Item -ItemType Directory -Path $outDir -Force | Out-Null`,
    "```",
    "",
    "### Step 2: Extract & Filter (run this — may take 5-15 min)",
    "```powershell",
    `& $xperf -i $etl -quiet -a dumper 2>$null |`,
    `  Select-String -Pattern "$hostApp|WebView2_|msedgewebview2|NavigationRequest|ServiceWorker|TokenBroker|WebTokenRequest|BrowserMain|DocumentLoader|RendererMain|v8\\." |`,
    `  Where-Object { $_.Line -notmatch "Process Name \\( PID\\)" } |`,
    `  Out-File $filtered -Encoding utf8`,
    `Write-Host "Done: $((Get-Content $filtered | Measure-Object).Count) lines"`,
    "```",
    "",
    "### Step 3: Process Discovery",
    "```powershell",
    `# Find host app PIDs`,
    `Select-String -Path $filtered -Pattern "${hostApp}" | ForEach-Object { if ($_.Line -match '${hostApp}\\.exe\\s*\\((\\d+)\\)') { $matches[1] } } | Sort-Object -Unique`,
    "",
    `# Find WebView2 PIDs`,
    `Select-String -Path $filtered -Pattern "msedgewebview2" | ForEach-Object { if ($_.Line -match 'msedgewebview2\\.exe.*?\\((\\d+)\\)') { $matches[1] } } | Sort-Object -Unique`,
    "```",
    "",
    "### Step 4: Build Timeline",
    "```powershell",
    `# Key lifecycle events (replace PID with actual)`,
    `Select-String -Path $filtered -Pattern "WebView2_Creation_Client|WebView2_APICalled|WebView2_Event|NavigationRequest::(Create|CommitNavigation|DidCommitNavigation|OnRequestFailed)|WebView2_CreationFailure|WebView2_BrowserProcessFailure" |`,
    `  Sort-Object { if ($_.Line -match ',\\s*(\\d+)') { [long]$matches[1] } } |`,
    `  Select-Object -First 100`,
    "```",
    "",
    "### Next Steps",
    "After running the above, use these tools:",
    "- `decode_api_id` — to decode API IDs from WebView2_APICalled events",
    "- `lookup_event` — to understand unfamiliar events",
    "- `diagnose` — if you spot a symptom (stuck, crash, slow_init, etc.)",
    "- `contribute` — to add newly discovered events or root causes",
  ].join("\n");
}

export function generateFilterCommand(etlPath: string, hostApp: string, additionalPatterns?: string[]): string {
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
