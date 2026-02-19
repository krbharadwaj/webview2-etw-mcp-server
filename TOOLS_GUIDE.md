# WebView2 ETW Analysis MCP Server — Tool Reference Guide

> **How to use**: Just talk to Copilot in plain English. These tools activate automatically
> based on what you ask. You never need to type JSON — just describe what you need.

---

## 1. `decode_api_id`

**What it does**: Translates the numeric API IDs you see in ETL traces into human-readable names.

**When you need it**: You're looking at an ETL dump and see something like `WebView2_APICalled, Field1=33` — what is API 33?

### Just ask Copilot:

| What you say | What happens |
|-------------|-------------|
| *"What is API ID 33?"* | Returns: AddNavigationStarting ★ NAVIGATION-CRITICAL |
| *"Decode API 3"* | Returns: Navigate ★ NAVIGATION-CRITICAL |
| *"I see these API IDs in the trace: 3, 7, 11, 33, 37. What are they?"* | Returns a table with all 5 decoded |
| *"Show me all navigation-related APIs"* | Lists every API in the Navigation category |
| *"What API IDs should I look for when debugging event registration?"* | Lists all EventRegistration category APIs |
| *"I see Field1=173 in WebView2_APICalled. What API is that?"* | Returns: ExecuteScriptWithResult |

### What you get back

```
API ID 33: AddNavigationStarting ★ NAVIGATION-CRITICAL
Category: EventRegistration

Use in ETW: Look for WebView2_APICalled events where Field1 = 33
```

### Common API IDs Quick Reference
| ID | Name | ID | Name |
|----|------|----|------|
| 3 | Navigate | 33 | AddNavigationStarting |
| 7 | Initialize | 37 | AddNavigationCompleted |
| 9 | Reload | 77 | AddContentLoading |
| 21 | GoBack | 93 | AddDOMContentLoaded |
| 23 | Stop | 95 | NavigateWithWebResourceRequest |

---

## 2. `lookup_event`

**What it does**: Explains any WebView2 ETW event — what it means, what its fields contain, how severe it is, and what related events to look for.

**When you need it**: You see an event like `WebView2_DifferentNavigationId` in your trace and have no idea what it means.

### Just ask Copilot:

| What you say | What happens |
|-------------|-------------|
| *"What is WebView2_DifferentNavigationId?"* | Full description, severity, params, related events |
| *"Tell me about WebView2_FactoryCreate"* | Description, category, severity, related events |
| *"I see an event called Creation_Client in my trace. What is it?"* | Partial match — finds WebView2_Creation_Client |
| *"What WebView2 events are related to creation?"* | Fuzzy match — lists all 5 creation-related events |
| *"Show me all navigation events in the knowledge base"* | Lists all events in the Navigation category |
| *"Show me all error-level WebView2 events"* | Lists events in the Error category |
| *"I found WebView2_SomeNewThing in my trace but I don't know what it is"* | If not in KB: tells you how to find it in source code |

### What you get back

```
## WebView2_DifferentNavigationId

Description: Navigation ID mismatch — may indicate stale navigation
Category: Navigation
Severity: Warning
Related Events: WebView2_NewNavigationContext
```

If the event isn't in the knowledge base, you'll get:
```
❌ Event "WebView2_SomeNewThing" not found in knowledge base.

To discover this event:
1. Search codebase: grep -r "TRACE_EVENT.*SomeNewThing" --include="*.cc"
2. Use contribute_event tool to add it after you find the source definition
```

---

## 3. `diagnose`

**What it does**: Gives you a step-by-step investigation playbook for a specific WebView2 problem. Includes decision trees, known root causes from past analyses, and ready-to-run PowerShell commands.

**When you need it**: You know the *symptom* (e.g., "app is stuck") but don't know *where to start looking*.

### Just ask Copilot:

| What you say | What happens |
|-------------|-------------|
| *"My WebView2 app is stuck, help me diagnose"* | Full decision tree for "stuck" with commands |
| *"WebView2 is crashing, what should I check?"* | Decision tree for "crash" with exit code lookup |
| *"WebView2 is taking forever to initialize"* | Decision tree for "slow_init" with timing baselines |
| *"Page is loading slowly in WebView2"* | Decision tree for "slow_navigation" with phase breakdown |
| *"Authentication is failing in my WebView2 app"* | Decision tree for "auth_failure" with WAM event checks |
| *"WebView2 shows a blank page, nothing loads"* | Decision tree for "blank_page" with content checks |
| *"NavigationCompleted event is not firing"* | Decision tree for "event_missing" with suppression checks |
| *"What root causes have been found so far?"* | Lists all known root causes in the knowledge base |

