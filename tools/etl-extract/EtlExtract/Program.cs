using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using Microsoft.Diagnostics.Tracing;
using Microsoft.Diagnostics.Tracing.Etlx;
using Microsoft.Diagnostics.Tracing.Parsers;

/// <summary>
/// Fast ETL → filtered text extraction using TraceEvent.
/// Replaces: xperf -a dumper | Select-String -Pattern "..."
/// Subscribes only to relevant providers, skips kernel noise entirely.
/// Output format matches xperf dumper so existing MCP analysis code works unchanged.
/// </summary>
class Program
{
    static int Main(string[] args)
    {
        if (args.Length < 2)
        {
            Console.Error.WriteLine("Usage: EtlExtract <etl-path> <host-app> [output-path] [--feature-flags <ff-output>]");
            Console.Error.WriteLine();
            Console.Error.WriteLine("  Extracts WebView2-relevant events from ETL using TraceEvent.");
            Console.Error.WriteLine("  Output is xperf-dumper compatible text for MCP server analysis.");
            return 1;
        }

        string etlPath = args[0];
        string hostApp = args[1];
        string outputPath = args.Length > 2 && !args[2].StartsWith("--") ? args[2] : Path.Combine("C:\\temp\\etl_analysis", "filtered.txt");
        string? featureFlagsPath = null;

        for (int i = 0; i < args.Length - 1; i++)
        {
            if (args[i] == "--feature-flags")
                featureFlagsPath = args[i + 1];
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
        var featureFlagLines = featureFlagsPath != null ? new List<string>() : null;

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
            source.Dynamic.All += (TraceEvent data) =>
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
        Console.Error.WriteLine($"  Output:         {outputPath}");

        // Machine-readable summary on stdout (for MCP server to parse)
        Console.WriteLine($"EXTRACT_OK|{matchCount}|{totalEvents}|{sw.Elapsed.TotalSeconds:F1}|{outputPath}");
        return 0;
    }

    static void WriteEventLine(StreamWriter writer, string eventName, long tsUs, string processName, int pid, int tid, string opcode, TraceEvent data, ref int matchCount, List<string>? featureFlagLines, string[] ffPatterns, ref int featureFlagCount)
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
