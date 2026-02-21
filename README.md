# ⭐ WebView2 ETW Analysis MCP Server

Analyze WebView2 ETL traces with AI. **4 tools** — that's all you need.

---

## ✨ One-Click Install

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_WebView2_ETW_MCP-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=webview2-etw&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22github%3Akrbharadwaj%2Fwebview2-etw-mcp-server%22%5D%7D)
[![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_WebView2_ETW_MCP-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=webview2-etw&quality=insiders&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22github%3Akrbharadwaj%2Fwebview2-etw-mcp-server%22%5D%7D)

Click the button above → VS Code opens → MCP server is configured. **That's it.**

---

## 📄 Table of Contents

1. [📺 Overview](#-overview)
2. [⚙️ The 4 Tools](#️-the-4-tools)
3. [🎯 How It Works](#-how-it-works)
4. [🔌 Installation](#-installation)
5. [🎩 Usage Examples](#-usage-examples)
6. [📚 Knowledge Base](#-knowledge-base)
7. [📤 Sharing Learnings](#-sharing-learnings)
8. [🏗️ Architecture](#️-architecture)
9. [📌 Contributing](#-contributing)

---

## 📺 Overview

The WebView2 ETW MCP Server brings WebView2 ETL trace analysis directly into GitHub Copilot Chat. Just talk in plain English:

- *"Analyze C:\traces\stuck.etl for Teams"* → extraction commands
- *"Here's the filtered data — NavigationCompleted not received"* → **automatic** triage + navigation playbook + evidence pack
- *"What API ID is 33?"* → `AddNavigationStarting`
- *"What events should I see for navigation?"* → expected event sequence with phases
- *"Share my learnings"* → push to GitHub for all users

---

## ⚙️ The 4 Tools

| # | Tool | What It Does |
|---|------|-------------|
| 1 | **`analyze_etl`** | **The main tool.** Phase 1: generates extraction commands. Phase 2 (with filtered data): runs full analysis automatically — triage, navigation playbook, evidence pack, timeline slice, CPU profiling, ETL comparison. Everything in one call. |
| 2 | **`decode_api_id`** | Decode WebView2 API ID numbers (0-174) → human-readable names and categories. Batch mode supported. |
| 3 | **`get_expected_trace_events`** | Get the expected set of ETW events for a specific flow (navigation, initialization, Navigate, GoBack, etc.). Optionally checks a trace file to show found vs missing events. |
| 4 | **`share_learnings`** | Preview what you've learned locally → confirm → pushed to GitHub for all users. |

That's it. No need to remember which sub-tool to call — `analyze_etl` handles everything.

---

## 🎯 How It Works

```
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 1: "Analyze C:\traces\stuck.etl for Teams"                   │
│                                                                     │
│  → analyze_etl generates PowerShell extraction commands             │
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
│                                                                     │
│  Optional params (same tool, just add):                             │
│  • start_time + end_time → adds TIMELINE SLICE                     │
│  • include_cpu=true + pid → adds CPU PROFILING                     │
│  • good_etl or good_filtered → adds ETL COMPARISON                 │
└─────────────────────────────────────────────────────────────────────┘
```

**CPU profiling is NOT run by default** — only when you explicitly pass `include_cpu=true`. Initial analysis focuses on event-level root causes which is faster and usually sufficient.

---

See **[TOOLS_GUIDE.md](TOOLS_GUIDE.md)** for the complete reference with human-language examples.

---

## 🔌 Installation

### Prerequisites

- **Node.js 18+** — [Download](https://nodejs.org/)
- **Windows** — ETL analysis uses PowerShell + xperf
- **Windows Performance Toolkit** — [Windows SDK](https://developer.microsoft.com/en-us/windows/downloads/windows-sdk/)

### ✨ One-Click Install (Recommended)

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_WebView2_ETW_MCP-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=webview2-etw&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22github%3Akrbharadwaj%2Fwebview2-etw-mcp-server%22%5D%7D)
[![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_WebView2_ETW_MCP-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=webview2-etw&quality=insiders&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22github%3Akrbharadwaj%2Fwebview2-etw-mcp-server%22%5D%7D)

### 📋 Manual Install

Add to `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "webview2-etw": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "github:krbharadwaj/webview2-etw-mcp-server"]
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
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "github:krbharadwaj/webview2-etw-mcp-server"]
      }
    }
  }
}
```

> **No `GITHUB_TOKEN` needed!** The server auto-detects your GitHub authentication from `gh` CLI or VS Code. See [Sharing Learnings](#-sharing-learnings) for details.

### 🔧 From Source (for development)

```bash
git clone https://github.com/krbharadwaj/webview2-etw-mcp-server.git
cd webview2-etw-mcp-server
npm install && npm run build
```

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
  → analyze_etl generates PowerShell extraction commands
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
  │ ❌ Runtime generated but host never received            │
  ├── EVIDENCE PACK ───────────────────────────────────────┤
  │ Hypothesis: navigation_stalled | Confidence: 0.82      │
  │ Evidence: 8 items | Counter-evidence: 1                 │
  └─────────────────────────────────────────────────────────┘
```

### With Optional Parameters (same tool)

```
You: "Analyze with timeline between 32456789012 and 32461789012"
  → Same analyze_etl + start_time + end_time → adds TIMELINE SLICE to report

You: "Include CPU analysis for PID 27528"
  → Same analyze_etl + include_cpu=true + pid → adds CPU PROFILING to report

You: "Compare with working trace at C:\temp\good_filtered.txt"
  → Same analyze_etl + good_filtered → adds ETL COMPARISON to report
```

### Other Tools

```
You: "What is API ID 33?"
  → decode_api_id: AddNavigationStarting (Navigation, EventRegistration)

You: "What events should I see for navigation?"
  → get_expected_trace_events: 9-stage lifecycle pipeline with expected events,
    failure variants, and optionally checks your trace for found vs missing

You: "Share my learnings"
  → share_learnings: Preview diff → confirm → pushed to GitHub
```

---

## 📚 Knowledge Base

Ships pre-loaded — no setup required:

| File | Contents | Auto-grows? |
|------|----------|-------------|
| `api_ids.json` | 175 API IDs (Navigate, Initialize, GoBack, ...) | ✅ Auto-discover |
| `events.json` | 189+ ETW events across 15 categories | ✅ Auto-discover |
| `root_causes.json` | 7 root causes with evidence patterns | ✅ Via analysis |
| `timing_baselines.json` | 16 timing baselines with p50/p95/p99 | ✅ Auto-extract |
| `api_sequences.json` | 12 API happy-path sequences | ✅ Via analysis |
| `nav_playbooks.json` | Navigation & init lifecycle playbooks | ✅ Via analysis |
| `rca_taxonomy.json` | Root-cause taxonomy (5 categories, ~15 sub-causes) | ✅ Via analysis |

The KB grows automatically every time you analyze a trace. Use `share_learnings` to push discoveries to GitHub.

---

## 📤 Sharing Learnings

Sharing is **explicit** — the server never pushes without your review.

### How It Works

1. **Analyze traces** as usual — the server learns locally (events, timings, patterns)
2. **Say `"share my learnings"`** — the server shows you a diff:

   ```
   ## 📤 Learnings Ready to Share
   
   **3 new** entries and **1 updated** across 2 knowledge files.
   
   ### 📋 Events (events.json)
   New (2):
     - `WebView2_FrameCreated` — Frame creation callback
     - `WebView2_CustomSchemeHandler` — Custom scheme registration
   
   ### ⏱️ Timing Baselines (timing_baselines.json)
   Updated (1):
     - `about_blank_navigation` — samples: 5 → 8
   
   To push, run share_learnings with action: "confirm".
   ```

3. **Say `"looks good, confirm"`** — changes are pushed to GitHub
4. **Every other user** pulls your discoveries on their next server startup

### Setup

**Most users need zero setup** — the server auto-detects your GitHub authentication:

| Auth Source | How It Works | Setup Needed |
|-------------|-------------|--------------|
| **VS Code GitHub sign-in** | Auto-detected from OS credential store (Copilot, Settings Sync, GitHub PRs) | **None** — already signed in |
| **`gh` CLI** | Auto-detected via `gh auth token` | **None** — already authenticated |
| **`GITHUB_TOKEN` env var** | Explicit token with repo write access (direct push) | One-time PAT creation |

The server tries each source in order. If you're signed into GitHub in VS Code or have the `gh` CLI, sharing works immediately.

**If no auth is detected**, the server tells you how to fix it:

```
🟡 Pull-only mode — receiving shared learnings but cannot share.

To enable sharing, do ONE of:
• Install gh CLI and run: gh auth login
• Sign into GitHub in VS Code
• Set GITHUB_TOKEN env var in your MCP config
```

#### How sharing works behind the scenes

- **Users with `GITHUB_TOKEN` env var** (repo collaborators): Direct push to the repo
- **Users with `gh` CLI or VS Code auth**: Creates a GitHub Issue with the knowledge diff → a GitHub Actions workflow automatically validates, merges, and commits

**Without any auth**: Everything still works. Learnings stay local, and you still **receive** others' shared discoveries (public repo, read access is free).

### What Gets Synced

| On Startup | On Share |
|------------|----------|
| Server **pulls** latest knowledge JSONs from GitHub | Server **pushes** your new discoveries back |
| Additive merge with local data (never loses entries) | Only pushes files with actual changes |
| Automatic — no user action needed | Explicit — requires preview + confirm |

---

## 🏗️ Architecture

```
webview2-etw-mcp-server/
├── src/
│   ├── index.ts                 MCP server (4 tools registered)
│   ├── tools/
│   │   ├── unified_analyze.ts   🔧 Tool 1: Unified ETL analysis orchestrator
│   │   ├── expected_events.ts   🔧 Tool 3: Expected trace events lookup
│   │   ├── decode.ts            🔧 Tool 2: API ID decoding
│   │   ├── triage.ts            Internal: root-cause scoring
│   │   ├── nav_playbook.ts      Internal: navigation lifecycle checks
│   │   ├── evidence_pack.ts     Internal: RCA evidence pack
│   │   ├── analyze.ts           Internal: ETL extraction commands
│   │   ├── analyze_cpu.ts       Internal: CPU profiling (opt-in)
│   │   ├── timeline_slice.ts    Internal: time-window analysis
│   │   ├── compare_etls.ts      Internal: ETL comparison
│   │   ├── validate_trace.ts    Internal: API sequence validation
│   │   └── auto_learn.ts        Internal: passive auto-learning
│   ├── knowledge/
│   │   ├── loader.ts            JSON I/O with path resolution
│   │   ├── sync.ts              GitHub sync (pull/push)
│   │   ├── api_ids.json         175 API ID mappings
│   │   ├── api_sequences.json   12 API happy-path sequences
│   │   ├── events.json          189+ ETW events
│   │   ├── root_causes.json     7 root causes
│   │   ├── timing_baselines.json  16 timing baselines
│   │   ├── nav_playbooks.json   Navigation & init playbooks
│   │   └── rca_taxonomy.json    Root-cause taxonomy
│   └── test.ts
├── .github/workflows/
│   └── process-learnings.yml    Auto-process learning submissions
└── README.md
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **4 tools only** | Users don't need to learn sub-tools; `analyze_etl` orchestrates everything |
| **CPU profiling is opt-in** | Initial analysis is fast (event-level); CPU only when evidence suggests contention |
| **Auto-learning on every analysis** | KB grows silently; no manual contribution tools needed |
| **JSON knowledge base** | Version-controlled, diffable, works offline, syncs via GitHub API |
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

## License

Licensed under the [MIT License](./LICENSE).

---

_Built for the Edge WebView2 team. Works with any WebView2 host application._