### Available symptoms
`stuck` · `crash` · `slow_init` · `slow_navigation` · `auth_failure` · `blank_page` · `event_missing`

### What you get back (example for "stuck")

```
## Diagnosis: App Stuck / Hung

### Decision Tree
1. Is there a WebView2_APICalled with API=3 (Navigate)?
   → YES: Navigation was initiated → check NavigationRequest events
   → NO: Host never called Navigate → check what host is waiting for

2. Is there WebView2_Creation_Client END with hr=0?
   → YES: WebView2 created successfully → check event handler timing
   → NO: Creation failed → check WebView2_CreationFailure events

3. Was WebView2_Event (NavigationCompletedHandler) fired?
   → YES: Event fired but host didn't process it
   → NO: NavigationCompleted was suppressed → likely about:blank issue

### Known Root Causes
- Navigation Deadlock (about:blank suppression)
- Event Handler Registration Race

### Commands to Run
Select-String -Path $filtered -Pattern "WebView2_APICalled" | Select-String "Field 1 = 3"
```

---

## 4. `analyze_etl`

**What it does**: Generates a complete set of copy-paste PowerShell commands to start analyzing an ETL file. Sets up variables, runs the xperf extraction, discovers processes, and builds a timeline — all pre-configured for your specific file and app.

**When you need it**: Someone gives you a new ETL file and you want to get started immediately without manually constructing xperf commands.

### Just ask Copilot:

| What you say | What happens |
|-------------|-------------|
| *"Analyze the ETL at C:\traces\issue.etl for Teams"* | Full command set for Teams app |
| *"Help me start analyzing C:\Users\me\Desktop\crash.etl, the host app is Outlook"* | Full command set for Outlook |
| *"I have a SearchHost ETL at C:\temp\searchtrace.etl, generate analysis commands"* | Full command set for SearchHost |
| *"Analyze C:\traces\test.etl for MyApp and also filter for XAML and Cortana events"* | Commands with extra filter patterns |
| *"Set up ETL analysis for PowerBI, output to C:\analysis\powerbi"* | Commands with custom output directory |

### What you get back

```
## ETL Analysis Setup for Teams

### Step 1: Set Variables
$etl = "C:\traces\issue.etl"
$hostApp = "Teams"
$xperf = "C:\Program Files (x86)\Windows Kits\10\..."
$env:_NT_SYMBOL_PATH = "srv*C:\Symbols*http://msdl.microsoft.com/..."

### Step 2: Extract & Filter (run this — may take 5-15 min)
& $xperf -i $etl -quiet -a dumper 2>$null |
  Select-String -Pattern "Teams|WebView2_|msedgewebview2|..." |
  Out-File $filtered

### Step 3: Process Discovery
# Find host app PIDs
# Find WebView2 PIDs

### Step 4: Build Timeline
# Key lifecycle events sorted by timestamp

### Next Steps
- Use decode_api_id to decode API IDs
- Use lookup_event for unfamiliar events
- Use diagnose if you spot a symptom
```

---

## 5. `compare_incarnations`

**What it does**: Takes event lines from a SUCCESS session and a FAILURE session, puts them side-by-side, and highlights exactly where the failure diverges from the working path.

**When you need it**: Your trace has both a working instance (PID 1234) and a broken instance (PID 5678) of the same app, and you want to find the exact moment things went wrong.

### Just ask Copilot:

| What you say | What happens |
|-------------|-------------|
| *"Compare these two incarnations: [paste success events] vs [paste failure events]"* | Side-by-side table with divergence point |
| *"I have events from PID 1234 (success) and PID 5678 (failure), compare them"* | After you provide the events: comparison table |
| *"How do I get the event data to compare incarnations?"* | Instructions for extracting events per PID |

### How to prepare the data

Before asking for comparison, run these commands to extract events per PID:

```powershell
# Get events for the SUCCESS PID (replace 1234 with actual PID)
Select-String -Path $filtered -Pattern "WebView2_APICalled|WebView2_Event|WebView2_Creation|NavigationRequest" |
  Select-String "(1234)" | Out-File C:\temp\success_events.txt

# Get events for the FAILURE PID (replace 5678 with actual PID)
Select-String -Path $filtered -Pattern "WebView2_APICalled|WebView2_Event|WebView2_Creation|NavigationRequest" |
  Select-String "(5678)" | Out-File C:\temp\failure_events.txt
```

