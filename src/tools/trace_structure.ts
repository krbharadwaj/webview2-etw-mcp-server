/**
 * trace_structure: Extracts structured information from filtered ETL data.
 *
 * Produces:
 *   1. Configuration: feature flags, runtime/SDK version, command lines
 *   2. Process tree: host app → WebView2 browser → renderer/utility/GPU
 *   3. Per-process activity summary
 *   4. Initial issue detection: errors, missing signals, anomalies
 */

import { readFileSync } from "fs";

// ─── Types ──────────────────────────────────────────────────────────

interface ProcessInfo {
  name: string;
  pid: number;
  eventCount: number;
  firstTs: number;
  lastTs: number;
  role: string;         // "host", "browser", "renderer", "utility", "gpu", "crashpad", "unknown"
  parentPid: number | null;
  keyEvents: string[];
  errors: string[];
}

export interface Incarnation {
  id: number;               // 1-based incarnation index
  creationTs: number;       // timestamp of WebView2_Creation_Client
  creationLine: number;     // line number
  hostPid: number | null;
  browserPid: number | null;
  associatedPids: number[]; // all PIDs active during this incarnation
  processes: ProcessInfo[];
  keyEvents: { event: string; ts: number; line: number; pid: number }[];
  errors: string[];
  hasIssue: boolean;        // flagged if errors or missing signals detected
  issueHint: string;        // brief description of suspected issue
  durationMs: number;       // time span of this incarnation
}

interface Configuration {
  runtimeVersion: string | null;
  sdkVersion: string | null;
  browserVersion: string | null;
  channelName: string | null;
  userDataFolder: string | null;
  enabledFeatures: string[];
  disabledFeatures: string[];
  webview2Flags: string[];
  fieldTrials: string[];
  commandLineArgs: string[];
  environmentInfo: string[];
}

interface InitialIssue {
  severity: "🔴 critical" | "🟡 warning" | "🔵 info";
  message: string;
  evidence: string;
}

export interface TraceStructure {
  config: Configuration;
  processes: ProcessInfo[];
  processTree: string;      // formatted tree
  activitySummary: string;  // formatted table
  issues: InitialIssue[];
  issuesSummary: string;    // formatted
  incarnations: Incarnation[];  // WebView2 incarnation groupings
  incarnationSummary: string;   // formatted incarnation report
  traceSpanMs: number;
  totalLines: number;
  totalEvents: number;
}

// ─── Main entry point ───────────────────────────────────────────────

export function extractTraceStructure(
  filteredFile: string,
  hostApp: string
): TraceStructure {
  const content = readFileSync(filteredFile, "utf-8");
  const lines = content.split("\n").filter(l => l.trim());

  const config = extractConfiguration(lines);
  const processes = extractProcesses(lines, hostApp);
  const issues = detectInitialIssues(lines, processes, config, hostApp);
  const incarnations = detectIncarnations(lines, processes, hostApp);

  // Trace time span — use iterative min/max to avoid stack overflow on large traces
  let minTs = Infinity;
  let maxTs = -Infinity;
  let tsCount = 0;
  for (const line of lines) {
    const t = extractTs(line);
    if (t !== null) {
      if (t < minTs) minTs = t;
      if (t > maxTs) maxTs = t;
      tsCount++;
    }
  }
  if (tsCount === 0) { minTs = 0; maxTs = 0; }
  const traceSpanMs = (maxTs - minTs) / 1000;

  return {
    config,
    processes,
    processTree: formatProcessTree(processes, hostApp),
    activitySummary: formatActivitySummary(processes, minTs),
    issues,
    issuesSummary: formatIssues(issues),
    incarnations,
    incarnationSummary: formatIncarnations(incarnations),
    traceSpanMs,
    totalLines: lines.length,
    totalEvents: tsCount,
  };
}

