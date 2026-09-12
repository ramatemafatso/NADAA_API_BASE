/// <reference types="vite/client" />

/** Environment variables exposed to the Vite client bundle. */
interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
