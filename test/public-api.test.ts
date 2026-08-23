import { describe, it, expect } from "vitest";
import * as api from "../dist/index.js";

describe("public API exports", () => {
  it("exports CLI commands and core helpers", () => {
    expect(typeof api.cmdInit).toBe("function");
    expect(typeof api.cmdBuild).toBe("function");
    expect(typeof api.cmdVerify).toBe("function");
    expect(typeof api.loadConfig).toBe("function");
    expect(typeof api.loadAllMarkdownDocs).toBe("function");
    expect(typeof api.renderPageHtml).toBe("function");
    expect(typeof api.validatePrerenderHtml).toBe("function");
    expect(typeof api.checkPrerenderContract).toBe("function");
    expect(typeof api.generateSitemapXml).toBe("function");
    expect(typeof api.generateRobotsTxt).toBe("function");
    expect(typeof api.generateWorkerJs).toBe("function");
  });

  it("exports error helpers", () => {
    expect(api.RenderShieldError).toBeDefined();
    expect(typeof api.isRenderShieldError).toBe("function");
    expect(typeof api.renderShieldError).toBe("function");
    expect(typeof api.formatCliError).toBe("function");

    const err = api.renderShieldError("CONFIG_MISSING", "test");
    expect(api.isRenderShieldError(err)).toBe(true);
    expect(api.formatCliError(err)).toBe("[CONFIG_MISSING] test");
  });
});
