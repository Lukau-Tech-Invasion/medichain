/// <reference types="vite/client" />
/// <reference types="vitest/globals" />

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly VITE_API_URL?: string;
  readonly VITE_SUBSTRATE_WS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
