// Vite plugin: javascript-obfuscator for production build
// Applied AFTER Terser minification — double-layer obfuscation

import JavaScriptObfuscator from 'javascript-obfuscator';

export function obfuscatorPlugin() {
  return {
    name: 'tomatolite-obfuscator',
    enforce: 'post', // Run AFTER all other plugins (including Terser)
    apply: 'build',  // Only in production build

    generateBundle(_options, bundle) {
      const chunks = Object.keys(bundle).filter(
        (k) => k.endsWith('.js') && !k.includes('vendor')
      );

      for (const key of chunks) {
        const chunk = bundle[key];
        if (chunk.type !== 'chunk') continue;

        const originalSize = Buffer.byteLength(chunk.code, 'utf-8');
        try {
          const result = JavaScriptObfuscator.obfuscate(chunk.code, {
            // ─── Medium obfuscation: balance protection vs performance ───
            compact: true,
            controlFlowFlattening: false,       // 🔥 biggest perf killer — disabled
            deadCodeInjection: false,           // 🔥 2nd biggest — disabled
            debugProtection: false,
            disableConsoleOutput: true,
            identifierNamesGenerator: 'hexadecimal',
            numbersToExpressions: false,
            renameGlobals: false,
            selfDefending: false,
            simplify: true,
            splitStrings: false,
            stringArray: true,
            stringArrayCallsTransform: false, // safety: prevents TDZ errors with large chunks
            stringArrayEncoding: ['base64'],
            stringArrayIndexShift: true,
            stringArrayRotate: true,
            stringArrayShuffle: true,
            stringArrayWrappersCount: 1,
            stringArrayWrappersChainedCalls: false,
            stringArrayWrappersType: 'function',
            stringArrayThreshold: 0.5,
            transformObjectKeys: false,
            unicodeEscapeSequence: false,

            reservedStrings: [
              'react', 'React', 'render', 'props', 'state', 'children', 'key', 'ref',
            ],
            reservedNames: [
              'useState', 'useEffect', 'useRef', 'useCallback', 'useMemo',
              'useContext', 'createContext', 'createElement', 'cloneElement',
              'Component', 'PureComponent', 'Fragment', 'Suspense',
              'useReducer', 'useLayoutEffect', 'useImperativeHandle',
              'useDebugValue', 'useDeferredValue', 'useTransition',
              'useId', 'useSyncExternalStore', 'useInsertionEffect',
              'forwardRef', 'memo', 'lazy',
              'tt', 'getT', 'useT', // i18n — must survive obfuscation
            ],
          });

          chunk.code = result.getObfuscatedCode();
          const newSize = Buffer.byteLength(chunk.code, 'utf-8');
          console.log(`  🔒 ${key}: ${(originalSize / 1024).toFixed(1)}KB → ${(newSize / 1024).toFixed(1)}KB`);
        } catch (err) {
          console.warn(`  ⚠️  Skipped ${key}: ${err.message}`);
        }
      }
    },
  };
}
