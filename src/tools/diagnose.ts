import { loadJson, type RootCauseEntry, type TimingBaseline } from "../knowledge/loader.js";

const rootCauses = loadJson<Record<string, RootCauseEntry>>("root_causes.json");
const timingBaselines = loadJson<Record<string, TimingBaseline>>("timing_baselines.json");

type Symptom = "stuck" | "crash" | "slow_init" | "slow_navigation" | "auth_failure" | "blank_page" | "event_missing";

const symptomDecisionTrees: Record<Symptom, string> = {
  stuck: `## Diagnosis: App Stuck / Hung

### Decision Tree
\`\`\`
1. Is there a WebView2_APICalled with API=3 (Navigate)?
   → YES: Navigation was initiated → check NavigationRequest events
   → NO: Host never called Navigate → check what host is waiting for

2. Is there WebView2_Creation_Client END with hr=0?
   → YES: WebView2 created successfully → check event handler timing
   → NO: Creation failed → check WebView2_CreationFailure events

3. Was WebView2_Event (NavigationCompletedHandler) fired?
   → YES: Event fired but host didn't process it → check host-side handlers
   → NO: NavigationCompleted was suppressed → likely about:blank suppression issue

4. Check for WebView2_RendererUnresponsive events
   → PRESENT: Renderer hung → check for infinite loops, heavy JS
   → ABSENT: Not a renderer issue
\`\`\`

### Known Root Causes
${formatRootCause("navigation_deadlock_about_blank")}
${formatRootCause("event_handler_registration_race")}

### Commands to Run
\`\`\`powershell
# Check for Navigate API calls
Select-String -Path $filtered -Pattern "WebView2_APICalled" | Select-String "Field 1 = 3[^0-9]"

# Check for NavigationCompleted events
Select-String -Path $filtered -Pattern "NavigationCompleted"

# Check for stuck indicators
Select-String -Path $filtered -Pattern "RendererUnresponsive|Timeout|ActivityFailure"
\`\`\``,

  crash: `## Diagnosis: Crash / Process Failure

### Decision Tree
\`\`\`
1. Is there WebView2_BrowserProcessFailure?
   → YES: Browser process crashed → check ProcessFailureTypeWithReason
   → NO: Not a browser crash → check renderer or host

2. Is there WebView2_ProcessExited with unexpected timing?
   → YES: Process exited prematurely → check exit code
   → NO: Clean exit

3. Check WebView2_ProcessFailureTypeWithExitCode
   → Exit code = -1073741819 (0xC0000005): Access violation
   → Exit code = -1073741676 (0xC0000094): Division by zero
   → Other: Look up the NTSTATUS code
\`\`\`

### Commands to Run
\`\`\`powershell
Select-String -Path $filtered -Pattern "BrowserProcessFailure|ProcessExited|ProcessFailure|crash"
\`\`\``,

  slow_init: `## Diagnosis: Slow Initialization

### Decision Tree
\`\`\`
1. Check WebView2_WebViewProcessLaunchType
   → 0 (cold start): Expected to be slow (${formatBaseline("creation_client_cold_start")})
   → 1 (warm start): Should be fast (${formatBaseline("creation_client_warm_start")})

2. Measure WebView2_Creation_Client (BEGIN → END) duration
   → Within baseline: Normal
   → Exceeds p95: Check for DLL loading delays, VDI environment

3. Check for VDI indicators
   → PvsVmAgent.exe, BrokerAgent.exe, vmtoolsd.exe present: VDI environment
   → Look for large gaps in OnModuleEvent (DLL loading)
\`\`\`

### Known Root Causes
${formatRootCause("cold_start_timeout")}

### Commands to Run
\`\`\`powershell
Select-String -Path $filtered -Pattern "WebViewProcessLaunchType|Creation_Client|CreationTime"
\`\`\``,

  slow_navigation: `## Diagnosis: Slow Navigation

### Decision Tree
\`\`\`
1. Measure NavigationRequest::Create → DidCommitNavigation duration
   → Compare with baselines:
     Same-origin: ${formatBaseline("navigation_total_same_origin")}
     Cross-origin: ${formatBaseline("navigation_total_cross_origin")}

2. Check which phase is slow:
   → BeginNavigation → CommitNavigation: Network/server delay
   → CommitNavigation → DidCommit (browser): DLL loading, VDI
   → CommitNavigation → DidCommit (renderer): JS execution, large DOM

3. Is ServiceWorker involved?
   → Check ForwardServiceWorkerToWorkerReady duration
   → SW activation: ${formatBaseline("service_worker_activation")}
\`\`\`

### Commands to Run
\`\`\`powershell
Select-String -Path $filtered -Pattern "NavigationRequest|NavigationTotal|ServiceWorker"
\`\`\``,

  auth_failure: `## Diagnosis: Authentication Failure

### Decision Tree
\`\`\`
1. Check for WAM events:
   → WebTokenRequestResultOperation_ActivityStop with status != 0
   → Status 1 = UserCancel, 2 = ProviderError, 3 = UserInteractionRequired

2. Check for token errors:
   → WebView2_GetAccessToken_Failed
   → HRESULT 0x80190191 = 401 Unauthorized
   → HRESULT 0x800704CF = Network unreachable

3. Is it a network issue?
   → Check for connectivity events and DNS resolution
\`\`\`

### Known Root Causes
${formatRootCause("wam_token_failure")}

### Commands to Run
\`\`\`powershell
Select-String -Path $filtered -Pattern "TokenBroker|WebTokenRequest|GetAccessToken|Authentication"
\`\`\``,

  blank_page: `## Diagnosis: Blank Page / No Content

### Decision Tree
\`\`\`
1. Did Navigate API (ID=3) fire?
   → YES: Navigation initiated → check NavigationRequest
   → NO: Host never navigated → check host initialization flow

2. Did NavigationRequest::CommitNavigation happen?
   → YES: Content committed → check renderer (JS errors, resource failures)
   → NO: Navigation didn't commit → check for redirects, blocks, errors

3. Check for WebView2_ResponseLoadingBlocked / Canceled
   → PRESENT: Content was blocked → check WebResourceRequested filters
   → ABSENT: Not a blocking issue

4. Check for ContentLoading event
   → PRESENT: Page started loading → check for JS errors
   → ABSENT: Page never loaded → check NavigationRequest::OnRequestFailedInternal
\`\`\``,

  event_missing: `## Diagnosis: Expected Event Not Firing

### Decision Tree
\`\`\`
1. Is the event handler registered (add_* API called)?
   → YES: Check timestamp — was it registered BEFORE the event should fire?
   → NO: Handler not registered → that's why event is missing

2. Is the event suppressed?
   → about:blank events: ALL suppressed via initializing_navigation_id_
   → Check IsEdgeWebViewCancelInitialNavigationEnabled flag

3. Was the event fired but dropped?
   → Check for WebView2_DroppedEvent or WebView2_NoEventDispatcher
   → PRESENT: Event was generated but couldn't be delivered

4. Is the navigation ID correct?
   → Check for WebView2_DifferentNavigationId
   → PRESENT: Navigation ID mismatch → stale navigation
\`\`\`

### Known Root Causes
${formatRootCause("event_handler_registration_race")}`,
};

