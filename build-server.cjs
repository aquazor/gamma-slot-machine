const esbuild = require('esbuild');

esbuild
  .build({
    entryPoints: ['server.cjs'],
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    outfile: 'build/server.cjs',
  })
  .catch(() => process.exit(1));
