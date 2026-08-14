// Bundle API server with esbuild for production packaging
const esbuild = require('esbuild');
const path = require('path');

const root = path.resolve(__dirname, '..');

esbuild.build({
  entryPoints: [path.join(root, 'apps', 'api', 'src', 'server.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: path.join(root, 'apps', 'api', 'dist', 'server.cjs'),
  external: ['@prisma/client'],
  alias: {
    '@tomatolite/database': path.join(root, 'packages', 'database', 'src', 'index.ts'),
    '@tomatolite/email': path.join(root, 'packages', 'email', 'src', 'index.ts'),
    '@tomatolite/shared': path.join(root, 'packages', 'shared', 'src', 'index.ts'),
    '@tomatolite/shared-ui': path.join(root, 'packages', 'shared-ui', 'src', 'index.ts'),
  },
}).then(() => {
  console.log('API bundle: OK');
}).catch((e) => {
  console.error('API bundle failed:', e);
  process.exit(1);
});
