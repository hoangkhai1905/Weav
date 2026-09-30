const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const originalResolveFilename = Module._resolveFilename;
const originalLoad = Module._load;

Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  try {
    return originalResolveFilename.call(this, request, parent, isMain, options);
  } catch (error) {
    if (!request.startsWith('.') || !parent?.filename) throw error;
    const candidate = path.resolve(path.dirname(parent.filename), `${request}.ts`);
    if (!fs.existsSync(candidate)) throw error;
    return originalResolveFilename.call(this, candidate, parent, isMain, options);
  }
};

Module._extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

Module._load = function loadForMobileTests(request, parent, isMain) {
  if (request === 'react-native') return { Platform: { OS: 'web' } };
  if (request === 'expo-secure-store') {
    return {
      getItemAsync: async () => null,
      setItemAsync: async () => {},
      deleteItemAsync: async () => {},
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