function formatRootCause(key: string): string {
  const rc = rootCauses[key];
  if (!rc) return "";
  return [
    `#### ${rc.classification}`,
    `- **Symptom**: ${rc.symptom}`,
    `- **Root Cause**: ${rc.rootCause}`,
    `- **Evidence**: ${rc.evidence.join("; ")}`,
    `- **Resolution**: ${rc.resolution.join(" | ")}`,
    "",
  ].join("\n");
}

function formatBaseline(key: string): string {
  const b = timingBaselines[key];
  if (!b) return "no baseline";
  return `p50=${b.p50_ms}ms, p95=${b.p95_ms}ms, p99=${b.p99_ms}ms`;
}

export function diagnose(symptom: string): string {
  const key = symptom.toLowerCase().replace(/[\s-]/g, "_") as Symptom;
  const tree = symptomDecisionTrees[key];
  if (tree) {
    return tree;
  }

  // Fuzzy match
  const available = Object.keys(symptomDecisionTrees);
  const partial = available.filter(k => k.includes(key) || key.includes(k));
  if (partial.length > 0) {
    return symptomDecisionTrees[partial[0] as Symptom];
  }

  return [
    `Unknown symptom: "${symptom}"`,
    "",
    "Available symptoms:",
    ...available.map(s => `  - **${s}**: ${getSymptomDescription(s as Symptom)}`),
  ].join("\n");
}

function getSymptomDescription(s: Symptom): string {
  const descriptions: Record<Symptom, string> = {
    stuck: "App is hung/frozen, not responding",
    crash: "Process crashed or exited unexpectedly",
    slow_init: "WebView2 takes too long to initialize",
    slow_navigation: "Page navigation is slow",
    auth_failure: "Authentication or token acquisition fails",
    blank_page: "Page shows blank/white content",
    event_missing: "Expected WebView2 event doesn't fire",
  };
  return descriptions[s];
}

export function listRootCauses(): string {
  const lines = ["## Known Root Causes", "", "| Key | Classification | Symptom |", "|-----|---------------|---------|"];
  for (const [key, rc] of Object.entries(rootCauses)) {
    lines.push(`| ${key} | ${rc.classification} | ${rc.symptom} |`);
  }
  return lines.join("\n");
}
