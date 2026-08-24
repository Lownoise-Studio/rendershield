import type { DoctorCollector } from "./collector.js";
import type { DoctorPhaseContext } from "./context.js";
import type { DoctorEngineOptions, DoctorPhaseId } from "./types.js";
import {
  runConfigPhase,
  runContentInventoryPhase,
  runContentSemanticsPhase,
  runOutputPathPhase,
  runSiteOriginWorkerPhase,
} from "./runners/s3Phases.js";

export type { DoctorPhaseContext } from "./context.js";

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

/** Phase runners: S3 implements phases 1–5; S4 will replace output-phase stubs. */
export const DOCTOR_PHASE_RUNNERS: Record<DoctorPhaseId, DoctorPhaseRunner> = {
  config: runConfigPhase,
  outputPath: runOutputPathPhase,
  contentInventory: runContentInventoryPhase,
  contentSemantics: runContentSemanticsPhase,
  siteOriginWorker: runSiteOriginWorkerPhase,
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
