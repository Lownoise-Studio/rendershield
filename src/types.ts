export const SCHEMA_TYPES = ["Article", "BlogPosting", "WebPage"] as const;
export type SchemaType = (typeof SCHEMA_TYPES)[number];

export type RenderShieldConfig = {
    version: 1;
    site: {
      canonicalBase: string; // https://example.com
      siteName: string;
      defaultOgImage: string;
      authorName: string;
    };
    content: {
      markdown: {
        baseDir: string; // content
        collections: Array<{
          name: string; // blog
          pattern: string; // blog/**/*.md
          routeBase: string; // /blog
          schemaType: SchemaType;
        }>;
      };
    };
    output: {
      outDir: string; // dist-prerender
      prettyHtml: boolean;
    };
    sitemap: {
      enabled: boolean;
      path: string; // /sitemap.xml
    };
    robots: {
      enabled: boolean;
      path: string; // /robots.txt
    };
    worker: {
      enabled: boolean;
      spaOrigin: string; // https://app.example.com — human SPA / hosting origin
      rewriteRouteBases: string[]; // ["/blog/"]
      botUserAgentPatterns: string[];
      debugHeaders: boolean;
    };
  };
  
  export type MarkdownDoc = {
    sourcePath: string;
    collection: string;
    routePath: string; // /blog/slug
    title: string;
    excerpt: string;
    datePublished: string; // YYYY-MM-DD
    coverImage: string; // /images/...
    slug: string;
    htmlContent: string; // rendered <p>...
  };
  