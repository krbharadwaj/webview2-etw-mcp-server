using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using Microsoft.Diagnostics.Tracing;
using Microsoft.Diagnostics.Tracing.Etlx;
using Microsoft.Diagnostics.Tracing.Parsers;
using Microsoft.Windows.EventTracing;
using Microsoft.Windows.EventTracing.Cpu;
using Microsoft.Windows.EventTracing.Processes;
using Microsoft.Windows.EventTracing.Symbols;

/// <summary>
/// Fast ETL → filtered text extraction using TraceEvent.
/// Replaces: xperf -a dumper | Select-String -Pattern "..."
/// Subscribes only to relevant providers, skips kernel noise entirely.
/// Output format matches xperf dumper so existing MCP analysis code works unchanged.
///
/// --cpu mode: Uses TraceProcessor for native CPU sample extraction with symbol resolution.
/// Replaces the slow xperf -symbols -a dumper | Select-String pipeline.
/// </summary>
class Program
{
    static int Main(string[] args)
    {
        if (args.Length < 2)
        {
            Console.Error.WriteLine("Usage: EtlExtract <etl-path> <host-app> [output-path] [--feature-flags <ff-output>] [--pid <host-pid>]");
            Console.Error.WriteLine("       EtlExtract <etl-path> <host-app> --cpu --pid <pid> [--range-start <us>] [--range-end <us>] [--keywords kw1,kw2] [--output <path>] [--sympath <path>]");
            Console.Error.WriteLine();
            Console.Error.WriteLine("  Extracts WebView2-relevant events from ETL using TraceEvent.");
            Console.Error.WriteLine("  Output is xperf-dumper compatible text for MCP server analysis.");
            Console.Error.WriteLine();
            Console.Error.WriteLine("Modes:");
            Console.Error.WriteLine("  (default)             Event extraction — filtered events as text.");
            Console.Error.WriteLine("  --cpu                 CPU sample extraction — symbol-resolved call stacks via TraceProcessor.");
            Console.Error.WriteLine();
            Console.Error.WriteLine("Options (both modes):");
            Console.Error.WriteLine("  --pid <pid>           Filter to this host PID and its child processes only.");
            Console.Error.WriteLine("  --feature-flags <path> Write feature flag lines to a separate file.");
            Console.Error.WriteLine();
            Console.Error.WriteLine("Options (--cpu mode):");
            Console.Error.WriteLine("  --range-start <us>    Start of time range in microseconds (relative to trace start).");
            Console.Error.WriteLine("  --range-end <us>      End of time range in microseconds.");
            Console.Error.WriteLine("  --keywords <kw1,kw2>  Comma-separated keywords to match against function/module names.");
            Console.Error.WriteLine("  --output <path>       Output file path (default: C:\\temp\\cpu_analysis\\cpu_pid_<pid>.json).");
            Console.Error.WriteLine("  --sympath <path>      Symbol path override (default: Chromium + Microsoft + Edge symbol servers).");
            return 1;
        }

        // Check for --cpu mode
        if (args.Contains("--cpu"))
            return CpuAnalyzer.Run(args);

        string etlPath = args[0];
        string hostApp = args[1];
        string outputPath = args.Length > 2 && !args[2].StartsWith("--") ? args[2] : Path.Combine("C:\\temp\\etl_analysis", "filtered.txt");
        string? featureFlagsPath = null;
        int? rootPid = null;

        for (int i = 0; i < args.Length - 1; i++)
        {
            if (args[i] == "--feature-flags")
                featureFlagsPath = args[i + 1];
            if (args[i] == "--pid" && int.TryParse(args[i + 1], out int parsedPid))
                rootPid = parsedPid;
        }

        if (!File.Exists(etlPath))
        {
            Console.Error.WriteLine($"ETL file not found: {etlPath}");
            return 1;
        }

        Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);

        var sw = Stopwatch.StartNew();
        var hostAppLower = hostApp.ToLowerInvariant();

