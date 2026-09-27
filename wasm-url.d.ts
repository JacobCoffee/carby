/** Vite serves `?url` imports as a hashed asset and hands back its URL. */
declare module "*.wasm?url" {
  const url: string;
  export default url;
}