export function formatTraceStructureReport(ts: TraceStructure, hostApp: string): string {
  const out: string[] = [];

  // ── Section 1: Configuration ──
  out.push("## 📋 Configuration");
  out.push("");
  out.push("| Property | Value |");
  out.push("|----------|-------|");
  out.push(`| Runtime Version | ${ts.config.runtimeVersion || "—"} |`);
  out.push(`| SDK Version | ${ts.config.sdkVersion || "—"} |`);
  out.push(`| Browser Version | ${ts.config.browserVersion || "—"} |`);
  out.push(`| Channel | ${ts.config.channelName || "—"} |`);
  out.push(`| User Data Folder | ${ts.config.userDataFolder || "—"} |`);
  out.push(`| Trace Duration | ${ts.traceSpanMs.toFixed(0)}ms |`);
  out.push(`| Total Events | ${ts.totalEvents.toLocaleString()} (${ts.totalLines.toLocaleString()} lines) |`);
  out.push(`| Processes | ${ts.processes.length} |`);
  out.push("");

  if (ts.config.enabledFeatures.length > 0) {
    out.push("### Enabled Features");
    out.push("```");
    for (const f of ts.config.enabledFeatures.slice(0, 30)) {
      out.push(f);
    }
    if (ts.config.enabledFeatures.length > 30)
      out.push(`... +${ts.config.enabledFeatures.length - 30} more`);
    out.push("```");
    out.push("");
  }

  if (ts.config.disabledFeatures.length > 0) {
    out.push("### Disabled Features");
    out.push("```");
    for (const f of ts.config.disabledFeatures.slice(0, 20)) {
      out.push(f);
    }
    if (ts.config.disabledFeatures.length > 20)
      out.push(`... +${ts.config.disabledFeatures.length - 20} more`);
    out.push("```");
    out.push("");
  }

  if (ts.config.webview2Flags.length > 0) {
    out.push("### WebView2-Specific Flags");
    out.push("```");
    for (const f of ts.config.webview2Flags) out.push(f);
    out.push("```");
    out.push("");
  }

  if (ts.config.fieldTrials.length > 0) {
    out.push("### Field Trials");
    out.push("```");
    for (const f of ts.config.fieldTrials.slice(0, 15)) out.push(f);
    if (ts.config.fieldTrials.length > 15)
      out.push(`... +${ts.config.fieldTrials.length - 15} more`);
    out.push("```");
    out.push("");
  }

  if (ts.config.commandLineArgs.length > 0) {
    out.push("### Other Command Line Arguments");
    out.push("```");
    for (const a of ts.config.commandLineArgs.slice(0, 15)) out.push(a);
    if (ts.config.commandLineArgs.length > 15)
      out.push(`... +${ts.config.commandLineArgs.length - 15} more`);
    out.push("```");
    out.push("");
  }

  // ── Section 2: Process Tree ──
  out.push("---");
  out.push("");
  out.push("## 🌲 Process Tree");
  out.push("");
  out.push(ts.processTree);
  out.push("");

  // ── Section 3: Process Activity ──
  out.push("---");
  out.push("");
  out.push("## 📊 Process Activity Summary");
  out.push("");
  out.push(ts.activitySummary);
  out.push("");

  // ── Section 4: Incarnations ──
  if (ts.incarnations.length > 0) {
    out.push("---");
    out.push("");
    out.push("## 🔄 WebView2 Incarnations");
    out.push("");
    out.push(ts.incarnationSummary);
    out.push("");
  }

  // ── Section 5: Initial Issues ──
  if (ts.issues.length > 0) {
    out.push("---");
    out.push("");
    out.push("## ⚡ Initial Issue Detection");
    out.push("");
    out.push(ts.issuesSummary);
    out.push("");
  }

  return out.join("\n");
}

// ─── Configuration extraction ───────────────────────────────────────