        // Patterns to match (same as analyze.ts Step 2 + Step 3 combined into single pass)
        string[] eventPatterns = [
            hostAppLower, "webview2_", "msedgewebview2", "navigationrequest",
            "serviceworker", "tokenbroker", "webtokenrequest", "browsermain",
            "documentloader", "renderermain", "v8.",
            // Feature flag patterns (Step 3 — merged)
            "enable-features", "disable-features", "field-trial",
            "mswebview2", "edgewebview", "webview2feature", "experimentalfeature",
            "featurelist", "commandline", "process/start"
        ];

        int matchCount = 0;
        int totalEvents = 0;
        int featureFlagCount = 0;
        int pidFilteredCount = 0;
        var featureFlagLines = featureFlagsPath != null ? new List<string>() : null;

        // Process tree tracking — ALWAYS active
        // allowedPids: PIDs in the host app's process tree (host + its WebView2 children)
        // Events from PIDs outside this tree are filtered out
        var allowedPids = new HashSet<int>();
        if (rootPid.HasValue)
            allowedPids.Add(rootPid.Value);

        // Track which host PIDs were auto-discovered by name
        var discoveredHostPids = new HashSet<int>();

        // Feature flag specific patterns
        string[] ffPatterns = [
            "enable-features", "disable-features", "field-trial",
            "mswebview2", "edgewebview", "webview2feature", "experimentalfeature",
            "featurelist", "commandline", "process/start"
        ];

