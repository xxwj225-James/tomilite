/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS script */
// Bundle API server with esbuild for production packaging
const esbuild = require('esbuild');
const path = require('path');

const root = path.resolve(__dirname, '..');

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  // `@huggingface/transformers` must stay external: it loads native ONNX binaries and
  // .onnx/.json assets at runtime by path, none of which survive bundling. Marking it
  // external emits a literal `require` and stops esbuild descending into the package, so
  // its transitive `onnxruntime-node` / `sharp` are left alone too.
  external: ['@prisma/client', '@huggingface/transformers'],
  alias: {
    '@tomatolite/database': path.join(root, 'packages', 'database', 'src', 'index.ts'),
    '@tomatolite/email': path.join(root, 'packages', 'email', 'src', 'index.ts'),
    '@tomatolite/shared': path.join(root, 'packages', 'shared', 'src', 'index.ts'),
    '@tomatolite/shared-ui': path.join(root, 'packages', 'shared-ui', 'src', 'index.ts'),
  },
};

// Two separate builds rather than one with two entryPoints and an `outdir`: `outdir`
// would move server.cjs, and electron/main.js:212 spawns it from that exact path.
Promise.all([
  esbuild.build({
    ...common,
    entryPoints: [path.join(root, 'apps', 'api', 'src', 'server.ts')],
    outfile: path.join(root, 'apps', 'api', 'dist', 'server.cjs'),
  }),

  // The MCP stdio shim. It is run by an external MCP client as `TomiLite.exe
  // mcp-stdio.cjs` (ELECTRON_RUN_AS_NODE), and neither tsx nor node.exe ships in the
  // installer — so it must exist as a standalone .cjs. It reaches no package at all
  // (mcp/catalogue.ts, mcp/protocol.ts and mcp/dispatch.ts are dependency-free by
  // design), which keeps it in the tens of KB instead of dragging Prisma into every
  // tool-call startup.
  esbuild.build({
    ...common,
    entryPoints: [path.join(root, 'apps', 'api', 'src', 'mcp', 'stdio.ts')],
    outfile: path.join(root, 'apps', 'api', 'dist', 'mcp-stdio.cjs'),
    external: [],
    alias: {},
  }),
])
  .then(() => {
    console.log('API bundle: OK');
  })
  .catch((e) => {
    console.error('API bundle failed:', e);
    process.exit(1);
  });
