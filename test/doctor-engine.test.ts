import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DoctorCollector, computeDoctorOk, summarizeDiagnostics } from "../dist/doctor/collector.js";
import { DOCTOR_PHASE_ORDER } from "../dist/doctor/phases.js";
import { runDoctorEngine } from "../dist/doctor/engine.js";
import type { DoctorDiagnostic, DoctorPhaseId } from "../dist/doctor/types.js";

function diag(
  partial: Omit<DoctorDiagnostic, "phaseId" | "category"> & {
    phaseId?: DoctorPhaseId;
    category?: DoctorDiagnostic["category"];
  }
): DoctorDiagnostic {
  return {
    phaseId: partial.phaseId ?? "config",
    category: partial.category ?? "config",
    code: partial.code,
    severity: partial.severity,
    message: partial.message,
    hint: partial.hint,
    details: partial.details,
  };
}

describe("DoctorCollector", () => {
  it("aggregates PASS, WARNING, and FAIL counts", () => {
    const collector = new DoctorCollector();
    collector.pass("config", "DOCTOR_CONFIG_FOUND", "config", "Configuration loaded");
    collector.warn(
      "outputPresence",
      "DOCTOR_OUTPUT_MISSING",
      "output",
      "Output directory not found"
    );
    collector.fail("config", "DOCTOR_CONFIG_MISSING", "config", "Config missing");
    collector.pass("contentInventory", "DOCTOR_CONTENT_GLOB_MATCHES", "content", "12 files");

    expect(collector.summarize()).toEqual({ pass: 2, warning: 1, fail: 1 });
  });

  it("returns ok=true by default when only pass and warning", () => {
    const collector = new DoctorCollector();
    collector.pass("config", "DOCTOR_CONFIG_FOUND", "config", "ok");
    collector.warn("outputPresence", "DOCTOR_OUTPUT_MISSING", "output", "warn");

    expect(collector.computeOk(false)).toBe(true);
    expect(collector.computeOk(true)).toBe(false);
  });

  it("returns ok=false when any FAIL exists regardless of strict", () => {
    const collector = new DoctorCollector();
    collector.fail("config", "DOCTOR_CONFIG_INVALID", "config", "bad");

    expect(collector.computeOk(false)).toBe(false);
    expect(collector.computeOk(true)).toBe(false);
  });

  it("handles empty diagnostic set", () => {
    const collector = new DoctorCollector();
    expect(collector.summarize()).toEqual({ pass: 0, warning: 0, fail: 0 });
    expect(collector.computeOk(false)).toBe(true);
    expect(collector.computeOk(true)).toBe(true);
    expect(collector.getDiagnostics()).toEqual([]);
  });

  it("preserves insertion order for mixed severities", () => {
    const collector = new DoctorCollector();
    collector.warn("config", "DOCTOR_CONFIG_DEPRECATED_FIELD", "config", "a");
    collector.pass("config", "DOCTOR_CONFIG_FOUND", "config", "b");
    collector.fail("contentSemantics", "DOCTOR_ROUTE_DUPLICATE_SLUG", "content", "c");

    expect(collector.getDiagnostics().map((d) => d.message)).toEqual(["a", "b", "c"]);
  });

  it("summarizeDiagnostics and computeDoctorOk work on arrays", () => {
    const diagnostics: DoctorDiagnostic[] = [
      diag({ code: "DOCTOR_CONFIG_FOUND", severity: "pass", message: "p" }),
      diag({ code: "DOCTOR_OUTPUT_MISSING", severity: "warning", message: "w" }),
    ];
    expect(summarizeDiagnostics(diagnostics)).toEqual({ pass: 1, warning: 1, fail: 0 });
    expect(computeDoctorOk(diagnostics, false)).toBe(true);
    expect(computeDoctorOk(diagnostics, true)).toBe(false);
  });
});

describe("runDoctorEngine", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("returns empty diagnostics and ok=true with default options", async () => {
    const result = await runDoctorEngine({ cwd: process.cwd() });

    expect(result.ok).toBe(true);
    expect(result.strict).toBe(false);
    expect(result.skipOutput).toBe(false);
    expect(result.configPath).toBe("rendershield.config.json");
    expect(result.summary).toEqual({ pass: 0, warning: 0, fail: 0 });
    expect(result.diagnostics).toEqual([]);
  });

  it("runs phases in deterministic DOCTOR_PHASE_ORDER", async () => {
    const seen: DoctorPhaseId[] = [];

    await runDoctorEngine({
      cwd: process.cwd(),
      phaseRunners: Object.fromEntries(
        DOCTOR_PHASE_ORDER.map((phaseId) => [
          phaseId,
          () => {
            seen.push(phaseId);
          },
        ])
      ) as Partial<Record<DoctorPhaseId, () => void>>,
    });

    expect(seen).toEqual([...DOCTOR_PHASE_ORDER]);
  });

  it("skips output phases when skipOutput is true", async () => {
    const seen: DoctorPhaseId[] = [];

    await runDoctorEngine({
      cwd: process.cwd(),
      skipOutput: true,
      phaseRunners: Object.fromEntries(
        DOCTOR_PHASE_ORDER.map((phaseId) => [
          phaseId,
          () => {
            seen.push(phaseId);
          },
        ])
      ) as Partial<Record<DoctorPhaseId, () => void>>,
    });

    expect(seen).toEqual([
      "config",
      "outputPath",
      "contentInventory",
      "contentSemantics",
      "siteOriginWorker",
    ]);
  });

  it("computes strict ok from injected phase diagnostics", async () => {
    const result = await runDoctorEngine({
      cwd: process.cwd(),
      strict: true,
      phaseRunners: {
        config: (_ctx, collector) => {
          collector.pass("config", "DOCTOR_CONFIG_FOUND", "config", "loaded");
        },
        outputPresence: (_ctx, collector) => {
          collector.warn(
            "outputPresence",
            "DOCTOR_OUTPUT_MISSING",
            "output",
            "no output yet"
          );
        },
      },
    });

    expect(result.summary).toEqual({ pass: 1, warning: 1, fail: 0 });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => d.phaseId)).toEqual(["config", "outputPresence"]);
  });

  it("produces no console output", async () => {
    await runDoctorEngine({
      cwd: process.cwd(),
      phaseRunners: {
        config: (_ctx, collector) => {
          collector.fail("config", "DOCTOR_CONFIG_MISSING", "config", "missing");
        },
      },
    });

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("allows additive details on diagnostics", async () => {
    const result = await runDoctorEngine({
      cwd: process.cwd(),
      phaseRunners: {
        config: (_ctx, collector) => {
          collector.pass("config", "DOCTOR_CONFIG_FOUND", "config", "loaded", {
            details: { path: "rendershield.config.json", extra: "future" },
          });
        },
      },
    });

    expect(result.diagnostics[0]?.details).toEqual({
      path: "rendershield.config.json",
      extra: "future",
    });
  });
});

describe("DOCTOR_PHASE_ORDER", () => {
  it("matches spec offline phase sequence", () => {
    expect([...DOCTOR_PHASE_ORDER]).toEqual([
      "config",
      "outputPath",
      "contentInventory",
      "contentSemantics",
      "siteOriginWorker",
      "outputPresence",
      "freshness",
      "contract",
      "sitemapRobots",
      "worker",
    ]);
  });
});
