declare module "markdown-it" {
    type MarkdownItOptions = {
      html?: boolean;
      xhtmlOut?: boolean;
      breaks?: boolean;
      langPrefix?: string;
      linkify?: boolean;
      typographer?: boolean;
      quotes?: string | string[];
      highlight?: (str: string, lang: string) => string;
    };
  
    class MarkdownIt {
      constructor(options?: MarkdownItOptions);
      render(markdown: string): string;
    }
  
    export default MarkdownIt;
  }
  