        try
        {
            using var writer = new StreamWriter(outputPath, false, Encoding.UTF8, bufferSize: 1 << 16);

            using var source = new ETWTraceEventSource(etlPath);

            // Subscribe to ALL dynamic events — callback does fast in-memory filtering
            // (no text serialization of skipped events, unlike xperf dumper)
            source.Dynamic.All += (Microsoft.Diagnostics.Tracing.TraceEvent data) =>
            {
                totalEvents++;

                // Format in xperf-dumper style:
                // EventName, Timestamp(µs), ProcessName (PID), ThreadID, Opcode, ...payload...
                string eventName = data.EventName ?? "UnknownEvent";
                int pid = data.ProcessID;
                string processName = data.ProcessName ?? "Unknown";
                // TraceEvent strips .exe — add it back for xperf compatibility
                if (!string.IsNullOrEmpty(processName) && processName != "Unknown"
                    && !processName.Contains('.') && pid >= 0)
                    processName += ".exe";
                int tid = data.ThreadID;
                long tsUs = (long)(data.TimeStampRelativeMSec * 1000);
                string opcode = data.Opcode.ToString();

                // Fast check: does event name or process match our patterns?
                string eventLower = eventName.ToLowerInvariant();
                string processLower = processName.ToLowerInvariant();

                bool matches = false;
                for (int i = 0; i < eventPatterns.Length; i++)
                {
                    if (eventLower.Contains(eventPatterns[i]) || processLower.Contains(eventPatterns[i]))
                    {
                        matches = true;
                        break;
                    }
                }

                // Also check payload for key patterns (CommandLine args, etc.)
                string? payloadText = null;
                if (!matches)
                {
                    try
                    {
                        payloadText = data.ToString();
                        string payloadLower = payloadText.ToLowerInvariant();
                        for (int i = 0; i < eventPatterns.Length; i++)
                        {
                            if (payloadLower.Contains(eventPatterns[i]))
                            {
                                matches = true;
                                break;
                            }
                        }
                    }
                    catch { }
                }

                if (!matches) return;

                // Process tree filter (always active):
                //   - Host app by name → always include (add PID to tree)
                //   - PID in discovered tree → include
                //   - Tree not yet built (no host discovered) → include as fallback
                //   - Otherwise → skip (belongs to a different host's tree)
                if (processLower.Contains(hostAppLower))
                {
                    // Host app process — always include, ensure it's in the tree
                    if (!allowedPids.Contains(pid))
                    {
                        allowedPids.Add(pid);
                        discoveredHostPids.Add(pid);
                    }
                }
                else if (allowedPids.Count > 0 && !allowedPids.Contains(pid))
                {
                    // Tree is built but this PID isn't in it — skip
                    pidFilteredCount++;
                    return;
                }

                WriteEventLine(writer, eventName, tsUs, processName, pid, tid, opcode, data, ref matchCount, featureFlagLines, ffPatterns, ref featureFlagCount);

                // Progress every 10k matches
                if (matchCount % 10000 == 0)
                    Console.Error.Write($"\r  {matchCount:N0} events matched ({totalEvents:N0} processed)...");
            };

            // Subscribe to kernel Process/Start events for process tree building
            source.Kernel.ProcessStart += (data) =>
            {
                totalEvents++;
                string processName = data.ImageFileName ?? "Unknown";
                if (!string.IsNullOrEmpty(processName) && !processName.Contains('.'))
                    processName += ".exe";
                string processLower = processName.ToLowerInvariant();
                int childPid = data.ProcessID;
                int parentPid = data.ParentID;

                // Build process tree (always active):
                // - Host app by name → add to tree + discoveredHostPids
                // - Child of a known tree PID → add to tree
                if (processLower.Contains(hostAppLower))
                {
                    discoveredHostPids.Add(childPid);
                    allowedPids.Add(childPid);
                }
                else if (allowedPids.Contains(parentPid))
                {
                    allowedPids.Add(childPid);
                }

                // Only include processes matching our patterns
                bool matches = false;
                for (int i = 0; i < eventPatterns.Length; i++)
                {
                    if (processLower.Contains(eventPatterns[i]))
                    {
                        matches = true;
                        break;
                    }
                }
                // Also check command line for matching patterns
                if (!matches)
                {
                    string cmdLower = (data.CommandLine ?? "").ToLowerInvariant();
                    for (int i = 0; i < eventPatterns.Length; i++)
                    {
                        if (cmdLower.Contains(eventPatterns[i]))
                        {
                            matches = true;
                            break;
                        }
                    }
                }
                if (!matches) return;

                // Process tree filter: skip Process/Start for processes outside the tree
                if (allowedPids.Count > 0 && !allowedPids.Contains(childPid))
                {
                    pidFilteredCount++;
                    return;
                }

                long tsUs = (long)(data.TimeStampRelativeMSec * 1000);
                var sb = new StringBuilder(256);
                sb.Append("Process/Start".PadLeft(24));
                sb.Append(", ");
                sb.Append(tsUs.ToString().PadLeft(10));
                sb.Append(", ");
                sb.Append($"{processName} ({data.ProcessID})".PadLeft(30));
                sb.Append(", ");
                sb.Append(data.ThreadID.ToString().PadLeft(10));
                sb.Append(", Info");
                sb.Append($", ParentID={data.ParentID}");
                sb.Append($", CommandLine={data.CommandLine}");
                writer.WriteLine(sb.ToString());
                matchCount++;

                // Check feature flags in command line
                if (featureFlagLines != null)
                {
                    string line = sb.ToString();
                    string lineLower = line.ToLowerInvariant();
                    for (int i = 0; i < ffPatterns.Length; i++)
                    {
                        if (lineLower.Contains(ffPatterns[i]))
                        {
                            featureFlagLines.Add(line);
                            featureFlagCount++;
                            break;
                        }
                    }
                }
            };

            Console.Error.WriteLine($"Processing: {Path.GetFileName(etlPath)}");
            Console.Error.WriteLine($"Host app:   {hostApp}");
            if (rootPid.HasValue)
                Console.Error.WriteLine($"PID filter: {rootPid.Value} (explicit root + children)");
            else
                Console.Error.WriteLine($"PID filter: auto (discovering {hostApp} PIDs and their children)");
            Console.Error.WriteLine($"Output:     {outputPath}");
            Console.Error.WriteLine();

            source.Process();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error processing ETL: {ex.Message}");
            return 2;
        }

