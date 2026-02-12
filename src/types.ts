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
          schemaType: "Article"; // v0 only supports Article
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
      lovableOrigin: string; // https://YOUR_SITE.lovable.app
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
  