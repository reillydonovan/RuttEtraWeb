/// <reference types="vite/client" />

/** Build stamp injected by `define` in vite.config.ts — package version,
 *  short git commit, and build date. Shown in the panel title bar. */
declare const __BUILD_INFO__: { version: string; commit: string; builtAt: string };

declare module '*.glsl?raw' {
  const src: string;
  export default src;
}
declare module '*.vert?raw' {
  const src: string;
  export default src;
}
declare module '*.frag?raw' {
  const src: string;
  export default src;
}
/** Markdown rendered to a `<section id="...">...</section>` HTML string
 *  at build time by the `aboutMarkdown` Vite plugin (see `vite.config.ts`).
 *  No runtime markdown parser ships in the client bundle. */
declare module '*.md?aboutMd' {
  const html: string;
  export default html;
}
