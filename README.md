# ⭐ WebView2 ETW Analysis MCP Server

Analyze WebView2 ETL traces with AI. 11 tools, 189 known events, 7 root causes, auto-learning knowledge base.

---

## ✨ One-Click Install

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_WebView2_ETW_MCP-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=webview2-etw&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22github%3Akrbharadwaj%2Fwebview2-etw-mcp-server%22%5D%7D)
[![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_WebView2_ETW_MCP-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=webview2-etw&quality=insiders&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22github%3Akrbharadwaj%2Fwebview2-etw-mcp-server%22%5D%7D)

Click the button above → VS Code opens → MCP server is configured. **That's it.**

---

## 📄 Table of Contents

1. [📺 Overview](#-overview)
2. [⚙️ All 11 Tools](#️-all-11-tools)
3. [🔌 Installation](#-installation)
4. [🎩 Usage Examples](#-usage-examples)
5. [📚 Knowledge Base](#-knowledge-base)
6. [🏗️ Architecture](#️-architecture)
7. [📌 Contributing](#-contributing)

## 📺 Overview

The WebView2 ETW MCP Server brings WebView2 ETL trace analysis directly into GitHub Copilot. Just talk in plain English:

- *"What is API ID 33?"* → `AddNavigationStarting`
- *"Analyze C:\traces\stuck.etl for Teams"* → extraction commands
- *"My WebView2 app is stuck"* → decision tree + root causes
- *"What happened between timestamps X and Y?"* → event breakdown
- *"Compare good.etl vs bad.etl for Outlook"* → side-by-side diff
- *"What was PID 27528 doing on CPU?"* → CPU profiling with Edge symbol servers

## ⚙️ All 11 Tools

| # | Tool | Purpose |
|---|------|---------|
| 1 | `decode_api_id` | Decode WebView2 API ID numbers (0-174) → human-readable names |
| 2 | `lookup_event` | Look up any of 189 ETW events — description, params, severity |
| 3 | `diagnose` | Decision trees for: stuck, crash, slow_init, auth_failure, slow_nav, memory, renderer |
| 4 | `analyze_etl` | Generate PowerShell extraction commands for ETL files |
| 5 | `compare_incarnations` | Compare SUCCESS vs FAILURE event timelines |
| 6 | `compare_etls` | Compare two ETL files end-to-end |
| 7 | `analyze_cpu` | CPU profiling with Chromium + Edge + Microsoft symbol servers |
| 8 | `timeline_slice` | What happened between two timestamps (categories, gaps, errors) |
| 9 | `contribute_event` | Add events to KB (optional — server auto-learns) |
| 10 | `contribute_root_cause` | Add root causes (optional) |
| 11 | `contribute_timing` | Update timing baselines (optional) |

See **[TOOLS_GUIDE.md](TOOLS_GUIDE.md)** for the complete reference with human-language examples.

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

Or add to VS Code `settings.json` (global):

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

### 🔧 From Source

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

## 🎩 Usage Examples

Switch to **Agent Mode** in GitHub Copilot Chat, then just ask:

### ETL Analysis Workflow

```
You: "I have an ETL at C:\traces\teams_stuck.etl. Teams is stuck."
  → Copilot gives you PowerShell extraction commands

You: "I see API IDs 7, 33, 37, 55. What are they?"
  → Initialize, AddNavigationStarting, AddNavigationCompleted, AddProcessFailed

You: "What happened between timestamps 32456789012 and 32461789012?"
  → Event categories, active processes, errors, silent gaps

You: "There's a 1.6s gap — what was PID 27528 doing on CPU?"
  → CPU profiling commands with Edge symbol servers

You: "Compare the working trace vs broken trace"
  → Side-by-side diff: missing events, timing differences, failure-only errors
```

### Quick Lookups

```
You: "What is WebView2_DifferentNavigationId?"
  → Navigation ID mismatch detected — full description, params, related events

You: "My WebView2 app is crashing"
  → Decision tree: check BrowserProcessFailure, ProcessFailureTypeWithReason, exit codes
```

## 📚 Knowledge Base

Ships pre-loaded — no setup required:

| File | Contents |
|------|----------|
| `api_ids.json` | 175 API IDs (Navigate, Initialize, GoBack, AddNavigationStarting, ...) |
| `events.json` | 189 events across 15 categories |
| `root_causes.json` | 7 root causes (about:blank deadlock, VDI DLL loading, WAM failure, ...) |
| `timing_baselines.json` | 16 timing baselines with p50/p95/p99 |

The knowledge base **grows automatically** with each analysis. The server auto-discovers unknown events and records timings from ETL data.

## 🏗️ Architecture

```
webview2-etw-mcp-server/
├── src/
│   ├── index.ts              MCP server entry (11 tools)
│   ├── tools/
│   │   ├── decode.ts         API ID decoding (175 IDs)
│   │   ├── lookup.ts         Event lookup with fuzzy matching
│   │   ├── diagnose.ts       7 symptom decision trees
│   │   ├── analyze.ts        ETL extraction command generation
│   │   ├── analyze_cpu.ts    CPU profiling with 3 symbol servers
│   │   ├── timeline_slice.ts Between-timestamp analysis
│   │   ├── compare.ts        Incarnation comparison
│   │   ├── compare_etls.ts   Two-ETL comparison
│   │   ├── contribute.ts     Manual KB enrichment
│   │   └── auto_learn.ts     Auto-learning from analysis
│   └── knowledge/
│       ├── loader.ts         JSON I/O with multi-mode path resolution
│       ├── api_ids.json      175 API IDs
│       ├── events.json       189 events
│       ├── root_causes.json  7 root causes
│       └── timing_baselines.json  16 baselines
├── TOOLS_GUIDE.md            Human-language tool reference
└── README.md                 This file
```

## 📌 Contributing

Contributions welcome! The easiest way to contribute:

1. **Analyze an ETL** — the server auto-learns new events
2. **Share root causes** — use `contribute_root_cause` when you find a new failure pattern
3. **File issues** — bugs, feature requests, new event documentation
4. **PRs** — add tools, improve diagnosis trees, expand the knowledge base

## License

Licensed under the [MIT License](./LICENSE).

---

_Built for the Edge WebView2 team. Works with any WebView2 host application._
