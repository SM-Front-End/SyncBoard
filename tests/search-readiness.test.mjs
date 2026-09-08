import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const filename = fileURLToPath(new URL("../src/hooks/usePdfTextSearch.ts", import.meta.url));
const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});

function createHook() {
  const effects = [], exported = {};
  vm.runInNewContext(outputText, {
    exports: exported,
    require(name) {
      if (name === "react") return {
        useRef: (value) => ({ current: value }),
        useCallback: (callback) => callback,
        useEffect: (callback) => effects.push(callback),
      };
      if (name === "../libs/utils/common") return {
        escapeRegExp: (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      };
      throw new Error(`Unexpected module: ${name}`);
    },
    setTimeout,
    DOMException,
    Error,
  }, { filename });
  const hook = exported.usePdfTextSearch();
  const cleanups = effects.map((effect) => effect());
  return { ...hook, unmount: () => cleanups.forEach((cleanup) => cleanup()) };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const page = (text) => ({ getTextContent: async () => ({ items: [{ str: text }] }) });
const pdf = (texts) => ({ numPages: texts.length, getPage: async (number) => page(texts[number - 1]) });
const pageNumbers = (results) => Array.from(results, (result) => result.pageNumber);

test("search waits for the complete index instead of returning partial no-match results", async () => {
  const hook = createHook();
  assert.throws(() => hook.getSearchResult("needle"), /준비/);
  const finalPage = deferred(), secondChunk = deferred(), calls = [];
  const preparing = hook.prepareSearch({
    numPages: 12,
    getPage: async (number) => {
      calls.push(number);
      if (number === 11) secondChunk.resolve();
      return number === 12 ? finalPage.promise : page(number === 2 ? "needle" : "other");
    },
  });
  assert.equal(calls.length, 10, "the first chunk starts without an initial idle delay");
  assert.throws(() => hook.getSearchResult("needle"), /준비/);
  await secondChunk.promise;
  assert.throws(() => hook.getSearchResult("needle"), /준비/);
  finalPage.resolve(page("needle"));
  await preparing;
  assert.deepEqual(pageNumbers(hook.getSearchResult(" needle ")), [2, 12]);
  assert.deepEqual(pageNumbers(hook.getSearchResult("  ")), []);
  hook.unmount();
});

test("a superseded extraction cannot replace the current search index or its cache", async () => {
  const hook = createHook();
  await hook.prepareSearch(pdf(["old needle"]));
  assert.deepEqual(pageNumbers(hook.getSearchResult("needle")), [1]);
  const oldPage = deferred();
  const oldPreparation = hook.prepareSearch({ numPages: 1, getPage: () => oldPage.promise })
    .catch((error) => error);
  assert.throws(() => hook.getSearchResult("needle"), /준비/);
  await hook.prepareSearch(pdf(["current", "new needle"]));
  oldPage.resolve(page("old-only"));
  assert.equal((await oldPreparation).name, "AbortError");
  assert.deepEqual(pageNumbers(hook.getSearchResult("needle")), [2]);
  assert.deepEqual(pageNumbers(hook.getSearchResult("old-only")), []);
  hook.unmount();
});

test("an older extraction failure does not invalidate a newer completed index", async () => {
  const hook = createHook(), oldPage = deferred();
  const oldPreparation = hook.prepareSearch({ numPages: 1, getPage: () => oldPage.promise })
    .catch((error) => error);
  await hook.prepareSearch(pdf(["current"]));
  oldPage.reject(new Error("old extraction failed"));
  await oldPreparation;
  assert.deepEqual(pageNumbers(hook.getSearchResult("current")), [1]);
  hook.unmount();
});

test("text extraction errors remain explicit until a new preparation succeeds", async () => {
  const hook = createHook();
  await assert.rejects(hook.prepareSearch({
    numPages: 1,
    getPage: async () => { throw new Error("text extraction failed"); },
  }), /text extraction failed/);
  assert.throws(() => hook.getSearchResult("needle"), /text extraction failed/);
  await hook.prepareSearch(pdf(["recovered"]));
  assert.deepEqual(pageNumbers(hook.getSearchResult("recovered")), [1]);
  hook.unmount();
});

test("unmount prevents pending text extraction from publishing results", async () => {
  const hook = createHook(), pendingPage = deferred();
  const preparing = hook.prepareSearch({ numPages: 1, getPage: () => pendingPage.promise })
    .catch((error) => error);
  hook.unmount();
  pendingPage.resolve(page("late result"));
  assert.equal((await preparing).name, "AbortError");
  assert.throws(() => hook.getSearchResult("late result"), /준비/);
});