        sw.Stop();

        // Write feature flags file if requested
        if (featureFlagLines != null && featureFlagsPath != null)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(featureFlagsPath)!);
            File.WriteAllLines(featureFlagsPath, featureFlagLines, Encoding.UTF8);
            Console.Error.WriteLine($"Feature flags: {featureFlagCount:N0} lines → {featureFlagsPath}");
        }

        Console.Error.WriteLine();
        Console.Error.WriteLine($"Done in {sw.Elapsed.TotalSeconds:F1}s");
        Console.Error.WriteLine($"  Total events:   {totalEvents:N0}");
        Console.Error.WriteLine($"  Matched events: {matchCount:N0}");
        if (pidFilteredCount > 0)
            Console.Error.WriteLine($"  PID-filtered:   {pidFilteredCount:N0} events skipped (outside process tree)");
        if (allowedPids.Count > 0)
            Console.Error.WriteLine($"  Process tree:   {allowedPids.Count} PIDs tracked ({string.Join(", ", allowedPids.OrderBy(p => p).Take(10))}{(allowedPids.Count > 10 ? "..." : "")})");
        if (discoveredHostPids.Count > 0)
            Console.Error.WriteLine($"  Host PIDs:      {string.Join(", ", discoveredHostPids.OrderBy(p => p))}");Console.Error.WriteLine($"  Output:         {outputPath}");

        // Machine-readable summary on stdout (for MCP server to parse)
        Console.WriteLine($"EXTRACT_OK|{matchCount}|{totalEvents}|{sw.Elapsed.TotalSeconds:F1}|{outputPath}");
        return 0;
    }

    static void WriteEventLine(StreamWriter writer, string eventName, long tsUs, string processName, int pid, int tid, string opcode, Microsoft.Diagnostics.Tracing.TraceEvent data, ref int matchCount, List<string>? featureFlagLines, string[] ffPatterns, ref int featureFlagCount)
    {
        var sb = new StringBuilder(256);
        sb.Append(eventName.PadLeft(24));
        sb.Append(", ");
        sb.Append(tsUs.ToString().PadLeft(10));
        sb.Append(", ");
        sb.Append($"{processName} ({pid})".PadLeft(30));
        sb.Append(", ");
        sb.Append(tid.ToString().PadLeft(10));
        sb.Append(", ");
        sb.Append(opcode);

        // Append payload fields
        try
        {
            for (int i = 0; i < data.PayloadNames.Length && i < 20; i++)
            {
                sb.Append(", ");
                var val = data.PayloadValue(i);
                sb.Append(data.PayloadNames[i]);
                sb.Append('=');
                sb.Append(val?.ToString() ?? "");
            }
        }
        catch { }

        string line = sb.ToString();
        writer.WriteLine(line);
        matchCount++;

        // Also collect feature flag lines (single pass)
        if (featureFlagLines != null)
        {
            string lineLower = line.ToLowerInvariant();
            for (int i = 0; i < ffPatterns.Length; i++)
            {
                if (lineLower.Contains(ffPatterns[i]))
                {
                    featureFlagLines.Add(line);
                    featureFlagCount++;
                    break;
                }
            }
        }
    }
}

/// <summary>
/// Native CPU sample extraction using TraceProcessor (Microsoft.Windows.EventTracing).
/// Replaces: xperf -symbols -a dumper | Select-String "SampledProfile.*\(PID\)"
///
/// Uses:
///   - trace.UseCpuSamplingData() for structured CPU sample events
///   - trace.UseSymbols() for symbol resolution from symbol servers
///   - Stack walking via ICpuSample.Stack for resolved call stacks
///   - Native PID and time-range filtering (no regex post-processing)
///
/// Output: JSON with aggregated CPU data + raw sample lines for backward compat.
/// </summary>
static class CpuAnalyzer
{
    // Default symbol servers: Chromium + Windows OS + Edge (corpnet)
    static readonly string DefaultSymbolPath = string.Join(";",
        "srv*C:\\Symbols*https://chromium-browser-symsrv.commondatastorage.googleapis.com",
        "srv*C:\\Symbols*http://msdl.microsoft.com/download/symbols",
        "srv*C:\\Symbols*https://symweb.azurefd.net"
    );

