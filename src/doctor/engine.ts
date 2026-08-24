import { DEFAULT_CONFIG_NAME } from "../configPath.js";
import { DoctorCollector } from "./collector.js";
import {
  DOCTOR_PHASE_ORDER,
  DOCTOR_PHASE_RUNNERS,
  shouldRunPhase,
  type DoctorPhaseContext,
  type DoctorPhaseRunner,
} from "./phases.js";
import type { DoctorEngineOptions, DoctorResult } from "./types.js";

export type RunDoctorEngineOptions = DoctorEngineOptions & {
  cwd?: string;
  /** Test hook: override individual phase runners without replacing the full map. */
  phaseRunners?: Partial<Record<(typeof DOCTOR_PHASE_ORDER)[number], DoctorPhaseRunner>>;
};

/**
 * Pure Doctor engine: runs offline diagnostic phases and returns structured data.
 * Does not write to stdout/stderr (CLI formatting deferred to S5).
 */
export async function runDoctorEngine(
  options: RunDoctorEngineOptions = {}
): Promise<DoctorResult> {
  const cwd = options.cwd ?? process.cwd();
  const strict = options.strict ?? false;
  const skipOutput = options.skipOutput ?? false;
  const configPath = options.configPath ?? DEFAULT_CONFIG_NAME;

  const collector = new DoctorCollector();
  const ctx: DoctorPhaseContext = {
    cwd,
    options: { strict, skipOutput, configPath },
  };

  for (const phaseId of DOCTOR_PHASE_ORDER) {
    if (!shouldRunPhase(phaseId, { skipOutput })) {
      continue;
    }
    const runner = options.phaseRunners?.[phaseId] ?? DOCTOR_PHASE_RUNNERS[phaseId];
    await runner(ctx, collector);
  }

  const summary = collector.summarize();
  return {
    ok: collector.computeOk(strict),
    strict,
    configPath,
    skipOutput,
    summary,
    diagnostics: [...collector.getDiagnostics()],
  };
}
