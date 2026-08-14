// Compile server.cjs to V8 bytecode (.jsc) — irreversible binary format
const bytenode = require('bytenode');
const path = require('path');
const fs = require('fs');

const serverPath = path.resolve(__dirname, '../apps/api/dist/server.cjs');
if (!fs.existsSync(serverPath)) { console.error('server.cjs not found — run bundle-api.js first'); process.exit(1); }

console.log('Compiling server.cjs → server.jsc...');
bytenode.compileFile(serverPath, serverPath.replace('.cjs', '.jsc'));
console.log('✅ server.jsc created');

// Create launcher that loads the bytecode (.cjs extension — api pkg is type:module)
const launcher = `require('bytenode'); require('./server.jsc');\n`;
fs.writeFileSync(path.resolve(__dirname, '../apps/api/dist/server-launcher.cjs'), launcher);
console.log('✅ server-launcher.cjs created');
