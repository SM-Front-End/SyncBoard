import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { createStore } from "jotai/vanilla";
import ts from "typescript";

const require = createRequire(import.meta.url);
const colors = ["#202325", "#007AFF", "#54B41D", "#FFBB00", "#F34A47"];

function loadModule(relativePath, mocks = {}, globals = {}) {
  const filename = fileURLToPath(new URL(`../${relativePath}`, import.meta.url));
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: (name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    URL,
    console,
    ...globals,
  }, { filename });
  return module.exports;
}

const atoms = loadModule("src/store/pdf.ts", {
  "../libs/utils/common": { DRAWING_DPR: 2 },
});
const { parseWebviewFileData } = loadModule("src/libs/utils/webviewFileSource.ts", {
  "./common": { colorMap: colors },
});
const stroke = { x: 0.2, y: 0.3, lastX: 0.1, lastY: 0.2,
  lineWidth: 0.01, alpha: 1, color: "#F34A47", drawOrder: "stroke-A" };
const documentInput = (name) => ({
  file: { base64: name, bytes: null, paths: "{}", type: "pdf", isNew: false },
  source: { kind: "base64", base64: name },
});
const parsePaths = (paths) => parseWebviewFileData(JSON.stringify({
  data: { type: "pdf", base64: "document", paths },
}));

function createBridge({ ready = true } = {}) {
  const store = createStore();
  store.set(atoms.loadDocumentAtom, documentInput("A"));
  store.set(atoms.documentReadyAtom, ready);
  const effects = [], refs = [], setters = new Map();
  let effectIndex = 0, refIndex = 0;
  const operations = [], saves = [], native = [], errors = [], rows = [], alerts = [];
  let resets = 0;
  const paths = { current: { 1: [{ ...stroke }] } };
  const window = { AndroidInterface: {
    getPdfData: (value) => native.push(["page", value]),
    getBase64: (value) => native.push(["save", value]),
  } };
  const defer = (collection, data) => new Promise((resolve, reject) => {
    collection.push({ data, resolve, reject });
  });
  const { useWebviewInterface: invokeBridge } = loadModule("src/hooks/useWebviewInterface.ts", {
    react: {
      useRef: (value) => refs[refIndex++] ??= { current: value },
      useEffect: (callback, dependencies) => {
        const index = effectIndex++;
        const previous = effects[index];
        if (previous && dependencies.every((value, i) => Object.is(value, previous.dependencies[i]))) return;
        previous?.cleanup?.();
        effects[index] = { dependencies, cleanup: callback() };
      },
    },
    jotai: {
      useStore: () => store,
      useAtomValue: (atom) => store.get(atom),
      useSetAtom: (atom) => {
        if (!setters.has(atom)) setters.set(atom, (value) => store.set(atom, value));
        return setters.get(atom);
      },
    },
    "../store/pdf": atoms,
    "../libs/utils/common": {
      __DEV__: false,
      createOrMergePdf: (data) => defer(operations, data),
      getModifiedPDFBase64: (snapshot, data) => defer(saves, { snapshot, data }),
    },
    "./useTranslation": { useTranslation: () => ({ t: (key) => key }) },
    "../libs/utils/errorReporter": { reportErrorToNative: (scope, error) => errors.push([scope, error.message]) },
  }, { window, alert: (message) => alerts.push(message) });
  const scaleRef = { current: { resetTransform: () => resets++ } };
  const listRef = { current: { scrollToRow: ({ index }) => rows.push(index) } };
  const render = (getSearchResult = () => []) => {
    effectIndex = 0;
    refIndex = 0;
    invokeBridge({ paths, getSearchResult, scaleRef, listRef });
  };
  render();
  return { store, window, paths, operations, saves, native, errors, rows, alerts, render,
    get resets() { return resets; },
    unmount: () => effects.forEach((effect) => effect.cleanup?.()),
  };
}

test("document replacement clears document state and increments the session together", () => {
  const store = createStore();
  store.set(atoms.loadDocumentAtom, documentInput("A"));
  store.set(atoms.documentReadyAtom, true);
  store.set(atoms.searchTextAtom, "old search");
  store.set(atoms.pdfStateAtom, { ...store.get(atoms.pdfStateAtom), totalPage: 5, isListOpen: true, isFullScreen: true });
  store.set(atoms.pdfConfigAtom, { ...store.get(atoms.pdfConfigAtom), size: { width: 400, height: 500 }, strokeStep: 8 });
  const notifications = [];
  const unsubscribe = store.sub(atoms.documentSessionAtom, () => notifications.push({
    session: store.get(atoms.documentSessionAtom),
    source: store.get(atoms.documentSourceAtom).base64,
    ready: store.get(atoms.documentReadyAtom),
    search: store.get(atoms.searchTextAtom),
  }));
  store.set(atoms.loadDocumentAtom, documentInput("B"));
  assert.deepEqual(notifications, [{ session: 2, source: "B", ready: false, search: "" }]);
  assert.equal(store.get(atoms.fileAtom).base64, "B");
  assert.equal(store.get(atoms.pdfStateAtom).totalPage, 1);
  assert.equal(store.get(atoms.pdfStateAtom).isListOpen, false);
  assert.equal(store.get(atoms.pdfStateAtom).isFullScreen, true);
  assert.equal(store.get(atoms.pdfConfigAtom).size.width, 0);
  assert.equal(store.get(atoms.pdfConfigAtom).strokeStep, 8);
  unsubscribe();
});

