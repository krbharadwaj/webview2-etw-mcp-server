import { loadJson } from "../knowledge/loader.js";

interface FlagEntry {
  description: string;
  impact: string;
  relatedRootCause: string | null;
  riskLevel: string;
  category: string;
}

interface KnownFlags {
  _metadata: { version: string; description: string; lastUpdated: string };
  flags: Record<string, FlagEntry>;
}

function tryLoadFlags(): KnownFlags | null {
  try {
    return loadJson<KnownFlags>("known_flags.json");
  } catch {
    return null;
  }
}

/**
 * Look up a specific feature flag by name (exact or partial match).
 */
export function lookupFlag(flagName: string): string {
  const data = tryLoadFlags();
  if (!data) return "❌ Could not load known_flags.json";

  const flags = data.flags;
  const lower = flagName.toLowerCase();

  // Exact match first
  const exact = Object.entries(flags).find(
    ([k]) => k.toLowerCase() === lower
  );
  if (exact) return formatFlag(exact[0], exact[1]);

  // Partial match
  const partials = Object.entries(flags).filter(
    ([k]) => k.toLowerCase().includes(lower)
  );

  if (partials.length === 0) {
    return `❌ No flag found matching "${flagName}".\n\nUse category or list_all to browse available flags.`;
  }
  if (partials.length === 1) return formatFlag(partials[0][0], partials[0][1]);

  // Multiple matches — show summary
  let out = `🔍 Found ${partials.length} flags matching "${flagName}":\n\n`;
  for (const [name, flag] of partials) {
    out += `• **${name}** [${flag.riskLevel.toUpperCase()}] — ${flag.description}\n`;
  }
  out += `\nUse the exact flag name for full details.`;
  return out;
}

/**
 * List all flags in a category.
 */
export function listFlagsByCategory(category: string): string {
  const data = tryLoadFlags();
  if (!data) return "❌ Could not load known_flags.json";

  const lower = category.toLowerCase();
  const matched = Object.entries(data.flags).filter(
    ([, f]) => f.category.toLowerCase() === lower
  );

  if (matched.length === 0) {
    const cats = [...new Set(Object.values(data.flags).map((f) => f.category))].sort();
    return `❌ No category "${category}". Available categories:\n${cats.map((c) => `• ${c}`).join("\n")}`;
  }

  // Sort by risk level
  const riskOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  matched.sort((a, b) => (riskOrder[a[1].riskLevel] ?? 9) - (riskOrder[b[1].riskLevel] ?? 9));

  let out = `## ${category.charAt(0).toUpperCase() + category.slice(1)} Flags (${matched.length})\n\n`;
  out += `| Flag | Risk | Description |\n|------|------|-------------|\n`;
  for (const [name, flag] of matched) {
    const risk = flag.riskLevel === "critical" ? "🔴" : flag.riskLevel === "high" ? "🟠" : flag.riskLevel === "medium" ? "🟡" : "🟢";
    out += `| \`${name}\` | ${risk} ${flag.riskLevel} | ${flag.description} |\n`;
  }
  return out;
}

/**
 * List all categories with counts.
 */
export function listAllCategories(): string {
  const data = tryLoadFlags();
  if (!data) return "❌ Could not load known_flags.json";

  const cats: Record<string, { count: number; critical: number; high: number }> = {};
  for (const flag of Object.values(data.flags)) {
    if (!cats[flag.category]) cats[flag.category] = { count: 0, critical: 0, high: 0 };
    cats[flag.category].count++;
    if (flag.riskLevel === "critical") cats[flag.category].critical++;
    if (flag.riskLevel === "high") cats[flag.category].high++;
  }

  const total = Object.values(data.flags).length;
  let out = `## WebView2 Feature Flags (${total} total)\n\n`;
  out += `| Category | Count | ⚠️ Critical/High |\n|----------|-------|------------------|\n`;
  for (const [cat, info] of Object.entries(cats).sort((a, b) => b[1].count - a[1].count)) {
    const warnings = info.critical + info.high;
    out += `| ${cat} | ${info.count} | ${warnings > 0 ? `${warnings} flags` : "—"} |\n`;
  }
  out += `\nUse \`category\` parameter to list flags in a specific category.`;
  return out;
}

/**
 * Find flags relevant to a scenario/symptom.
 */
