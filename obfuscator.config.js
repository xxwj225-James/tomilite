// ==========================================
// TomiLite — JavaScript Obfuscation Config
// Strategy: Keep routers & shared types readable (public API / tRPC needs them)
//           Obfuscate service implementations & internal utilities
// ==========================================

const TERSER_OPTIONS = {
  // Basic minification (Vite/esbuild already does this, but we apply harder)
  compress: {
    dead_code: true,
    drop_console: true,
    drop_debugger: true,
    keep_fargs: false,
    pure_funcs: ['console.log', 'console.info', 'console.debug'],
  },
  mangle: {
    // Don't mangle tRPC procedure names (they're used for routing)
    reserved: [
      'list', 'byId', 'create', 'update', 'delete', 'children',
      'updateRank', 'moveCard', 'getBoard', 'handleHook',
      'heartbeat', 'status', 'endSession', 'checkUpdate',
      'addRepo', 'removeRepo', 'recentRefs', 'listRepos',
      'currentVersion',
    ],
  },
};

module.exports = {
  // ─── Default: Strong obfuscation for all JS files ───
  default: {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.75,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.4,
    debugProtection: false, // keep dev-friendly, enable for prod release
    debugProtectionInterval: 0,
    disableConsoleOutput: true,
    identifierNamesGenerator: 'hexadecimal',
    log: false,
    numbersToExpressions: true,
    renameGlobals: false,
    selfDefending: false, // disabled for Store compatibility (V8 JIT + MSIX)
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 10,
    stringArray: true,
    stringArrayCallsTransform: true,
    stringArrayEncoding: ['base64'],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 2,
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersType: 'function',
    stringArrayThreshold: 0.75,
    transformObjectKeys: true,
    unicodeEscapeSequence: false,
  },

  // ─── Light: For files that need partial readability ───
  light: {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    disableConsoleOutput: true,
    identifierNamesGenerator: 'mangled',
    renameGlobals: false,
    selfDefending: false,
    simplify: true,
    splitStrings: false,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.5,
  },

  // ─── Files to EXCLUDE from obfuscation (keep readable) ───
  exclude: [
    '**/routers/*.js',        // tRPC routes — must stay readable for procedure mapping
    '**/agent/tRPC/*.js',     // tRPC agent router — procedure names must survive obfuscation
    '**/agent/index.js',      // Barrel re-export — public API surface
    '**/agent/agentStream.js',// SSE handler entry — imported by server.ts
    '**/shared/**/*.js',      // Shared types
    '**/trpc.js',             // tRPC init
    '**/server.js',           // Entry point
  ],

  // ─── Files to apply LIGHT obfuscation ───
  lightFiles: [
    '**/services/*.js',       // Business logic — light obfuscation
    '**/lib/*.js',            // Utility libraries
    '**/agent/**/*.js',       // Agent module — tools, core, llm, prompts, utils (light only: avoid breaking dynamic imports, fetch chains, tool dispatching)
    '**/server.cjs',          // Bundled entry — light only (no controlFlow), avoid breaking startup
  ],

  terserOptions: TERSER_OPTIONS,
};