test("saved paths reject malformed JSON and unusable page/stroke shapes", () => {
  for (const paths of ["{", "null", "[]", '{"1":{}}', '{"0":[]}',
    JSON.stringify({ 1: [{ ...stroke, x: "0.2" }] }),
    JSON.stringify({ 1: [{ ...stroke, color: "unknown" }] }),
    JSON.stringify({ 1: [{ ...stroke, alpha: 2 }] }),
    JSON.stringify({ 1: [{ ...stroke, lineWidth: -1 }] })]) {
    assert.throws(() => parsePaths(paths), /data.paths/);
  }
  const valid = JSON.stringify({ 1: [stroke], 2: [] });
  assert.equal(parsePaths(valid).paths, valid);
  assert.equal(parsePaths("").paths, "");
  assert.equal(parsePaths(undefined).paths, "");
});

test("a page addition from a replaced document cannot overwrite the current PDF", async () => {
  const bridge = createBridge();
  const pending = bridge.window.newPage();
  bridge.store.set(atoms.loadDocumentAtom, documentInput("B"));
  bridge.operations[0].resolve("A plus page");
  await pending;
  assert.equal(bridge.store.get(atoms.fileAtom).base64, "B");
  assert.equal(bridge.store.get(atoms.pdfStateAtom).totalPage, 1);
  assert.deepEqual(bridge.native, []);
  bridge.unmount();
});

test("a save result from a replaced document is not sent to native", async () => {
  const bridge = createBridge();
  const pending = bridge.window.getBase64();
  bridge.store.set(atoms.loadDocumentAtom, documentInput("B"));
  bridge.saves[0].resolve("saved A");
  await pending;
  assert.deepEqual(bridge.native, []);
  bridge.unmount();
});

test("saving snapshots strokes before awaiting PDF serialization", async () => {
  const bridge = createBridge();
  const pending = bridge.window.getBase64();
  bridge.paths.current[1][0].x = 1;
  bridge.paths.current[1].push({ ...stroke });
  assert.equal(bridge.saves[0].data.snapshot[1].length, 1);
  assert.equal(bridge.saves[0].data.snapshot[1][0].x, 0.2);
  bridge.saves[0].resolve("saved A");
  await pending;
  assert.deepEqual(bridge.native, [["save", "saved A"]]);
  bridge.unmount();
});

test("native callback refresh within a session does not cancel an in-flight addition", async () => {
  const bridge = createBridge();
  const pending = bridge.window.newPage();
  bridge.render(() => [{ pageNumber: 1 }]);
  bridge.operations[0].resolve("A plus page");
  await pending;
  assert.equal(bridge.store.get(atoms.fileAtom).base64, "A plus page");
  assert.equal(bridge.store.get(atoms.pdfStateAtom).totalPage, 2);
  assert.deepEqual(bridge.native, [["page", "A plus page"]]);
  bridge.unmount();
});

test("page additions use the latest count before React refreshes native methods", async () => {
  const bridge = createBridge();
  bridge.store.set(atoms.pdfStateAtom, { ...bridge.store.get(atoms.pdfStateAtom), totalPage: 4 });
  const pending = bridge.window.newPage();
  bridge.operations[0].resolve("fifth page");
  await pending;
  await bridge.window.newPage();
  assert.equal(bridge.store.get(atoms.pdfStateAtom).totalPage, 5);
  assert.equal(bridge.operations.length, 1);
  assert.equal(bridge.alerts.length, 1);
  bridge.unmount();
});

test("native data methods refuse incomplete document preparation and recover when ready", async () => {
  const bridge = createBridge({ ready: false });
  assert.throws(() => bridge.window.getSearchText("word"), /준비/);
  assert.throws(() => bridge.window.getPathData(), /준비/);
  await bridge.window.newPage();
  await bridge.window.getBase64();
  assert.equal(bridge.operations.length, 0);
  assert.equal(bridge.saves.length, 0);
  assert.equal(bridge.errors.length, 4);
  bridge.store.set(atoms.documentReadyAtom, true);
  assert.equal(bridge.window.getSearchText("word").length, 0);
  assert.equal(JSON.parse(bridge.window.getPathData())[1].length, 1);
  bridge.unmount();
});

test("invalid native page numbers never reach the virtual list", () => {
  const bridge = createBridge();
  bridge.store.set(atoms.pdfStateAtom, { ...bridge.store.get(atoms.pdfStateAtom), totalPage: 5 });
  for (const value of ["", "0", "-1", "1.5", "Infinity", "6", "invalid"]) {
    bridge.window.getPageNumber(value);
  }
  assert.deepEqual(bridge.rows, []);
  assert.equal(bridge.resets, 0);
  bridge.window.getPageNumber("2");
  assert.deepEqual(bridge.rows, [1]);
  assert.equal(bridge.resets, 1);
  bridge.unmount();
});

test("unmount discards pending native results", async () => {
  const bridge = createBridge();
  const pending = bridge.window.newPage();
  bridge.unmount();
  bridge.operations[0].resolve("A plus page");
  await pending;
  assert.equal(bridge.store.get(atoms.fileAtom).base64, "A");
  assert.deepEqual(bridge.native, []);
});
