/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_SUBSTRATE_WS?: string;
  readonly VITE_DEMO_MODE?: string;
  readonly VITE_DEMO_CREDENTIALS_ENABLED?: string;
  readonly DEV?: boolean;
  readonly PROD?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
