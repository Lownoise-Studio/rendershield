import type { DoctorCollector } from "./collector.js";
import type { DoctorEngineOptions, DoctorPhaseId } from "./types.js";

export type DoctorPhaseContext = {
  cwd: string;
  options: Required<Pick<DoctorEngineOptions, "strict" | "skipOutput">> &
    Pick<DoctorEngineOptions, "configPath">;
};

export type DoctorPhaseRunner = (
  ctx: DoctorPhaseContext,
  collector: DoctorCollector
) => void | Promise<void>;

/** Deterministic offline phase order (DOCTOR_SPEC §6). */
export const DOCTOR_PHASE_ORDER: readonly DoctorPhaseId[] = [
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
] as const;

const noopPhase: DoctorPhaseRunner = () => {};

/** Stub phase runners for S2; S3/S4 will replace with real diagnostics. */
export const DOCTOR_PHASE_RUNNERS: Record<DoctorPhaseId, DoctorPhaseRunner> = {
  config: noopPhase,
  outputPath: noopPhase,
  contentInventory: noopPhase,
  contentSemantics: noopPhase,
  siteOriginWorker: noopPhase,
  outputPresence: noopPhase,
  freshness: noopPhase,
  contract: noopPhase,
  sitemapRobots: noopPhase,
  worker: noopPhase,
};

export function isOutputPhase(phaseId: DoctorPhaseId): boolean {
  return (
    phaseId === "outputPresence" ||
    phaseId === "freshness" ||
    phaseId === "contract" ||
    phaseId === "sitemapRobots" ||
    phaseId === "worker"
  );
}

export function shouldRunPhase(
  phaseId: DoctorPhaseId,
  options: Pick<DoctorEngineOptions, "skipOutput">
): boolean {
  if (options.skipOutput && isOutputPhase(phaseId)) {
    return false;
  }
  return true;
}
