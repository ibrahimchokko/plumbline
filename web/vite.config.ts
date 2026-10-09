import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const ledger = env.VITE_ENABLE_LEDGER === 'true';

  return {
    plugins: [
      react(),
      {
        // Ledger's USB/HID stack is only resolved when explicitly enabled.
        name: 'plumbline-ledger-gate',
        enforce: 'pre',
        async resolveId(source, importer, opts) {
          if (ledger || !importer || !source.endsWith('/ledger.ts')) return null;
          const resolved = await this.resolve(source, importer, { ...opts, skipSelf: true });
          return resolved?.id === here('./src/lib/wallet/ledger.ts') ? here('./src/lib/wallet/ledger.stub.ts') : null;
        },
      },
    ],
    define: {
      // Several wallet adapters reference Node's `global` at import time.
      global: 'globalThis',
      __APP_VERSION__: JSON.stringify(pkg.version),
      // The backend API version this build was written against (semver-checked at runtime).
      __BACKEND_COMPAT__: JSON.stringify(pkg.compatibleBackendVersion),
    },
    server: { port: 5173 },
    worker: { format: 'es' },
    build: {
      target: 'es2022',
      sourcemap: true,
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            // Everything else (Stellar SDK, wallet adapters, Sentry) is split
            // along its dynamic-import boundaries, so it loads only when used.
            if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) return 'react';
            return undefined;
          },
        },
      },
    },
  };
});