    public static int Run(string[] args)
    {
        string etlPath = args[0];
        string hostApp = args[1];
        int? pid = null;
        long? rangeStartUs = null;
        long? rangeEndUs = null;
        string[] keywords = ["msedge.dll", "msedgewebview2.dll"];
        string? outputPath = null;
        string? symPath = null;

        // Parse args
        for (int i = 0; i < args.Length - 1; i++)
        {
            switch (args[i])
            {
                case "--pid":
                    if (int.TryParse(args[i + 1], out int p)) pid = p;
                    break;
                case "--range-start":
                    if (long.TryParse(args[i + 1], out long rs)) rangeStartUs = rs;
                    break;
                case "--range-end":
                    if (long.TryParse(args[i + 1], out long re)) rangeEndUs = re;
                    break;
                case "--keywords":
                    keywords = args[i + 1].Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                    break;
                case "--output":
                    outputPath = args[i + 1];
                    break;
                case "--sympath":
                    symPath = args[i + 1];
                    break;
            }
        }

        if (!File.Exists(etlPath))
        {
            Console.Error.WriteLine($"ETL file not found: {etlPath}");
            return 1;
        }

        // Default output path
        outputPath ??= Path.Combine("C:\\temp\\cpu_analysis", $"cpu_pid_{pid ?? 0}.json");
        Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);

        // Also write raw sample lines for backward compat with parseCpuData()
        string rawSamplesPath = Path.ChangeExtension(outputPath, ".txt");

        // Resolve symbol path: CLI arg > env var > default
        string effectiveSymPath = symPath
            ?? Environment.GetEnvironmentVariable("_NT_SYMBOL_PATH")
            ?? DefaultSymbolPath;

        var sw = Stopwatch.StartNew();

        Console.Error.WriteLine($"CPU Analysis: {Path.GetFileName(etlPath)}");
        Console.Error.WriteLine($"  Host app:   {hostApp}");
        Console.Error.WriteLine($"  PID:        {pid?.ToString() ?? "all"}");
        if (rangeStartUs.HasValue && rangeEndUs.HasValue)
            Console.Error.WriteLine($"  Time range: {rangeStartUs}–{rangeEndUs} µs");
        Console.Error.WriteLine($"  Keywords:   {string.Join(", ", keywords)}");
        Console.Error.WriteLine($"  Symbols:    {effectiveSymPath}");
        Console.Error.WriteLine($"  Output:     {outputPath}");
        Console.Error.WriteLine();

        try
        {
            var settings = new TraceProcessorSettings
            {
                AllowLostEvents = true
            };

            // TraceProcessor needs WPT toolkit with symsrv.dll for symbol resolution.
            // Priority: NuGet package toolkit (has symsrv.dll) > installed WPT (may not).
            var wptPaths = new[]
            {
                // NuGet package includes symsrv.dll, dbghelp proxy, etc.
                System.IO.Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                    @".nuget\packages\microsoft.windows.eventtracing.processing.toolkit\1.11.0\build\x64\wpt"),
                @"C:\Program Files (x86)\Windows Kits\10\Windows Performance Toolkit",
                @"C:\Program Files\Windows Kits\10\Windows Performance Toolkit"
            };
            foreach (var wpt in wptPaths)
            {
                if (System.IO.Directory.Exists(wpt) &&
                    System.IO.File.Exists(System.IO.Path.Combine(wpt, "symsrv.dll")))
                {
                    settings.ToolkitPath = wpt;
                    Console.Error.WriteLine($"  WPT Toolkit: {wpt}");
                    break;
                }
            }

