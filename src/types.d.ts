/**
 * Static assets imported as text (they are embedded into the compiled binary
 * by `bun build --compile`). TypeScript sees these modules as plain strings.
 */
declare module "*.html" {
  const content: string;
  export default content;
}

declare module "*.css" {
  const content: string;
  export default content;
}

declare module "*.js" {
  const content: string;
  export default content;
}
