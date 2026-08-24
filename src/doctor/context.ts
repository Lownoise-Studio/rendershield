import type { MarkdownDoc, RenderShieldConfig } from "../types.js";

export type DoctorPhaseContext = {
  cwd: string;
  options: {
    strict: boolean;
    skipOutput: boolean;
    configPath?: string;
  };
  configFile: string;
  /** Set by config phase when load succeeds. */
  config?: RenderShieldConfig;
  /** Parsed markdown docs accumulated by content inventory phase. */
  docs: MarkdownDoc[];
};