            using var trace = TraceProcessor.Create(etlPath, settings);

            var cpuSamplingData = trace.UseCpuSamplingData();
            var processData = trace.UseProcesses();
            var symbolData = trace.UseSymbols();

            Console.Error.WriteLine("Processing trace (single pass)...");
            trace.Process();

            // Load symbols from configured symbol servers
            Console.Error.WriteLine("Loading symbols (resolving from symbol servers)...");
            var symPaths = effectiveSymPath.Split(';', StringSplitOptions.RemoveEmptyEntries);

            // SymCachePath.Automatic fails in single-file apps (Assembly.Location is empty).
            // Use an explicit symcache path instead.
            var symCacheDir = System.IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Temp", "SymCache");
            System.IO.Directory.CreateDirectory(symCacheDir);
            var symCachePath = new SymCachePath(symCacheDir);
            Console.Error.WriteLine($"  SymCache:   {symCacheDir}");

            symbolData.Result.LoadSymbolsAsync(
                symCachePath,
                new SymbolPath(symPaths)
            ).GetAwaiter().GetResult();

            Console.Error.WriteLine("Extracting CPU samples...");

            var samples = cpuSamplingData.Result.Samples;
            int totalSamples = 0;
            int matchedSamples = 0;
            int skippedByPid = 0;
            int skippedByRange = 0;

            // Aggregation maps
            var functionCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            var moduleCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            var keywordCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            foreach (var kw in keywords)
                keywordCounts[kw] = 0;

            using var rawWriter = new StreamWriter(rawSamplesPath, false, Encoding.UTF8, bufferSize: 1 << 16);

            foreach (var sample in samples)
            {
                totalSamples++;

                // PID filter
                int samplePid = sample.Process?.Id ?? -1;
                if (pid.HasValue && samplePid != pid.Value)
                {
                    skippedByPid++;
                    continue;
                }

                // Time range filter
                decimal sampleTsUs = sample.Timestamp.HasValue
                    ? sample.Timestamp.TotalMicroseconds
                    : 0;
                if (rangeStartUs.HasValue && sampleTsUs < rangeStartUs.Value)
                {
                    skippedByRange++;
                    continue;
                }
                if (rangeEndUs.HasValue && sampleTsUs > rangeEndUs.Value)
                {
                    skippedByRange++;
                    continue;
                }

                matchedSamples++;

                // Walk the call stack via IStackSnapshot.Frames
                string processName = sample.Process?.ImageName ?? "Unknown";
                if (!processName.Contains('.') && processName != "Unknown")
                    processName += ".exe";
                int tid = sample.Thread?.Id ?? 0;

                var stackFrames = new List<string>();
                var stack = sample.Stack;
                if (stack != null)
                {
                    foreach (var frame in stack.Frames)
                    {
                        if (!frame.HasValue) continue;

                        string frameName;
                        var symbol = frame.Symbol;
                        if (symbol != null)
                        {
                            string modName = symbol.Image?.FileName ?? "???";
                            string funcName = symbol.FunctionName ?? $"+0x{frame.RelativeVirtualAddress.Value:x}";
                            frameName = $"{modName}!{funcName}";
                        }
                        else if (frame.Image != null)
                        {
                            string modName = frame.Image.FileName ?? "???";
                            frameName = $"{modName}!+0x{frame.RelativeVirtualAddress.Value:x}";
                        }
                        else
                        {
                            frameName = $"0x{frame.Address.Value:x}";
                        }

                        stackFrames.Add(frameName);

                        // Aggregate function counts
                        functionCounts[frameName] = functionCounts.GetValueOrDefault(frameName) + 1;

                        // Aggregate module counts
                        string moduleName = frame.Symbol?.Image?.FileName ?? frame.Image?.FileName ?? "unknown";
                        moduleCounts[moduleName] = moduleCounts.GetValueOrDefault(moduleName) + 1;

                        // Keyword matching against frame
                        string frameLower = frameName.ToLowerInvariant();
                        foreach (var kw in keywords)
                        {
                            if (frameLower.Contains(kw.ToLowerInvariant()))
                                keywordCounts[kw] = keywordCounts.GetValueOrDefault(kw) + 1;
                        }
                    }
                }

                // Write raw sample line (xperf-compatible format for backward compat)
                long tsUsLong = (long)sampleTsUs;
                string stackStr = stackFrames.Count > 0 ? string.Join(" <- ", stackFrames) : "no_stack";
                rawWriter.WriteLine($"SampledProfile, {tsUsLong,10}, {processName} ({samplePid}), {tid,10}, Info, Stack={stackStr}");

                if (matchedSamples % 5000 == 0)
                    Console.Error.Write($"\r  {matchedSamples:N0} samples extracted ({totalSamples:N0} processed)...");
            }