Then tell Copilot: *"Compare the success events in C:\temp\success_events.txt with the failure events in C:\temp\failure_events.txt"*

### What you get back

```
## Incarnation Comparison
SUCCESS: 15 events | FAILURE: 8 events

| # | SUCCESS Event       | Δ(ms) | FAILURE Event       | Δ(ms) | Match |
|---|---------------------|-------|---------------------|-------|-------|
| 1 | WebView2_Creation   | +0    | WebView2_Creation   | +0    | ✅    |
| 2 | WebView2_APICalled  | +50   | WebView2_APICalled  | +3700 | ✅    |
| 3 | WebView2_APICalled  | +60   | —                   | —     | ❌    |

### ⚠️ First Divergence at Event #3
- SUCCESS: WebView2_APICalled (Navigate) at Δ60ms
- FAILURE: MISSING

This is likely where the root cause begins.
```

---

## 6. `contribute_event`

**What it does**: Adds a newly discovered event to the knowledge base so that `lookup_event` can find it in future analyses. If the event already exists, it merges new info without overwriting.

**When you need it**: During analysis you found an event that `lookup_event` didn't know about. You searched the source code, figured out what it means, and now want to save that knowledge.

### Just ask Copilot:

| What you say | What happens |
|-------------|-------------|
| *"Add WebView2_NavigationThrottled to the knowledge base. It means navigation was throttled by the throttle manager. It's a Warning in the Navigation category."* | Adds the event with those details |
| *"I found that WebView2_FactoryCreate is defined in webview_factory.cc. Add that source file info."* | Merges source file into existing event |
| *"Save this new event: WebView2_CustomFeature, it tracks when a custom feature flag is enabled, severity is Info, category is Debugging, my email is krbharadwaj@microsoft.com"* | Adds event with attribution |
| *"Add WebView2_NewEvent with parameters: Field 1 is navigationId (int64, the navigation ID), Field 2 is reason (string, why it happened)"* | Adds event with parameter documentation |

### What you get back

```
✅ Added new event WebView2_NavigationThrottled to knowledge base. Total events: 61
```
or
```
✅ Merged new info into existing event WebView2_FactoryCreate. Total events: 60
```
or (if nothing new to add)
```
ℹ️ Event WebView2_FactoryCreate already exists with same info. No changes made.
```

---

## 7. `contribute_root_cause`

**What it does**: Records a failure pattern you discovered during ETL analysis. Future `diagnose` calls will automatically include it in their decision trees.

**When you need it**: You've completed a full analysis, identified the root cause, and want to save it so the next person who hits the same issue gets the answer instantly.

### Just ask Copilot:

| What you say | What happens |
|-------------|-------------|
| *"Save a new root cause: key is 'sw_cold_start_timeout'. The symptom is 'First navigation to PWA takes over 10 seconds'. The root cause is 'Service worker cold activation is too slow on VDI machines'. Evidence: ForwardServiceWorkerToWorkerReady over 5000ms, VDI indicators present. Classification is Performance. Resolution: pre-warm service worker or bypass SW for initial navigation."* | Adds complete root cause entry |
| *"Record this root cause from my analysis of teams_vdi_trace.etl..."* | Saves with source ETL attribution |
| *"What root causes are already known?"* | Lists all existing entries (use `diagnose` with `list_root_causes`) |

### What you get back

```
✅ Added root cause 'sw_cold_start_timeout' to knowledge base. Total: 5
```

### Currently known root causes
| Key | What it is |
|-----|-----------|
| `navigation_deadlock_about_blank` | Host waits for suppressed NavigationCompleted |
| `event_handler_registration_race` | Handler registered after event already fired |
| `cold_start_timeout` | WebView2 cold start too slow (VDI, disk I/O) |
| `wam_token_failure` | WAM authentication fails or times out |

---

## 8. `contribute_timing`

**What it does**: Records a timing measurement from your analysis. Over time, these build up into statistical baselines (p50/p95/p99) that help detect anomalies automatically.

**When you need it**: You measured something like "about:blank completed in 1.67ms" or "creation took 3700ms on cold start" and want to record that observation.

### Just ask Copilot:

| What you say | What happens |
|-------------|-------------|
| *"Record that about:blank navigation took 1.67ms in this trace"* | Updates the about_blank_navigation baseline |
| *"WebView2 cold start creation took 3700ms, save that timing"* | Updates creation_client_cold_start baseline |
| *"I measured navigation to bing.com taking 2500ms on cold start. Save it as a new baseline called navigate_to_bing_cold"* | Creates a new baseline entry |
| *"The service worker activation took 450ms, add that to the baselines"* | Updates service_worker_activation baseline |

### What you get back

```
✅ Updated baseline 'about_blank_navigation' with new observation: 1.67ms. Samples: 2
```
or for a new baseline:
```
✅ Created new baseline 'navigate_to_bing_cold': 2500ms. Total baselines: 9
```

### Current baselines
| Key | p50 | p95 | p99 | What it measures |
|-----|-----|-----|-----|-----------------|
| `about_blank_navigation` | 2ms | 15ms | 50ms | Initial about:blank navigation |
| `creation_client_cold_start` | 3500ms | 5000ms | 8000ms | WebView2 creation (cold) |
| `creation_client_warm_start` | 200ms | 500ms | 1000ms | WebView2 creation (warm) |
| `event_handler_registration` | 1ms | 5ms | 20ms | add_* API call duration |
| `service_worker_activation` | 50ms | 500ms | 2000ms | SW cold activation |

---

## 9. `compare_etls`

**What it does**: Compares two ETL trace files side-by-side (a working/success case vs a broken/failure case). Works in two stages:
1. **Setup mode**: Generates PowerShell extraction commands for both ETLs
2. **Compare mode**: Once you've run the extraction, analyzes the filtered outputs and shows event differences, missing events, timing gaps, and failure-only errors

**When you need it**: You have a trace from a machine/session where things worked AND a trace where things broke. You want to pinpoint exactly what's different.

### Just ask Copilot:

| What you say | What happens |
|-------------|-------------|
| *"Compare these two ETLs: the working one is at C:\traces\good.etl and the broken one is at C:\traces\bad.etl. The app is Teams."* | Generates extraction commands for both |
| *"I ran the extraction. Now compare success at C:\temp\etl_compare\success_filtered.txt and failure at C:\temp\etl_compare\failure_filtered.txt for Teams"* | Does actual comparison with full diff report |
| *"Compare the Outlook ETL from my machine C:\traces\my_working.etl against the customer's broken trace C:\traces\customer_broken.etl"* | Setup mode with Outlook-specific filters |

### What you get back

**Setup mode** (when given raw ETL paths):
```
## ETL Comparison Setup: SUCCESS vs FAILURE

| | SUCCESS | FAILURE |
|---|---------|---------|
| ETL | C:\traces\good.etl | C:\traces\bad.etl |
| Exists | ✅ | ✅ |

### Step 1: Set Variables
[PowerShell commands]

### Step 2: Extract SUCCESS ETL
[PowerShell commands]

### Step 3: Extract FAILURE ETL
[PowerShell commands]

### Step 5: Compare (after extraction is done)
Once both extractions complete, ask Copilot:
"Compare the ETL results: success is ... and failure is ..."
```

**Compare mode** (when given filtered text files):
```
## ETL Comparison: SUCCESS vs FAILURE

### Overview
| Metric | SUCCESS | FAILURE |
| Total event lines | 2,450 | 1,830 |
| Unique event types | 28 | 22 |
| Error events | 0 | 3 |

### ✅ Events ONLY in SUCCESS (missing from failure)
- WebView2_APICalled (×45)
- NavigationRequest::CommitNavigation (×2)

### ❌ Events ONLY in FAILURE (not in success)
- WebView2_BrowserProcessFailure (×1)

### ⚠️ Significant Count Differences
| Event | SUCCESS | FAILURE | Ratio |
| WebView2_Creation_Client | 12 | 3 | 4.0x ⬇️ |

### 🔴 Errors in FAILURE ETL
- WebView2_BrowserProcessFailure, 3345678, ...

### 📋 Next Steps
1. Missing events in FAILURE: 6 event types are in SUCCESS but not FAILURE
2. 1 error event in FAILURE — investigate with diagnose
```

### Workflow
1. Ask Copilot to compare two ETL files → get extraction commands
2. Run the PowerShell commands in your terminal
3. Ask Copilot to compare the filtered results → get full diff report
4. Use `lookup_event` on any unfamiliar events from the diff
5. Use `diagnose` if error patterns match known symptoms

---

## 10. `analyze_cpu`

**What it does**: Analyzes CPU traces with proper symbol servers (including Edge-internal symbols). Generates symbolized CPU extraction commands, or parses already-extracted data to show CPU time per keyword, top functions, and module breakdown.