function extractConfiguration(lines: string[]): Configuration {
  const config: Configuration = {
    runtimeVersion: null,
    sdkVersion: null,
    browserVersion: null,
    channelName: null,
    userDataFolder: null,
    enabledFeatures: [],
    disabledFeatures: [],
    webview2Flags: [],
    fieldTrials: [],
    commandLineArgs: [],
    environmentInfo: [],
  };

  const enabledSet = new Set<string>();
  const disabledSet = new Set<string>();
  const wv2FlagSet = new Set<string>();
  const trialSet = new Set<string>();
  const cmdArgSet = new Set<string>();

  for (const line of lines) {
    // Runtime version: from Creation events or version strings
    if (!config.runtimeVersion) {
      const rv = line.match(/RuntimeVersion[=:]\s*["']?(\d+\.\d+\.\d+\.\d+)/i)
        || line.match(/runtime[_\s]version[=:]\s*(\d+\.\d+\.\d+\.\d+)/i)
        || line.match(/msedgewebview2\.exe.*?(\d+\.\d+\.\d+\.\d+)/i);
      if (rv) config.runtimeVersion = rv[1];
    }

    // SDK version
    if (!config.sdkVersion) {
      const sv = line.match(/SdkVersion[=:]\s*["']?(\d+\.\d+\.\d+[\.\-]\w+)/i)
        || line.match(/sdk[_\s]version[=:]\s*(\d+\.\d+\.\d+)/i)
        || line.match(/WebView2Loader\.dll.*?(\d+\.\d+\.\d+\.\d+)/i);
      if (sv) config.sdkVersion = sv[1];
    }

    // Browser version
    if (!config.browserVersion) {
      const bv = line.match(/BrowserVersion[=:]\s*["']?(\d+\.\d+\.\d+\.\d+)/i)
        || line.match(/msedge\.dll.*?(\d+\.\d+\.\d+\.\d+)/i);
      if (bv) config.browserVersion = bv[1];
    }

    // Channel
    if (!config.channelName) {
      const ch = line.match(/Channel[=:]\s*["']?(\w+)/i);
      if (ch && ["stable", "beta", "dev", "canary", "internal"].includes(ch[1].toLowerCase())) {
        config.channelName = ch[1];
      }
    }

    // User data folder
    if (!config.userDataFolder) {
      const udf = line.match(/UserDataFolder[=:]\s*["']?([^\s"',]+)/i)
        || line.match(/user[_\s]data[_\s]dir[=:]\s*["']?([^\s"',]+)/i);
      if (udf) config.userDataFolder = udf[1];
    }

    // Enabled features
    const efMatch = line.match(/enable-features[=:]([^\s;,"]+)/i);
    if (efMatch) {
      for (const f of efMatch[1].split(",").filter(Boolean)) enabledSet.add(f.trim());
    }

    // Disabled features
    const dfMatch = line.match(/disable-features[=:]([^\s;,"]+)/i);
    if (dfMatch) {
      for (const f of dfMatch[1].split(",").filter(Boolean)) disabledSet.add(f.trim());
    }

    // WebView2-specific flags (msWebView2*, EdgeWebView*, WebView2Feature*)
    const wv2Matches = line.matchAll(/\b(msWebView2\w+|EdgeWebView\w+|WebView2Feature\w+|IsEdge\w+Enabled)\b/g);
    for (const m of wv2Matches) wv2FlagSet.add(m[1]);

    // Field trials
    const ftMatch = line.match(/field-trial[^=]*[=:]([^\s;,"]+)/i);
    if (ftMatch) {
      for (const t of ftMatch[1].split(",").filter(Boolean)) trialSet.add(t.trim());
    }

    // Interesting command line args
    const cmdPatterns = [
      /--(\w[\w-]+=\S+)/g,
      /(--no-sandbox)/g,
      /(--disable-gpu)/g,
      /(--single-process)/g,
      /(--disable-web-security)/g,
      /(--remote-debugging-port=\d+)/g,
      /(--js-flags=[^\s]+)/g,
    ];
    for (const pat of cmdPatterns) {
      const matches = line.matchAll(pat);
      for (const m of matches) {
        const arg = m[1];
        if (!arg.includes("enable-features") && !arg.includes("disable-features") &&
            !arg.includes("field-trial")) {
          cmdArgSet.add(arg);
        }
      }
    }
  }

  config.enabledFeatures = [...enabledSet].sort();
  config.disabledFeatures = [...disabledSet].sort();
  config.webview2Flags = [...wv2FlagSet].sort();
  config.fieldTrials = [...trialSet].sort();
  config.commandLineArgs = [...cmdArgSet].sort();

  return config;
}

// ─── Process extraction ─────────────────────────────────────────────

function extractProcesses(lines: string[], hostApp: string): ProcessInfo[] {
  const processMap = new Map<number, ProcessInfo>();
  const hostAppLower = hostApp.toLowerCase();

  for (const line of lines) {
    // Match: processname.exe (PID) or processname.exe     (PID)
    const procMatch = line.match(/(\S+\.exe)\s+\((\d+)\)/i)
      || line.match(/(\S+\.exe)\s*\((\d+)\)/i);
    if (!procMatch) continue;

    const name = procMatch[1];
    const pid = parseInt(procMatch[2], 10);
    const ts = extractTs(line) || 0;

    if (!processMap.has(pid)) {
      processMap.set(pid, {
        name,
        pid,
        eventCount: 0,
        firstTs: ts,
        lastTs: ts,
        role: classifyProcess(name, hostAppLower, line),
        parentPid: null,
        keyEvents: [],
        errors: [],
      });
    }

    const proc = processMap.get(pid)!;
    proc.eventCount++;
    if (ts > 0 && ts < proc.firstTs) proc.firstTs = ts;
    if (ts > proc.lastTs) proc.lastTs = ts;

    // Track key events (limit to avoid bloat)
    const eventName = extractEventName(line);
    if (eventName && isKeyEvent(eventName) && proc.keyEvents.length < 20) {
      if (!proc.keyEvents.includes(eventName)) proc.keyEvents.push(eventName);
    }

    // Track errors
    if (isErrorLine(line) && proc.errors.length < 10) {
      const errSummary = (eventName || line.slice(0, 80)).trim();
      if (!proc.errors.includes(errSummary)) proc.errors.push(errSummary);
    }

    // Detect parent PID from process start events
    const parentMatch = line.match(/ParentPID[=:]\s*(\d+)/i)
      || line.match(/Parent Process ID[=:]\s*(\d+)/i);
    if (parentMatch) proc.parentPid = parseInt(parentMatch[1], 10);
  }

  return [...processMap.values()].sort((a, b) => a.firstTs - b.firstTs);
}

function classifyProcess(name: string, hostAppLower: string, line: string): string {
  const nameLower = name.toLowerCase();

  if (nameLower.includes(hostAppLower) || nameLower.replace(".exe", "").includes(hostAppLower)) {
    return "host";
  }
  if (nameLower.includes("msedgewebview2")) {
    // Sub-classify by type hints in the line
    if (line.includes("--type=renderer") || line.includes("RendererMain")) return "renderer";
    if (line.includes("--type=utility") || line.includes("UtilityMain")) return "utility";
    if (line.includes("--type=gpu") || line.includes("GpuMain")) return "gpu";
    if (line.includes("--type=crashpad") || line.includes("crashpad")) return "crashpad";
    if (line.includes("BrowserMain") || line.includes("WebView2_Creation") || line.includes("WebView2_Factory")) return "browser";
    return "webview2";  // generic, will refine below
  }
  if (nameLower.includes("msedge")) return "edge";
  if (nameLower.includes("crashpad")) return "crashpad";
  return "other";
}

function isKeyEvent(eventName: string): boolean {
  const keyPatterns = [
    "WebView2_Creation", "WebView2_Factory", "WebView2_APICalled",
    "WebView2_NavigationStarting", "WebView2_NavigationCompleted",
    "WebView2_ContentLoading", "WebView2_DOMContentLoaded",
    "WebView2_SourceChanged", "WebView2_BrowserProcessFailure",
    "WebView2_ProcessFailed", "WebView2_Event_",
    "NavigationRequest::", "WebView2_DocState",
    "WebView2_NoHandlers", "WebView2_NavIdNotFound",
    "WebView2_DroppedEvent", "WebView2_IFrameNotFound",
    "Process/Start", "Process/End",
  ];
  return keyPatterns.some(p => eventName.includes(p));
}

function isErrorLine(line: string): boolean {
  return /\b(Failed|Failure|Error|Invalid|Timeout|Unresponsive|Crash|exception|abort)\b/i.test(line)
    && !/Process Name \( PID\)/i.test(line);
}

// ─── Process tree formatting ────────────────────────────────────────

function formatProcessTree(processes: ProcessInfo[], hostApp: string): string {
  const out: string[] = [];

  // Group by role
  const hostProcs = processes.filter(p => p.role === "host");
  const browserProcs = processes.filter(p => p.role === "browser");
  const rendererProcs = processes.filter(p => p.role === "renderer");
  const utilityProcs = processes.filter(p => p.role === "utility");
  const gpuProcs = processes.filter(p => p.role === "gpu");
  const wv2Generic = processes.filter(p => p.role === "webview2");
  const crashpadProcs = processes.filter(p => p.role === "crashpad");
  const otherProcs = processes.filter(p => ["other", "edge"].includes(p.role));

  // Try to refine generic webview2 processes
  // The first webview2 process is usually the browser
  if (browserProcs.length === 0 && wv2Generic.length > 0) {
    // Promote the one with Creation/Factory events to browser
    const browserCandidate = wv2Generic.find(p =>
      p.keyEvents.some(e => e.includes("Creation") || e.includes("Factory") || e.includes("BrowserMain"))
    ) || wv2Generic[0]; // fallback: first webview2 process
    browserCandidate.role = "browser";
    browserProcs.push(browserCandidate);
    const idx = wv2Generic.indexOf(browserCandidate);
    if (idx >= 0) wv2Generic.splice(idx, 1);

    // Rest are likely renderers
    for (const p of wv2Generic) {
      p.role = "renderer";
      rendererProcs.push(p);
    }
    wv2Generic.length = 0;
  }

  out.push("```");

  // Format each host app
  if (hostProcs.length > 0) {
    for (const host of hostProcs) {
      out.push(`📦 ${host.name} (PID ${host.pid}) [HOST]  — ${host.eventCount} events`);

      // Show browser processes under this host
      for (const bp of browserProcs) {
        const errs = bp.errors.length > 0 ? ` ⚠️ ${bp.errors.length} errors` : "";
        out.push(`  ├── 🌐 ${bp.name} (PID ${bp.pid}) [BROWSER]  — ${bp.eventCount} events${errs}`);

        // Renderers under browser
        for (let i = 0; i < rendererProcs.length; i++) {
          const rp = rendererProcs[i];
          const last = i === rendererProcs.length - 1 && utilityProcs.length === 0 && gpuProcs.length === 0;
          const connector = last ? "└──" : "├──";
          const errs2 = rp.errors.length > 0 ? ` ⚠️ ${rp.errors.length} errors` : "";
          out.push(`  │   ${connector} 📄 ${rp.name} (PID ${rp.pid}) [RENDERER]  — ${rp.eventCount} events${errs2}`);
        }

        // Utility
        for (let i = 0; i < utilityProcs.length; i++) {
          const up = utilityProcs[i];
          const last = i === utilityProcs.length - 1 && gpuProcs.length === 0;
          const connector = last ? "└──" : "├──";
          out.push(`  │   ${connector} 🔧 ${up.name} (PID ${up.pid}) [UTILITY]  — ${up.eventCount} events`);
        }

        // GPU
        for (const gp of gpuProcs) {
          out.push(`  │   └── 🎮 ${gp.name} (PID ${gp.pid}) [GPU]  — ${gp.eventCount} events`);
        }
      }

      // Generic webview2 (unclassified)
      for (const wp of wv2Generic) {
        out.push(`  ├── ❓ ${wp.name} (PID ${wp.pid}) [WEBVIEW2]  — ${wp.eventCount} events`);
      }

      // Crashpad
      for (const cp of crashpadProcs) {
        out.push(`  └── 🛡️ ${cp.name} (PID ${cp.pid}) [CRASHPAD]  — ${cp.eventCount} events`);
      }
    }
  } else {
    // No host process found — show flat
    out.push(`⚠️ Host app "${hostApp}" not found in trace. Showing all processes:`);
    for (const p of processes) {
      const icon = p.role === "browser" ? "🌐" : p.role === "renderer" ? "📄" : p.role === "utility" ? "🔧" : "❓";
      out.push(`${icon} ${p.name} (PID ${p.pid}) [${p.role.toUpperCase()}]  — ${p.eventCount} events`);
    }
  }

  // Other processes (not WebView2 related)
  if (otherProcs.length > 0) {
    out.push("");
    out.push("Other processes in trace:");
    for (const op of otherProcs.slice(0, 5)) {
      out.push(`  • ${op.name} (PID ${op.pid})  — ${op.eventCount} events`);
    }
    if (otherProcs.length > 5) out.push(`  • ... +${otherProcs.length - 5} more`);
  }

  out.push("```");
  return out.join("\n");
}

// ─── Activity summary ───────────────────────────────────────────────

function formatActivitySummary(processes: ProcessInfo[], minTs: number): string {
  const out: string[] = [];

  // Filter to processes with meaningful event counts
  const active = processes
    .filter(p => p.eventCount > 0)
    .sort((a, b) => b.eventCount - a.eventCount);

  out.push("| Process | PID | Role | Events | Active Window | Key Events | Errors |");
  out.push("|---------|-----|------|--------|---------------|------------|--------|");

  for (const p of active.slice(0, 15)) {
    const startMs = minTs > 0 ? ((p.firstTs - minTs) / 1000).toFixed(0) : "?";
    const endMs = minTs > 0 ? ((p.lastTs - minTs) / 1000).toFixed(0) : "?";
    const window = startMs !== "?" ? `+${startMs}ms → +${endMs}ms` : "—";
    const keys = p.keyEvents.slice(0, 3).join(", ") + (p.keyEvents.length > 3 ? ` +${p.keyEvents.length - 3}` : "");
    const errs = p.errors.length > 0 ? `⚠️ ${p.errors.length}` : "✅ 0";
    out.push(`| ${p.name} | ${p.pid} | ${p.role} | ${p.eventCount} | ${window} | ${keys || "—"} | ${errs} |`);
  }

  if (active.length > 15) {
    out.push(`| ... | | | | | | ${active.length - 15} more processes |`);
  }

  return out.join("\n");
}

// ─── Incarnation detection ──────────────────────────────────────────

function detectIncarnations(
  lines: string[],
  processes: ProcessInfo[],
  hostApp: string
): Incarnation[] {
  const incarnations: Incarnation[] = [];
  const hostAppLower = hostApp.toLowerCase();

  // Key lifecycle events that signal incarnation boundaries
  const creationEvents: { line: number; ts: number; pid: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("WebView2_Creation_Client") || line.includes("WebView2_FactoryCreate")) {
      const ts = extractTs(line);
      const pidMatch = line.match(/\(\s*(\d+)\s*\)/);
      if (ts !== null && pidMatch) {
        creationEvents.push({ line: i + 1, ts, pid: parseInt(pidMatch[1], 10) });
      }
    }
  }

  // If no creation events, create a single synthetic incarnation from all processes
  if (creationEvents.length === 0) {
    const allPids = processes.map(p => p.pid);
    const hostProc = processes.find(p => p.role === "host");
    const browserProc = processes.find(p => p.role === "browser" || p.role === "webview2");
    const allErrors: string[] = [];
    for (const p of processes) allErrors.push(...p.errors);

    incarnations.push({
      id: 1,
      creationTs: processes.length > 0 ? processes[0].firstTs : 0,
      creationLine: 0,
      hostPid: hostProc?.pid || null,
      browserPid: browserProc?.pid || null,
      associatedPids: allPids,
      processes,
      keyEvents: [],
      errors: allErrors,
      hasIssue: allErrors.length > 0,
      issueHint: allErrors.length > 0 ? `${allErrors.length} error(s) detected` : "",
      durationMs: 0,
    });
    return incarnations;
  }

  // Create incarnation windows between creation events
  for (let idx = 0; idx < creationEvents.length; idx++) {
    const creation = creationEvents[idx];
    const nextCreation = idx < creationEvents.length - 1 ? creationEvents[idx + 1] : null;
    const endTs = nextCreation ? nextCreation.ts : Infinity;

    // Find processes active during this incarnation window
    const incProcesses = processes.filter(p =>
      p.firstTs >= creation.ts - 1000000 && p.firstTs < endTs // 1s before creation to next creation
    );

    // If no processes matched, associate by PID from events in the time window
    const activePids = new Set<number>();
    activePids.add(creation.pid);
    for (const p of incProcesses) activePids.add(p.pid);

    // Scan for key events and errors within this incarnation window
    const keyEvts: { event: string; ts: number; line: number; pid: number }[] = [];
    const errors: string[] = [];
    const keyEventPatterns = [
      "WebView2_Creation_Client", "WebView2_FactoryCreate", "WebView2_APICalled",
      "WebView2_NavigationStarting", "WebView2_NavigationCompleted",
      "WebView2_Event_NavigationCompletedHandler", "NavigationRequest::Create",
      "NavigationRequest::CommitNavigation", "NavigationRequest::BeginNavigation",
      "WebView2_BrowserProcessFailure", "WebView2_ProcessFailed",
      "WebView2_NoHandlers", "WebView2_DroppedEvent",
      "WebView2_ContentLoading", "WebView2_DOMContentLoaded",
      "WebView2_RendererUnresponsive",
    ];

    for (let i = creation.line - 1; i < lines.length; i++) {
      const line = lines[i];
      const ts = extractTs(line);
      if (ts !== null && ts >= endTs) break;

      const pidMatch = line.match(/\(\s*(\d+)\s*\)/);
      const pid = pidMatch ? parseInt(pidMatch[1], 10) : 0;

      for (const pat of keyEventPatterns) {
        if (line.includes(pat)) {
          if (keyEvts.length < 50) {
            keyEvts.push({ event: pat, ts: ts || 0, line: i + 1, pid });
          }
          activePids.add(pid);
          break;
        }
      }

      if (isErrorLine(line) && errors.length < 10) {
        const errText = line.slice(0, 120).trim();
        if (!errors.includes(errText)) errors.push(errText);
      }
    }

    // Determine host and browser PIDs
    const hostProc = incProcesses.find(p => p.role === "host");
    const browserProc = incProcesses.find(p => p.role === "browser" || p.role === "webview2");

    // Detect if this incarnation has issues
    const hasNavStart = keyEvts.some(e => e.event.includes("NavigationStarting") || e.event.includes("NavigationRequest::Create"));
    const hasNavComplete = keyEvts.some(e => e.event.includes("NavigationCompleted"));
    const hasProcessFailure = keyEvts.some(e => e.event.includes("ProcessFailure") || e.event.includes("ProcessFailed"));
    const hasDroppedEvents = keyEvts.some(e => e.event.includes("DroppedEvent") || e.event.includes("NoHandlers"));
    const hasRendererHung = keyEvts.some(e => e.event.includes("RendererUnresponsive"));

    let hasIssue = false;
    let issueHint = "";
    if (hasProcessFailure) { hasIssue = true; issueHint = "Browser process failure detected"; }
    else if (hasRendererHung) { hasIssue = true; issueHint = "Renderer unresponsive"; }
    else if (hasNavStart && !hasNavComplete) { hasIssue = true; issueHint = "Navigation started but never completed"; }
    else if (hasDroppedEvents) { hasIssue = true; issueHint = "Events dropped (no handler registered)"; }
    else if (errors.length > 0) { hasIssue = true; issueHint = `${errors.length} error(s) detected`; }

    // Compute duration
    let incMinTs = creation.ts;
    let incMaxTs = creation.ts;
    for (const e of keyEvts) {
      if (e.ts > incMaxTs) incMaxTs = e.ts;
    }
    const durationMs = (incMaxTs - incMinTs) / 1000;

    incarnations.push({
      id: idx + 1,
      creationTs: creation.ts,
      creationLine: creation.line,
      hostPid: hostProc?.pid || creation.pid,
      browserPid: browserProc?.pid || null,
      associatedPids: [...activePids],
      processes: incProcesses.length > 0 ? incProcesses : processes.filter(p => activePids.has(p.pid)),
      keyEvents: keyEvts,
      errors,
      hasIssue,
      issueHint,
      durationMs,
    });
  }

  return incarnations;
}

function formatIncarnations(incarnations: Incarnation[]): string {
  if (incarnations.length === 0) return "No WebView2 incarnations detected.";

  const out: string[] = [];
  out.push(`Found **${incarnations.length} incarnation(s)** in trace.\n`);

  for (const inc of incarnations) {
    const issueFlag = inc.hasIssue ? " ⚠️ **HAS ISSUE**" : " ✅ OK";
    out.push(`### Incarnation #${inc.id}${issueFlag}`);
    out.push("");
    out.push("| Property | Value |");
    out.push("|----------|-------|");
    out.push(`| Creation Timestamp | ${inc.creationTs} (Line L${inc.creationLine}) |`);
    out.push(`| Duration | ${inc.durationMs.toFixed(0)}ms |`);
    out.push(`| Host PID | ${inc.hostPid || "—"} |`);
    out.push(`| Browser PID | ${inc.browserPid || "—"} |`);
    out.push(`| Associated PIDs | ${inc.associatedPids.join(", ")} |`);
    out.push("");

    // Process breakdown
    if (inc.processes.length > 0) {
      out.push("**Processes in this incarnation:**");
      out.push("");
      out.push("| Process | PID | Role | Events | Errors |");
      out.push("|---------|-----|------|--------|--------|");
      for (const p of inc.processes.slice(0, 10)) {
        const errs = p.errors.length > 0 ? `⚠️ ${p.errors.length}` : "✅ 0";
        out.push(`| ${p.name} | ${p.pid} | ${p.role} | ${p.eventCount} | ${errs} |`);
      }
      if (inc.processes.length > 10) out.push(`| ... | | | | +${inc.processes.length - 10} more |`);
      out.push("");
    }

    // Key events timeline for this incarnation
    if (inc.keyEvents.length > 0) {
      out.push("**Key events timeline:**");
      out.push("");
      out.push("| Timestamp | Event | PID | Line |");
      out.push("|-----------|-------|-----|------|");
      for (const e of inc.keyEvents.slice(0, 20)) {
        out.push(`| ${e.ts} | \`${e.event}\` | ${e.pid} | L${e.line} |`);
      }
      if (inc.keyEvents.length > 20) out.push(`| ... | +${inc.keyEvents.length - 20} more | | |`);
      out.push("");
    }

    // Issue details
    if (inc.hasIssue) {
      out.push(`> 🔴 **Issue**: ${inc.issueHint}`);
      // Identify suspect process
      const errorProcs = inc.processes.filter(p => p.errors.length > 0);
      if (errorProcs.length > 0) {
        const topErrorProc = errorProcs.sort((a, b) => b.errors.length - a.errors.length)[0];
        out.push(`> 🎯 **Suspect Process**: ${topErrorProc.name} (PID ${topErrorProc.pid}) — ${topErrorProc.errors.length} error(s)`);
        out.push(`> Errors: ${topErrorProc.errors.slice(0, 3).join("; ")}`);
      }
      out.push("");
    }

    // Errors
    if (inc.errors.length > 0) {
      out.push("**Errors in this incarnation:**");
      for (const err of inc.errors.slice(0, 5)) {
        out.push(`- \`${err}\``);
      }
      if (inc.errors.length > 5) out.push(`- ... +${inc.errors.length - 5} more`);
      out.push("");
    }
  }

  // Summary: which incarnation has the issue
  const issueIncs = incarnations.filter(i => i.hasIssue);
  if (issueIncs.length > 0) {
    out.push("### 🎯 Incarnation Summary");
    out.push("");
    out.push(`**${issueIncs.length} of ${incarnations.length}** incarnation(s) have detected issues:`);
    for (const i of issueIncs) {
      out.push(`- **Incarnation #${i.id}** (created at ts ${i.creationTs}): ${i.issueHint}`);
    }
    out.push("");
  }

  return out.join("\n");
}

function detectInitialIssues(
  lines: string[],
  processes: ProcessInfo[],
  config: Configuration,
  hostApp: string
): InitialIssue[] {
  const issues: InitialIssue[] = [];

  // 1. No host app process found
  const hasHost = processes.some(p => p.role === "host");
  if (!hasHost) {
    issues.push({
      severity: "🟡 warning",
      message: `Host app "${hostApp}" not found in trace processes`,
      evidence: `Processes found: ${processes.map(p => p.name).join(", ")}`,
    });
  }

  // 2. No browser process
  const hasBrowser = processes.some(p => p.role === "browser" || p.role === "webview2");
  if (!hasBrowser) {
    issues.push({
      severity: "🔴 critical",
      message: "No WebView2 browser process found in trace",
      evidence: "No msedgewebview2.exe or browser-role process detected",
    });
  }

  // 3. Process failures
  const hasProcessFailure = lines.some(l =>
    l.includes("WebView2_BrowserProcessFailure") || l.includes("WebView2_ProcessFailed"));
  if (hasProcessFailure) {
    issues.push({
      severity: "🔴 critical",
      message: "WebView2 browser process failure detected",
      evidence: "WebView2_BrowserProcessFailure or WebView2_ProcessFailed event found",
    });
  }

  // 4. Creation failures
  const hasCreationFailure = lines.some(l => l.includes("WebView2_CreationFailure"));
  if (hasCreationFailure) {
    issues.push({
      severity: "🔴 critical",
      message: "WebView2 creation failure detected",
      evidence: "WebView2_CreationFailure event found — WebView2 failed to initialize",
    });
  }

  // 5. Missing NavigationCompleted (common issue)
  const hasNavStart = lines.some(l => l.includes("WebView2_NavigationStarting"));
  const hasNavComplete = lines.some(l => l.includes("WebView2_NavigationCompleted"));
  if (hasNavStart && !hasNavComplete) {
    issues.push({
      severity: "🟡 warning",
      message: "NavigationStarting found but NavigationCompleted never received",
      evidence: "Navigation may be stuck or suppressed",
    });
  }

  // 6. No handlers registered
  const noHandlersCount = lines.filter(l => l.includes("WebView2_NoHandlers")).length;
  if (noHandlersCount > 0) {
    issues.push({
      severity: "🟡 warning",
      message: `${noHandlersCount} event(s) fired with no handlers registered`,
      evidence: "WebView2_NoHandlers — events are being dropped because host hasn't registered handlers",
    });
  }

  // 7. Dropped events
  const droppedCount = lines.filter(l =>
    l.includes("WebView2_DroppedEvent") || l.includes("WebView2_NoEventDispatcher")).length;
  if (droppedCount > 0) {
    issues.push({
      severity: "🟡 warning",
      message: `${droppedCount} event(s) dropped`,
      evidence: "WebView2_DroppedEvent or WebView2_NoEventDispatcher",
    });
  }

  // 8. NavId mismatch
  if (lines.some(l => l.includes("WebView2_NavIdNotFound") || l.includes("WebView2_DifferentNavigationId"))) {
    issues.push({
      severity: "🟡 warning",
      message: "NavigationId mismatch or not found",
      evidence: "WebView2_NavIdNotFound or WebView2_DifferentNavigationId — events may target wrong navigation",
    });
  }

  // 9. DocState suppressed
  if (lines.some(l => l.includes("WebView2_DocStateSuppressed"))) {
    issues.push({
      severity: "🟡 warning",
      message: "Document state change was suppressed",
      evidence: "WebView2_DocStateSuppressed — likely about:blank initial navigation suppression",
    });
  }

  // 10. Auth/token issues
  const hasTokenFailure = lines.some(l =>
    l.includes("TokenBroker") && (l.includes("Failed") || l.includes("Error")));
  if (hasTokenFailure) {
    issues.push({
      severity: "🟡 warning",
      message: "Authentication token failure detected",
      evidence: "TokenBroker failure — may cause auth-related WebView2 issues",
    });
  }

  // 11. Errors per process
  for (const proc of processes) {
    if (proc.errors.length >= 3) {
      issues.push({
        severity: "🟡 warning",
        message: `Process ${proc.name} (PID ${proc.pid}) has ${proc.errors.length} errors`,
        evidence: proc.errors.slice(0, 3).join("; "),
      });
    }
  }

  // 12. Very short trace (might be incomplete) — use iterative min/max to avoid stack overflow
  let tsMin = Infinity;
  let tsMax = -Infinity;
  let tsCount = 0;
  for (const line of lines) {
    const t = extractTs(line);
    if (t !== null) {
      if (t < tsMin) tsMin = t;
      if (t > tsMax) tsMax = t;
      tsCount++;
    }
  }
  if (tsCount > 10) {
    const spanMs = (tsMax - tsMin) / 1000;
    if (spanMs < 100) {
      issues.push({
        severity: "🔵 info",
        message: `Trace is very short (${spanMs.toFixed(0)}ms) — may be incomplete`,
        evidence: `Only ${tsCount} timestamped events in ${spanMs.toFixed(0)}ms`,
      });
    }
  }

  // 13. Large gaps (>2s) — sample timestamps to detect gaps without sorting huge arrays
  if (tsCount > 1) {
    // Sample every Nth line to find large gaps (efficient for huge traces)
    const sampleStep = Math.max(1, Math.floor(lines.length / 5000));
    const sampledTs: number[] = [];
    for (let i = 0; i < lines.length; i += sampleStep) {
      const t = extractTs(lines[i]);
      if (t !== null) sampledTs.push(t);
    }
    sampledTs.sort((a, b) => a - b);
    for (let i = 1; i < sampledTs.length; i++) {
      const gapMs = (sampledTs[i] - sampledTs[i - 1]) / 1000;
      if (gapMs > 2000) {
        issues.push({
          severity: "🔵 info",
          message: `Large gap of ${(gapMs / 1000).toFixed(1)}s detected in trace`,
          evidence: `Gap between events at +${((sampledTs[i - 1] - sampledTs[0]) / 1000).toFixed(0)}ms and +${((sampledTs[i] - sampledTs[0]) / 1000).toFixed(0)}ms`,
        });
        break;
      }
    }
  }

  return issues;
}

function formatIssues(issues: InitialIssue[]): string {
  if (issues.length === 0) return "✅ No issues detected in initial scan.";

  const out: string[] = [];
  const critical = issues.filter(i => i.severity.includes("critical"));
  const warnings = issues.filter(i => i.severity.includes("warning"));
  const info = issues.filter(i => i.severity.includes("info"));

  if (critical.length > 0) {
    out.push(`**${critical.length} critical issue(s):**`);
    for (const i of critical) {
      out.push(`- ${i.severity} **${i.message}**`);
      out.push(`  _${i.evidence}_`);
    }
    out.push("");
  }

  if (warnings.length > 0) {
    out.push(`**${warnings.length} warning(s):**`);
    for (const w of warnings) {
      out.push(`- ${w.severity} ${w.message}`);
      out.push(`  _${w.evidence}_`);
    }
    out.push("");
  }

  if (info.length > 0) {
    out.push(`**${info.length} informational:**`);
    for (const i of info) {
      out.push(`- ${i.severity} ${i.message}`);
    }
  }

  return out.join("\n");
}

// ─── Common helpers ─────────────────────────────────────────────────

function extractTs(line: string): number | null {
  const m = line.match(/,\s*(\d{5,})/);
  return m ? parseInt(m[1], 10) : null;
}

function extractEventName(line: string): string | null {
  const match = line.match(/^\s*(\S+?)[\s,\/]/);
  if (match) return match[1].replace(/[,\/]+$/, "");
  return null;
}
