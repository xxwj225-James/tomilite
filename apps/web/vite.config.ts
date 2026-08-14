import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'));

// Selective minification: esbuild for Milkdown (safe), Terser for app (aggressive)
function selectiveMinifyPlugin() {
  return {
    name: 'selective-minify',
    enforce: 'post' as const,
    async renderChunk(code: string, chunk: any) {
      if (chunk.fileName.includes('vendor-milkdown')) {
        const esbuild = await import('esbuild');
        const result = await esbuild.transform(code, { minify: true, target: 'es2020', keepNames: true });
        return { code: result.code, map: null };
      }
      const terser = await import('terser');
      const result = await terser.minify(code, {
        toplevel: false,
        compress: { drop_console: true, drop_debugger: true, ecma: 2020, computed_props: false },
        mangle: { safari10: true },
      });
      return { code: result.code || code, map: null };
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    selectiveMinifyPlugin(),
  ],
  resolve: {
    alias: {
      '@tomatolite/shared-ui': path.resolve(__dirname, '../../packages/shared-ui/src'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    sourcemap: mode !== 'production',
    minify: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (
            id.includes('node_modules/@milkdown') ||
            id.includes('node_modules/prosemirror') ||
            id.includes('node_modules/remark') ||
            id.includes('node_modules/unified') ||
            id.includes('node_modules/mdast') ||
            id.includes('node_modules/micromark') ||
            id.includes('node_modules/lodash-es') ||
            id.includes('MarkdownEditor')
          ) {
            return 'vendor-milkdown';
          }
        },
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: { port: 3002, proxy: { '/api': 'http://localhost:3091' } },
}));