**When you need it**: You found a silent gap or slow phase in the ETW events and want to know *what the CPU was doing* during that time. This is a separate, heavier analysis from `analyze_etl` — only use it when you have a specific hypothesis about CPU activity.

### Just ask Copilot:

| What you say | What happens |
|-------------|-------------|
| *"What was PID 27528 doing on the CPU between timestamps 32456789012 and 32457123456 in C:\traces\stuck.etl? Look for msedge.dll and ntdll"* | Generates symbolized extraction commands with time range |
| *"Analyze CPU for PID 4916 in C:\traces\slow.etl, search for webview2, xaml, and winrt"* | Generates extraction commands (full trace, no range) |
| *"I ran the CPU extraction. Parse the results at C:\temp\cpu_analysis\cpu_pid_27528.txt for keywords msedge.dll and ntdll, PID 27528"* | Parses the symbolized file: CPU time per keyword, top functions, module breakdown |

### What you get back

**Setup mode** (generates commands):
```
## CPU Trace Analysis — PID 27528

### Symbol Servers
| Server | Resolves |
| chromium-browser-symsrv | Open-source Chromium binaries |
| msdl.microsoft.com | Windows OS binaries |
| microsoftedge.symweb.azurefd.net | Edge internals (requires corpnet) |

### Step 2: Extract CPU Samples (PID 27528, range 32456789012–32457123456 µs)
[PowerShell commands with -symbols flag]

### Step 3: Quick Keyword Scan
[PowerShell to count keyword hits]

### Step 4: Top Functions by CPU Time
[PowerShell to extract and rank functions]
```

**Parse mode** (when symbolized file exists):
```
## CPU Analysis Results — PID 27528

Total CPU samples: 3,450 (~3450ms CPU time at 1ms sampling)

### CPU Time by Keyword
| Keyword | Samples | ~CPU Time | % of Total |
| msedge.dll | 2,100 | ~2100ms | 60.9% |
| ntdll | 890 | ~890ms | 25.8% |

### Top Functions by CPU Time
| Rank | Samples | Function |
| 1 | 450 | msedge.dll!NavigationRequest::StartNavigation |
| 2 | 320 | ntdll.dll!NtWaitForSingleObject |

### CPU Time by Module
| Module | Samples | % |
| msedge.dll | 2100 | 60.9% |
| ntdll.dll | 890 | 25.8% |
```

### Key Difference from `analyze_etl`
- `analyze_etl` → ETW events (what happened, in what order)
- `analyze_cpu` → CPU profiling (where is the CPU spending time)
- Use `timeline_slice` first to find the interesting time window, then `analyze_cpu` to drill into CPU

---

## 11. `timeline_slice`

**What it does**: Shows what happened between two timestamps in a filtered ETL dump. Breaks down events by category, active processes, errors, and silent gaps. Like asking *"what was going on between T1 and T2?"*

**When you need it**: You've identified an interesting time window (e.g., a 5-second gap between WebView2 creation and first navigation) and want to understand everything that happened during that period.

### Just ask Copilot:

| What you say | What happens |
|-------------|-------------|
| *"What happened between timestamps 32456789012 and 32461789012 in C:\temp\etl_analysis\filtered.txt?"* | Full breakdown of that 5-second window |
| *"Show me what PID 4916 was doing between 32456789012 and 32457000000 in the filtered trace"* | Same but filtered to one process |
| *"Between the WebView2_Creation_Client and WebView2_APICalled events, what else is going on? The timestamps are 100000 and 350000 in C:\temp\filtered.txt"* | Category breakdown of that gap |

### What you get back

```
## Timeline Slice: 32456.789s → 32461.789s

| Metric | Value |
| Duration | 5000.0ms |
| Events in window | 847 |
| PID filter | all |

### 📊 Event Categories in Window
| Category | Events | Count | Time Span |
| Navigation | NavigationRequest::Create, WebView2_NewNavigationContext +2 | 45 | 3200.5ms |
| Factory & Creation | WebView2_FactoryCreate, WebView2_Creation_Client | 12 | 1500.0ms |
| Service Worker | ForwardServiceWorkerToWorkerReady, FetchHandlerStart +3 | 89 | 2100.0ms |

### 🔄 Active Processes
| Process (PID) | Events |
| msedgewebview2.exe (27528) | 456 |
| SearchHost.exe (4916) | 234 |

### ⏱️ Timeline (first/last events)
+    0.00ms  SearchHost.exe(4916)         WebView2_APICalled
+  125.30ms  msedgewebview2.exe(27528)    NavigationRequest::Create
...
+ 4998.50ms  msedgewebview2.exe(27528)    NavigationRequest::DidCommitNavigation

### ⏸️ Silent Gaps (>100ms with no events)
| After (offset) | Before (offset) | Gap |
| +1200.5ms | +2800.3ms | **1600ms** |

### 📋 Next Steps
1. 1 silent gap — use analyze_cpu with the gap time range to see CPU activity
2. Use lookup_event on unfamiliar events
```