export function findFlagsForScenario(scenario: string): string {
  const data = tryLoadFlags();
  if (!data) return "❌ Could not load known_flags.json";

  const lower = scenario.toLowerCase();
  const keywords = lower.split(/[\s,]+/).filter((w) => w.length > 2);

  const scored: [string, FlagEntry, number][] = [];
  for (const [name, flag] of Object.entries(data.flags)) {
    let score = 0;
    const searchText = `${name} ${flag.description} ${flag.impact} ${flag.category} ${flag.relatedRootCause || ""}`.toLowerCase();
    for (const kw of keywords) {
      if (searchText.includes(kw)) score++;
    }
    if (score > 0) scored.push([name, flag, score]);
  }

  scored.sort((a, b) => b[2] - a[2]);
  const top = scored.slice(0, 10);

  if (top.length === 0) {
    return `No flags found matching scenario "${scenario}". Try broader keywords like: proxy, gpu, navigation, security, performance, memory, dpi, debug.`;
  }

  let out = `## Flags Relevant to: "${scenario}"\n\n`;
  for (const [name, flag] of top) {
    out += formatFlag(name, flag) + "\n---\n\n";
  }
  return out;
}

function formatFlag(name: string, flag: FlagEntry): string {
  const riskIcon =
    flag.riskLevel === "critical" ? "🔴" : flag.riskLevel === "high" ? "🟠" : flag.riskLevel === "medium" ? "🟡" : "🟢";

  let out = `### ${riskIcon} \`${name}\`\n`;
  out += `**Category:** ${flag.category} | **Risk:** ${flag.riskLevel}\n\n`;
  out += `**What it does:** ${flag.description}\n\n`;
  out += `**Impact & when to use:**\n${flag.impact}\n\n`;

  // Scenario guidance based on category and flag characteristics
  out += `**Helpful scenarios:**\n`;
  out += getScenarioGuidance(name, flag);

  if (flag.relatedRootCause) {
    out += `\n**Related root cause:** \`${flag.relatedRootCause}\` (see rca_taxonomy.json)\n`;
  }

  out += `\n**⚠️ Production use:** `;
  if (flag.riskLevel === "critical") {
    out += `**DO NOT USE in production.** Severe security or stability risk.`;
  } else if (flag.riskLevel === "high") {
    out += `**Not recommended for production** unless absolutely necessary with security review.`;
  } else if (flag.riskLevel === "medium") {
    out += `Use with caution. Test thoroughly before deploying.`;
  } else {
    out += `Generally safe for production use.`;
  }

  return out;
}

