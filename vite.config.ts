import { defineConfig } from 'vite';

// A PORT from the environment (e.g. an assigned preview port) wins; otherwise Vite's defaults (5173 dev, 4173 preview).
const port = process.env.PORT ? Number(process.env.PORT) : undefined;

export default defineConfig({
  // the lifeboat's Solana code uses Buffer: in the browser that's the npm package (a bare 'buffer' would be Node's, stubbed out)
  resolve: { alias: { buffer: 'buffer/' } },
  build: { target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 1100 },
  server: { port, strictPort: port !== undefined },
  preview: { port, strictPort: port !== undefined },
});