### Workflow
1. Run `analyze_etl` → get filtered dump
2. Look at the filtered output → spot an interesting time window
3. Run `timeline_slice` with those timestamps → get category breakdown
4. If there are silent gaps → use `analyze_cpu` to see CPU activity during the gap
5. If there are errors → use `diagnose` to match known patterns

---

## Putting It All Together — Real-World Example

Here's how a typical ETL analysis conversation goes:

**You**: *"I have an ETL at C:\traces\teams_stuck.etl. The Teams app is stuck. Help me analyze it."*

→ Copilot calls `analyze_etl` → gives you PowerShell commands to run

**You**: *[run the commands, paste back some results]* *"I see these API IDs: 7, 11, 33, 37, 55. What are they?"*

→ Copilot calls `decode_api_id` → decodes all 5 IDs in a table

**You**: *"I see WebView2_DifferentNavigationId in the trace. What does that mean?"*

→ Copilot calls `lookup_event` → explains the event

**You**: *"The app seems stuck — no Navigate API call ever happens. Help me diagnose."*

→ Copilot calls `diagnose("stuck")` → gives decision tree, mentions about:blank deadlock

**You**: *"I have events from PID 1234 (success) and PID 5678 (failure). Compare them."*

→ Copilot calls `compare_incarnations` → shows divergence at event #3

**You**: *"Compare the ETL from the working machine at C:\traces\good.etl with the broken one at C:\traces\bad.etl — the app is Teams."*

→ Copilot calls `compare_etls` → generates extraction commands for both ETLs

**You**: *"OK I ran those commands. Compare the results: success is C:\temp\etl_compare\success_filtered.txt and failure is C:\temp\etl_compare\failure_filtered.txt for Teams"*

→ Copilot calls `compare_etls` with filtered paths → shows event diff, missing events, timing gaps, failure-only errors

**You**: *"There's a 3-second gap between WebView2_Creation_Client and the first Navigate. What happened between timestamps 32456789012 and 32459789012 in C:\temp\etl_analysis\filtered.txt?"*

→ Copilot calls `timeline_slice` → shows event categories, active processes, and a 1.6s silent gap

**You**: *"What was PID 27528 doing on the CPU during that 1.6s gap? Check for msedge.dll and ntdll"*

→ Copilot calls `analyze_cpu` → generates symbolized extraction commands

**You**: *[runs the CPU extraction commands]* *"Parse the results at C:\temp\cpu_analysis\cpu_pid_27528.txt"*

→ Copilot calls `analyze_cpu` with symbolized file → shows 60% CPU in msedge.dll, top function is DLL loading

**You**: *"Found the root cause — it's a new pattern where XAML control deadlocks on DPI change. Save it."*

→ Copilot calls `contribute_root_cause` → saved for future analyses

**You**: *"The cold start creation took 4200ms. Record that timing."*

→ Copilot calls `contribute_timing` → baseline updated, samples: 3

---

## Quick Reference Card

| When you want to... | Just say... |
|---------------------|------------|
| Decode an API number | *"What is API ID 33?"* |
| Understand an event | *"What is WebView2_FactoryCreate?"* |
| Start ETL analysis | *"Analyze C:\path\to\trace.etl for MyApp"* |
| Get diagnosis help | *"My WebView2 app is stuck/crashing/slow"* |
| Compare good vs bad | *"Compare these success and failure events"* |
| Compare two ETL files | *"Compare C:\good.etl vs C:\bad.etl for Teams"* |
| See what happened in a time window | *"What happened between 32456789012 and 32461789012?"* |
| Profile CPU for a process | *"What was PID 27528 doing on CPU? Look for msedge.dll"* |
| Save a new event | *"Add WebView2_NewEvent to the knowledge base, it means..."* |
| Save a root cause | *"Save this root cause: ..."* |
| Record a timing | *"about:blank took 1.67ms, save that"* |
