import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);

// Load application TS with narrow browser/hook mocks, without a build or DOM package.
export function loadModule(relativePath, mocks = {}, globals = {}) {
  const filename = fileURLToPath(new URL(`../../${relativePath}`, import.meta.url));
  const source = readFileSync(filename, "utf8")
    .replaceAll("import.meta.env.MODE", '"production"');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} };
  // Keep objects in the same realm as real dependencies: pdf-lib validates some
  // arguments with instanceof Object. Inject globals as parameters, without
  // replacing process-wide window/localStorage or putting objects in another VM.
  const invoke = vm.compileFunction(outputText,
    ["module", "exports", "require", ...Object.keys(globals)], { filename });
  invoke(module, module.exports,
    (name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    ...Object.values(globals));
  return module.exports;
}
