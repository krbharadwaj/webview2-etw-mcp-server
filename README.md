# ⭐ WebView2 ETW Analysis MCP Server

Analyze WebView2 ETL traces with AI. **5 tools** — full structured analysis with root cause attribution.

---

## ✨ One-Click Install

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_WebView2_ETW_MCP-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=webview2-etw&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22webview2-etw-mcp-server%22%5D%7D)
[![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_WebView2_ETW_MCP-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=webview2-etw&quality=insiders&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22webview2-etw-mcp-server%22%5D%7D)

Click the button above → VS Code opens → MCP server is configured. **That's it.**

> ⚠️ **Getting "spawn npx ENOENT"?** See [Troubleshooting](#-troubleshooting) below.

---

## 📄 Table of Contents

1. [📺 Overview](#-overview)
2. [⚙️ The 5 Tools](#️-the-5-tools)
3. [🎯 How It Works](#-how-it-works)
4. [📊 Structured Analysis Report](#-structured-analysis-report)
5. [🔌 Installation](#-installation)
6. [🎩 Usage Examples](#-usage-examples)
7. [📚 Knowledge Base](#-knowledge-base)
8. [📤 Sharing Learnings](#-sharing-learnings)
9. [🏗️ Architecture](#️-architecture)
10. [📌 Contributing](#-contributing)
11. [🔧 Troubleshooting](#-troubleshooting)

---

## 📺 Overview

The WebView2 ETW MCP Server brings WebView2 ETL trace analysis directly into GitHub Copilot Chat. Just talk in plain English:

- *"Analyze C:\traces\stuck.etl for Teams"* → extraction commands (fast TraceEvent or xperf fallback)
- *"Here's the filtered data — NavigationCompleted not received"* → **automatic** triage + navigation playbook + evidence pack + structured report
- *"What API ID is 33?"* → `AddNavigationStarting`
- *"What events should I see for navigation?"* → expected event sequence with phases
- *"What flags help with blank pages?"* → relevant feature flags with risk levels
- *"Share my learnings"* → push to GitHub for all users

---

## ⚙️ The 5 Tools

| # | Tool | What It Does |
|---|------|-------------|
| 1 | **`analyze_etl`** | **The main tool.** Phase 1: generates extraction commands (TraceEvent fast path or xperf fallback). Phase 2: runs full analysis — triage, navigation playbook, evidence pack, structured report with incarnation grouping and KB-powered metrics. Optional: timeline slice, CPU profiling, ETL comparison. |
| 2 | **`decode_api_id`** | Decode WebView2 API ID numbers (0-174) → human-readable names and categories. Batch mode supported. |
| 3 | **`get_expected_trace_events`** | Get the expected set of ETW events for a specific flow (navigation, initialization, Navigate, GoBack, etc.). Optionally checks a trace file to show found vs missing events. |
| 4 | **`lookup_feature_flags`** | Look up WebView2 feature flags (browser arguments) — purpose, risk level, and when to use them. Search by flag name, category, or problem scenario. |
| 5 | **`share_learnings`** | Preview what you've learned locally → confirm → pushed to GitHub for all users. |

That's it. No need to remember which sub-tool to call — `analyze_etl` handles everything.

---

## 🎯 How It Works

```
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 1: "Analyze C:\traces\stuck.etl for Teams"                   │
│                                                                     │
│  → analyze_etl generates extraction commands                        │
│  → Uses TraceEvent C# extractor (23s) or xperf fallback (5-15min) │
│  → You run them → get filtered.txt                                  │
├─────────────────────────────────────────────────────────────────────┤
│  STEP 2: "Here's the filtered file — NavigationCompleted missing"  │
│                                                                     │
│  → analyze_etl with filtered_file runs EVERYTHING automatically:   │
│                                                                     │
│    ┌─ TRIAGE ──────────────────────────────────────────────┐        │
│    │ Top 3 root causes + confidence + evidence + missing   │        │
│    └───────────────────────────────────────────────────────┘        │
│    ┌─ NAVIGATION PLAYBOOK ─────────────────────────────────┐        │
│    │ ✅ Navigate → ✅ Starting → ✅ Source → ❌ Completed   │        │
│    │ Host ↔ Runtime boundary checks                        │        │
│    └───────────────────────────────────────────────────────┘        │
│    ┌─ EVIDENCE PACK ──────────────────────────────────────┐         │
│    │ Hypothesis + evidence + counter-evidence + timeline   │         │
│    │ Confidence: 0.82 — what would change it              │         │
│    └───────────────────────────────────────────────────────┘        │
│    ┌─ STRUCTURED REPORT ──────────────────────────────────┐         │
│    │ 14-section analysis with incarnations, KB metrics,   │         │
│    │ sequence validation, root cause, recommendations     │         │
│    └───────────────────────────────────────────────────────┘        │
│                                                                     │
│  Optional params (same tool, just add):                             │
│  • start_time + end_time → adds TIMELINE SLICE                     │
│  • include_cpu=true + pid → adds CPU PROFILING                     │
│  • good_etl or good_filtered → adds ETL COMPARISON                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 📊 Structured Analysis Report

Phase 2 generates a **14-section structured JSON report** with a human-readable narrative:

```
ETLAnalysisReport
├── 1.  Metadata              — ETL file info, versions, analysis window
├── 2.  ProcessTopology        — Chromium process model (browser, renderers, GPU, utility)
├── 3.  Incarnations           — WebView2 instance lifecycle groupings with process tables
├── 4.  NavigationTimeline     — Commit-level navigation tracking (start → commit → complete)
├── 5.  RenderingPipeline      — GPU health, frame production, D3D device status
├── 6.  StorageAndPartition    — Renderer recreation, PID changes mid-navigation
├── 7.  NetworkActivity        — Request tracking, stall detection
├── 8.  InjectionAndEnvironment — DLL injection, VDI detection, third-party modules
├── 9.  FailureSignals         — Boolean flags for all detected failure modes
├── 10. ComputedMetrics        — Key timing deltas (creation, nav, renderer, GPU)
├── 11. RootCauseAnalysis      — Primary + secondary root causes with evidence
├── 12. ConfidenceModel        — Signal agreement, temporal correlation, noise scoring
├── 13. SequenceValidation     — Expected vs observed events from KB (api_sequences.json)
└── 14. Recommendations        — Actionable next steps
```

### Human-Readable Output

The report is rendered as a 7-section narrative:

1. **Executive Summary** — Primary finding, confidence level, key evidence
2. **Chronological Timeline** — Sortable event table with interpretation
3. **Incarnations** — WebView2 instance groupings with process tables and issue flags
4. **Key Observations** — Renderer behavior, GPU health, DLL injection, network activity
5. **Root Cause Analysis** — Primary + contributing factors with evidence chains
6. **Metrics Summary** — Observed vs KB-expected values (from `timing_baselines.json`)
7. **Expected vs Observed Events** — Happy-path validation (from `api_sequences.json`)
8. **What This Means** — Plain-English explanation for the application
9. **Recommended Next Steps** — Numbered actionable guidance

### Knowledge Base Integration

The structured report actively uses the knowledge base:

| KB File | Used For |
|---------|----------|
| `timing_baselines.json` | Metrics Summary — expected p95 values for creation, navigation, renderer startup |
| `api_sequences.json` | Sequence Validation — compares Navigate happy path against actual trace events |
| `root_causes.json` | Evidence pack — enriches root cause descriptions |
| `events.json` | Auto-discovered event metadata, categories, severity |

### Sample Output

<details>
<summary>📎 Example Human-Readable Report (click to expand)</summary>

```markdown
# 📄 WebView2 ETL Analysis Report

## 1️⃣ Executive Summary

**Primary Finding:**
Renderer process crashed during navigation, leading to blank screen or content loss.

**Confidence Level:** High (86%)

**Why this conclusion?**
- Renderer exited 2.5s after navigation start
- Navigation commit occurred but completion missing
- Renderer PID changed during navigation
- No GPU failure detected.

## 2️⃣ What Happened (Chronological Timeline)

| Time | Event |
|------|-------|
| 0.120s | SearchHost.exe started (PID 1234) — Host application |
| 4.322s | msedgewebview2.exe started (PID 2345) — Browser process |
| 8.775s | Navigation started (http://127.0.0.1:8080) |
| 13.122s | Navigation committed |
| 15.611s | Renderer exited (PID 2345) — 2.5s lifetime |
| — | NavigationCompleted event **not observed** ❌ |

## 📦 WebView2 Incarnations

**1 incarnation(s)** detected

### 🔴 Incarnation 1
- Created at: **4.322s**
- Host PID: **1234**
- Browser PID: **2345**
- Duration: **11.3s**
- Processes: **4**

| PID | Name | Role |
|-----|------|------|
| 1234 | SearchHost.exe | host |
| 2345 | msedgewebview2.exe | browser |
| 3456 | msedgewebview2.exe | renderer |
| 4567 | msedgewebview2.exe | gpu |

⚠️ **Issue:** Renderer exited unexpectedly during navigation

## 5️⃣ Metrics Summary

| Metric | Observed | Expected (KB p95) | Status |
|--------|----------|-------------------|--------|
| WebView2 Creation | 1.1s | < 1.1s | ✅ Normal |
| Navigation Start → Commit | 4.3s | < 2.5s | ⚠️ Slow |
| Commit → Complete | Not observed | < 2000 ms | ❌ Failed |

## 🔬 Expected vs Observed Events

**Flow:** Navigate | **Completion:** 57%
**Pipeline breaks at:** browser: NavigationRequest::CommitNavigation

| Step | Expected Event | Status |
|------|---------------|--------|
| | WebView2_APICalled | ✅ Found |
| | WebView2_NavigationStarting | ✅ Found |
| | NavigationRequest::BeginNavigation | ✅ Found |
| | NavigationRequest::CommitNavigation | ❌ Missing (required) |
| | WebView2_NavigationCompleted | ❌ Missing (required) |
```

</details>

---

## 🔌 Installation

### Prerequisites

- **Node.js 18+** — [Download](https://nodejs.org/)
- **Windows** — ETL analysis uses PowerShell
- **ETL Extraction** (one of):
  - **.NET 8+** — for the fast TraceEvent-based extractor (recommended, ~23 seconds for 1.5GB ETL)
  - **Windows Performance Toolkit** — xperf fallback (~5-15 minutes per pass)

### ✨ One-Click Install (Recommended)

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_WebView2_ETW_MCP-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=webview2-etw&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22webview2-etw-mcp-server%22%5D%7D)
[![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_WebView2_ETW_MCP-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=webview2-etw&quality=insiders&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22webview2-etw-mcp-server%22%5D%7D)

### 📋 Manual Install

Add to `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "webview2-etw": {
      "command": "npx",
      "args": ["-y", "webview2-etw-mcp-server"]
    }
  }
}
```

Or add to your VS Code user `settings.json` (global — applies to all workspaces):

```json
{
  "mcp": {
    "servers": {
      "webview2-etw": {
        "command": "npx",
        "args": ["-y", "webview2-etw-mcp-server"]
      }
    }
  }
}
```

> **No `GITHUB_TOKEN` needed!** The server auto-detects your GitHub authentication from `gh` CLI or VS Code.

### 🔧 From Source (for development)

```bash
git clone https://github.com/krbharadwaj/webview2-etw-mcp-server.git
cd webview2-etw-mcp-server
npm install && npm run build
```

#### Building the Fast TraceEvent Extractor (optional, recommended)

```bash
cd tools/etl-extract/EtlExtract
dotnet publish -c Release -o ../bin
```

This builds `tools/etl-extract/bin/EtlExtract.exe` which extracts ETL events in ~23 seconds (vs 5-15 minutes with xperf). The MCP server auto-detects it if built; otherwise falls back to xperf.

Then point to the local build:

```json
{
  "servers": {
    "webview2-etw": {
      "type": "stdio",
      "command": "node",
      "args": ["<path>/webview2-etw-mcp-server/dist/index.js"]
    }
  }
}
```

---

## 🎩 Usage Examples

Switch to **Agent Mode** in GitHub Copilot Chat, then just ask:

### Typical Flow (2 calls)

```
CALL 1 — EXTRACT:
You: "I have an ETL at C:\traces\teams_stuck.etl. Teams is stuck."
  → analyze_etl generates extraction commands
  → Uses TraceEvent (23s) or xperf fallback (5-15min)
  → You run them → get C:\temp\etl_analysis\filtered.txt

CALL 2 — FULL ANALYSIS (automatic):
You: "Here's the filtered data at C:\temp\etl_analysis\filtered.txt.
      NavigationCompleted not received."
  → analyze_etl (with filtered_file) runs EVERYTHING:

  ┌── TRIAGE CARD ─────────────────────────────────────────┐
  │ 🔴 #1 navigation_stalled (0.85)                        │
  │ 🟡 #2 initializing_navigation_suppression (0.62)       │
  │ Missing: WebView2_NavigationCompleted                   │
  ├── NAVIGATION PLAYBOOK ─────────────────────────────────┤
  │ ✅ Navigate → ✅ Starting → ✅ Source → ❌ Completed    │
  │ 🔴 Pipeline breaks at stage 9                          │
  ├── EVIDENCE PACK ───────────────────────────────────────┤
  │ Hypothesis: navigation_stalled | Confidence: 0.82      │
  │ Evidence: 8 items | Counter-evidence: 1                 │
  ├── STRUCTURED REPORT ───────────────────────────────────┤
  │ 14-section analysis with incarnations, KB metrics,     │
  │ root cause attribution, and next steps                  │
  └─────────────────────────────────────────────────────────┘
```

### With Optional Parameters (same tool)

```
You: "Analyze with timeline between 32456789012 and 32461789012"
  → Same analyze_etl + start_time + end_time → adds TIMELINE SLICE

You: "Include CPU analysis for PID 27528"
  → Same analyze_etl + include_cpu=true + pid → adds CPU PROFILING

You: "Compare with working trace at C:\temp\good_filtered.txt"
  → Same analyze_etl + good_filtered → adds ETL COMPARISON
```

### Other Tools

```
You: "What is API ID 33?"
  → decode_api_id: AddNavigationStarting (Navigation, EventRegistration)

You: "What events should I see for navigation?"
  → get_expected_trace_events: 9-stage lifecycle pipeline with expected events

You: "What flags help with blank pages?"
  → lookup_feature_flags: disable-gpu, RendererAppContainer, etc.

You: "Share my learnings"
  → share_learnings: Preview diff → confirm → pushed to GitHub
```

---

## 📚 Knowledge Base

Ships pre-loaded — no setup required:

| File | Contents | Used By | Auto-grows? |
|------|----------|---------|-------------|
| `api_ids.json` | 175 API IDs (Navigate, Initialize, GoBack, ...) | decode_api_id | ✅ Auto-discover |
| `events.json` | 700+ ETW events across 15 categories | triage, auto-learn | ✅ Auto-discover |
| `root_causes.json` | 7 root causes with evidence patterns | evidence_pack | ✅ Via analysis |
| `timing_baselines.json` | 16 timing baselines with p50/p95/p99 | **structured report** — metrics table | ✅ Auto-extract |
| `api_sequences.json` | 12 API happy-path sequences | **structured report** — sequence validation | ✅ Via analysis |
| `nav_playbooks.json` | Navigation & init lifecycle playbooks | nav_playbook | ✅ Via analysis |
| `rca_taxonomy.json` | Root-cause taxonomy (5 categories, ~15 sub-causes) | triage | ✅ Via analysis |
| `known_flags.json` | Feature flags with categories and risk levels | lookup_feature_flags | Manual |

The KB grows automatically every time you analyze a trace. Use `share_learnings` to push discoveries to GitHub.

---

## 📤 Sharing Learnings

Sharing is **explicit** — the server never pushes without your review.

1. **Analyze traces** as usual — the server learns locally (events, timings, patterns)
2. **Say `"share my learnings"`** — the server shows you a diff
3. **Say `"looks good, confirm"`** — changes are pushed to GitHub
4. **Every other user** pulls your discoveries on their next server startup

### Auth

**Most users need zero setup** — the server auto-detects authentication:

| Auth Source | Setup Needed |
|-------------|--------------|
| **VS Code GitHub sign-in** | **None** — already signed in |
| **`gh` CLI** | **None** — already authenticated |
| **`GITHUB_TOKEN` env var** | One-time PAT creation |

Without any auth, everything still works — learnings stay local, and you still **receive** others' shared discoveries.

---

## 🏗️ Architecture

```
webview2-etw-mcp-server/
├── src/
│   ├── index.ts                   MCP server (5 tools registered)
│   ├── tools/
│   │   ├── unified_analyze.ts     🔧 Tool 1: Unified ETL analysis orchestrator
│   │   ├── decode.ts              🔧 Tool 2: API ID decoding
│   │   ├── expected_events.ts     🔧 Tool 3: Expected trace events lookup
│   │   ├── feature_flags.ts       🔧 Tool 4: Feature flag lookup
│   │   ├── structured_report.ts   14-section structured report + narrative formatter
│   │   ├── trace_structure.ts     Process topology, incarnations, config extraction
│   │   ├── triage.ts              Root-cause scoring engine
│   │   ├── nav_playbook.ts        Navigation lifecycle validation
│   │   ├── evidence_pack.ts       RCA evidence assembly
│   │   ├── analyze.ts             ETL extraction command generation
│   │   ├── analyze_cpu.ts         CPU profiling (opt-in)
│   │   ├── timeline_slice.ts      Time-window analysis
│   │   ├── compare_etls.ts        ETL comparison
│   │   ├── validate_trace.ts      API sequence validation
│   │   └── auto_learn.ts          Passive auto-learning
│   ├── knowledge/
│   │   ├── loader.ts              JSON I/O with path resolution
│   │   ├── sync.ts                GitHub sync (pull/push)
│   │   ├── api_ids.json           175 API ID mappings
│   │   ├── api_sequences.json     12 API happy-path sequences
│   │   ├── events.json            700+ ETW events
│   │   ├── root_causes.json       7 root causes
│   │   ├── timing_baselines.json  16 timing baselines (p50/p95/p99)
│   │   ├── nav_playbooks.json     Navigation & init playbooks
│   │   ├── known_flags.json       Feature flags database
│   │   └── rca_taxonomy.json      Root-cause taxonomy
│   └── test.ts
├── tools/
│   └── etl-extract/               TraceEvent-based C# ETL extractor
│       └── EtlExtract/
│           ├── Program.cs         Single-pass extraction (~23s for 1.5GB)
│           └── EtlExtract.csproj  .NET project with TraceEvent NuGet
├── .github/workflows/
│   └── process-learnings.yml      Auto-process learning submissions
└── README.md
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **5 tools only** | Users don't need to learn sub-tools; `analyze_etl` orchestrates everything |
| **TraceEvent fast path** | C# extractor runs in ~23s vs 5-15min with xperf; auto-fallback if not built |
| **14-section structured report** | Programmatic JSON consumption + human-readable narrative in one output |
| **KB-powered metrics** | Observed values compared against p95 baselines from `timing_baselines.json` |
| **Incarnation grouping** | Processes grouped by WebView2 creation lifecycle, not just by role |
| **Sequence validation** | Happy-path events from `api_sequences.json` compared against actual trace |
| **CPU profiling is opt-in** | Initial analysis is fast (event-level); CPU only when evidence suggests contention |
| **Auto-learning on every analysis** | KB grows silently; no manual contribution tools needed |
| **Local-first** | Everything works without a token; sharing is opt-in |

---

## 📌 Contributing

The server learns from usage — the best contribution is **using it**.

| What To Do | What Gets Learned |
|-----------|-------------------|
| **Analyze traces** with `analyze_etl` | New events, timings, root causes (auto) |
| **Check expected events** with `get_expected_trace_events` | Validates KB completeness |
| **Share learnings** by saying `"share my learnings"` | Push discoveries to GitHub for all users |
| **File issues / PRs** on GitHub | Direct improvements |

## 🔧 Troubleshooting

### "spawn npx ENOENT" or "'npx' is not recognized"

This means VS Code cannot find `npx` in its PATH. Common causes:

1. **Node.js was installed after VS Code was opened** — VS Code inherits PATH at startup. **Fix: Restart VS Code** (or restart your computer) so it picks up the updated PATH.

2. **Node.js is not installed** — Install [Node.js 18+](https://nodejs.org/) and restart VS Code.

3. **Fallback: use `node` directly** — If restarting doesn't help, install globally and point to `node`:

   ```bash
   npm install -g webview2-etw-mcp-server
   ```

   Then use this config in `.vscode/mcp.json`:

   ```json
   {
     "servers": {
       "webview2-etw": {
         "command": "node",
         "args": ["<path-to-global-node_modules>/webview2-etw-mcp-server/dist/index.js"]
       }
     }
   }
   ```

   To find the path, run: `npm root -g`

## License

Licensed under the [MIT License](./LICENSE).

---

_Built for the Edge WebView2 team. Works with any WebView2 host application._