function getScenarioGuidance(name: string, flag: FlagEntry): string {
  const guides: Record<string, string> = {
    "disable-gpu": "• App shows blank/white page → try this to rule out GPU driver issue\n• WebGL crashes causing content flash → this forces software rendering\n• GPU process restart loop → this prevents GPU process from launching\n",
    "RendererAppContainer": "• Renderer crashes on first navigation in Low-IL apps → DISABLE this flag\n• Security hardening testing → ENABLE to test AppContainer isolation\n• Bug 48452932 repro → this was the root cause\n",
    "no-sandbox": "• Debugging process isolation issues → temporarily disable sandbox\n• Testing in restricted environments where sandboxing fails\n• ⚠️ NEVER ship with this flag — removes all process isolation\n",
    "disable-web-security": "• Testing cross-origin scenarios during development\n• Debugging CORS issues → temporarily bypass same-origin\n• ⚠️ NEVER ship — allows any site to read any other site's data\n",
    "msWebView2CancelInitialNavigation": "• Startup performance optimization → skip about:blank navigation\n• App deadlocks waiting for initial NavigationCompleted → this cancels it\n• Host app doesn't need initial NavigationCompleted event\n",
    "proxy-server": "• App needs to route through specific proxy in corporate environment\n• Testing proxy-related auth failures\n• Debugging proxy bypass issues (combine with proxy-bypass-list)\n",
    "ignore-certificate-errors": "• Development with self-signed certificates on localhost\n• Testing against staging servers with invalid certs\n• ⚠️ NEVER ship — silently accepts all certificates including malicious ones\n",
    "log-net-log": "• Diagnosing TLS handshake failures → capture full network log\n• Debugging proxy authentication issues\n• Investigating slow network requests or connection timeouts\n",
    "auto-open-devtools-for-tabs": "• Quick debugging during development\n• ⚠️ May trigger service worker force-update stall (CL 6619069) when DevTools detaches\n",
    "remote-debugging-port": "• Automation testing with CDP (Chrome DevTools Protocol)\n• Remote debugging on test devices\n• ⚠️ Exposes debugging port — security risk if network-accessible\n",
    "msWebViewAllowLocalNetworkAccessChecks": "• App accesses local/loopback services and broke after WV2 143 update\n• Testing LNA (Local Network Access) security behavior\n• Enterprise apps communicating with localhost APIs\n",
    "force-device-scale-factor": "• Testing DPI scaling at specific scale factors\n• Diagnosing rendering issues on high-DPI monitors\n• Reproducing scaling bugs on standard-DPI dev machine\n",
    "edge-webview-no-dpi-workaround": "• App compat shim causing DPI issues → disable the workaround\n• Browser process inheriting wrong DPI awareness from host\n",
    "msWebView2BrowserHitTransparent": "• Testing input pass-through for overlay/transparent WebView scenarios\n• App needs to handle input events instead of WebView2\n• ⚠️ May cause app crash or freeze\n",
    "msWebView2CodeCache": "• Improving JS load times for apps using SetVirtualHostNameToFolderMapping\n• Apps with WebResourceRequested that serve custom responses\n• 3rd+ page loads become faster via bytecode caching\n",
    "disk-cache-size": "• Controlling UDF bloat in long-running apps → set lower cache limit\n• Reducing disk usage for kiosk/embedded scenarios\n• Testing cache eviction behavior\n",
    "js-flags": "• Tuning V8 garbage collector for memory-sensitive scenarios\n• --scavenger_max_new_space_capacity_mb=8 → reduce JS heap memory\n• Diagnosing GC-related jank or memory growth\n",
    "msWebView2SimulateMemoryPressureWhenInactive": "• Testing how app handles memory reclamation when WebView goes inactive\n• Reducing memory footprint in multi-WebView apps\n• ⚠️ May cause page reloads when WebView reactivated\n",
    "SpareRendererForSitePerProcess": "• Improving navigation speed by pre-spawning renderer\n• Trade-off: faster nav at cost of higher baseline memory\n",
    "incognito": "• Scenarios requiring clean state on every launch\n• Testing without cached data or cookies\n• ⚠️ Breaks SSO unless combined with msSingleSignOnForInPrivateWebView2\n",
    "msSingleSignOnForInPrivateWebView2": "• Enabling SSO in InPrivate/incognito WebView2 sessions\n• Use with msAllowAmbientAuthInPrivateWebView2 for ambient auth\n",
    "allow-run-as-system": "• Windows service hosting WebView2 as SYSTEM account\n• ⚠️ Not recommended — use a service account instead\n",
    "block-new-web-contents": "• Preventing unwanted popups in controlled/kiosk environments\n• Blocking window.open calls in embedded scenarios\n• ⚠️ May break auth flows that use popup windows\n",
    "msWebView2EnableDraggableRegions": "• Creating custom titlebar with draggable regions in WebView2\n• App-region: drag CSS for frameless window experiences\n",
    "msWebView2TextureStream": "• Custom video composition pipelines in WebView2\n• Streaming captured video frames for JS processing\n",
    "sdsm-state": "• Testing security-hardened mode impact on app\n• strict mode disables JIT → significant JS perf impact\n• Testing if app works without JIT compilation\n",
    "long-animation-frame-timing": "• Debugging animation jank and performance bottlenecks\n• Identifying frames exceeding 16.67ms budget\n",
    "msWebView2TreatAppSuspendAsDeviceSuspend": "• Power-saving for background apps → pause all timers when suspended\n• ⚠️ May cause unexpected behavior when WebView resumes\n",
    "allow-insecure-localhost": "• Development with HTTP-only localhost servers\n• Testing without setting up local HTTPS certificates\n",
    "do-not-de-elevate": "• Debugging elevation/de-elevation loops during WebView2 launch\n• Related to integrity level regression scenarios\n",
    "allow-file-access-from-files": "• Apps loading local HTML that references other local files\n• file:// URI cross-referencing for offline/packaged apps\n",
    "msEnhancedTrackingPreventionEnabled": "• Adding tracking protection to WebView2 apps\n• ⚠️ May break sites relying on third-party cookies\n",
    "disable-site-isolation-trials": "• Testing without site isolation → reduced process count\n• ⚠️ Reduces security — cross-origin data accessible in same process\n",
    "msWebView2EnableTracing": "• Enabling ETW trace collection for WebView2 diagnostics\n• Required for ETL-based debugging workflows\n",
  };

  if (guides[name]) return guides[name];

  // Generic guidance based on category
  const catGuides: Record<string, string> = {
    security: "• Testing security-related behavior changes\n• Diagnosing permission or isolation issues\n",
    network: "• Diagnosing network connectivity or proxy issues\n• Testing with custom network configurations\n",
    performance: "• Investigating performance regressions or optimizations\n• Tuning resource usage for specific deployment scenarios\n",
    display: "• Diagnosing rendering or display issues\n• Testing DPI/scaling behavior\n",
    navigation: "• Debugging navigation failures or content loading issues\n",
    initialization: "• Troubleshooting WebView2 creation or startup failures\n",
    debugging: "• Enabling diagnostic capabilities during development\n",
    authentication: "• Configuring SSO or authentication behavior\n",
    media: "• Enabling media-related capabilities\n",
  };

  return catGuides[flag.category] || "• Consult documentation for specific use cases\n";
}