            Console.Error.WriteLine($"\r  {matchedSamples:N0} samples extracted ({totalSamples:N0} processed)     ");

            sw.Stop();

            // Build JSON summary
            var topFunctions = functionCounts
                .OrderByDescending(kv => kv.Value)
                .Take(25)
                .Select(kv => new { name = kv.Key, samples = kv.Value })
                .ToList();

            var topModules = moduleCounts
                .OrderByDescending(kv => kv.Value)
                .Take(15)
                .Select(kv => new { name = kv.Key, samples = kv.Value, pct = matchedSamples > 0 ? Math.Round(kv.Value * 100.0 / matchedSamples, 1) : 0 })
                .ToList();

            var keywordHits = keywords
                .Select(kw => new { keyword = kw, samples = keywordCounts.GetValueOrDefault(kw), pct = matchedSamples > 0 ? Math.Round(keywordCounts.GetValueOrDefault(kw) * 100.0 / matchedSamples, 1) : 0 })
                .ToList();

            var summary = new
            {
                totalSamples = matchedSamples,
                totalProcessed = totalSamples,
                pid = pid ?? 0,
                rangeUs = new[] { rangeStartUs ?? 0, rangeEndUs ?? 0 },
                elapsedSec = Math.Round(sw.Elapsed.TotalSeconds, 1),
                symbolPath = effectiveSymPath,
                rawSamplesFile = rawSamplesPath,
                topFunctions,
                topModules,
                keywordHits,
                skippedByPid,
                skippedByRange
            };

            string json = JsonSerializer.Serialize(summary, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(outputPath, json, Encoding.UTF8);

            // Console summary
            Console.Error.WriteLine();
            Console.Error.WriteLine($"Done in {sw.Elapsed.TotalSeconds:F1}s");
            Console.Error.WriteLine($"  Total samples:  {totalSamples:N0}");
            Console.Error.WriteLine($"  Matched:        {matchedSamples:N0}");
            if (skippedByPid > 0) Console.Error.WriteLine($"  Skipped (PID):  {skippedByPid:N0}");
            if (skippedByRange > 0) Console.Error.WriteLine($"  Skipped (range):{skippedByRange:N0}");
            Console.Error.WriteLine($"  Top module:     {(topModules.Count > 0 ? $"{topModules[0].name} ({topModules[0].pct}%)" : "n/a")}");
            Console.Error.WriteLine($"  JSON output:    {outputPath}");
            Console.Error.WriteLine($"  Raw samples:    {rawSamplesPath}");

            // Machine-readable summary on stdout
            Console.WriteLine($"CPU_OK|{matchedSamples}|{totalSamples}|{sw.Elapsed.TotalSeconds:F1}|{outputPath}");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error in CPU analysis: {ex.Message}");
            Console.Error.WriteLine(ex.StackTrace);
            return 2;
        }
    }
}
