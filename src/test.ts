// Quick smoke test for all tools
import { decodeApiId, decodeApiIdBatch, listApisByCategory } from "./tools/decode.js";
import { lookupEvent, listEventsByCategory } from "./tools/lookup.js";
import { diagnose, listRootCauses } from "./tools/diagnose.js";
import { analyzeEtl } from "./tools/analyze.js";
import { compareIncarnations } from "./tools/compare.js";
import { compareEtls } from "./tools/compare_etls.js";
import { analyzeCpu } from "./tools/analyze_cpu.js";
import { timelineSlice } from "./tools/timeline_slice.js";

function test(name: string, fn: () => string) {
  try {
    const result = fn();
    const preview = result.split("\n").slice(0, 3).join(" | ");
    console.log(`✅ ${name}: ${preview.substring(0, 80)}...`);
  } catch (e) {
    console.error(`❌ ${name}: ${e}`);
  }
}

console.log("=== WebView2 ETW MCP Server — Smoke Tests ===\n");

// decode_api_id
test("decode_api_id(3)", () => decodeApiId(3));
test("decode_api_id(999)", () => decodeApiId(999));
test("decodeApiIdBatch([3,7,33,37])", () => decodeApiIdBatch([3, 7, 33, 37]));
test("listApisByCategory('Navigation')", () => listApisByCategory("Navigation"));

// lookup_event
test("lookupEvent('WebView2_FactoryCreate')", () => lookupEvent("WebView2_FactoryCreate"));
test("lookupEvent('Creation')", () => lookupEvent("Creation"));
test("lookupEvent('NonExistentEvent')", () => lookupEvent("NonExistentEvent"));
test("listEventsByCategory('Navigation')", () => listEventsByCategory("Navigation"));

// diagnose
test("diagnose('stuck')", () => diagnose("stuck"));
test("diagnose('crash')", () => diagnose("crash"));
test("diagnose('unknown_symptom')", () => diagnose("unknown_symptom"));
test("listRootCauses()", () => listRootCauses());

// analyze_etl
test("analyzeEtl('C:\\test.etl', 'TestApp')", () => analyzeEtl("C:\\test.etl", "TestApp"));

// compare_incarnations
test("compareIncarnations(empty)", () => compareIncarnations("", ""));
test("compareIncarnations(sample)", () => compareIncarnations(
  "WebView2_Creation_Client, 100000, App.exe (1234), 5678, 0\nWebView2_APICalled, 200000, App.exe (1234), 5678, 0",
  "WebView2_Creation_Client, 100000, App.exe (5678), 9012, 0"
));

// compare_etls
test("compareEtls(setup mode)", () => compareEtls("C:\\good.etl", "C:\\bad.etl", "TestApp"));
test("compareEtls(missing filtered)", () => compareEtls("C:\\good.etl", "C:\\bad.etl", "TestApp", "C:\\nonexistent1.txt", "C:\\nonexistent2.txt"));

// analyze_cpu
test("analyzeCpu(setup mode)", () => analyzeCpu("C:\\test.etl", "1234", ["msedge.dll", "ntdll"], "100000", "200000"));
test("analyzeCpu(missing symbolized)", () => analyzeCpu("C:\\test.etl", "1234", ["msedge.dll"], undefined, undefined, "C:\\nonexistent.txt"));

// timeline_slice
test("timelineSlice(missing file)", () => timelineSlice("C:\\nonexistent.txt", "100000", "200000"));
test("timelineSlice(bad timestamps)", () => timelineSlice("C:\\nonexistent.txt", "abc", "def"));

console.log("\n=== All tests completed ===");
