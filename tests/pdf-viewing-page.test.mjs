import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore } from "jotai/vanilla";
import { loadModule } from "./helpers/load-typescript.mjs";

const atoms = loadModule("src/store/pdf.ts", {
  "../libs/utils/common": { DRAWING_DPR: 2 },
});
const pageLayout = loadModule("src/libs/utils/pageLayout.ts", { "./common": {} });

function createElement(initialOffset, maxOffset = Infinity) {
  let offset = initialOffset;
  const element = {
    reads: 0,
    forbidReads: false,
    maxOffset,
    get scrollTop() {
      assert.equal(element.forbidReads, false, "a pinch frame must not read scrollTop");
      element.reads++;
      return offset;
    },
    set scrollTop(value) {
      offset = Math.max(0, Math.min(element.maxOffset, value));
    },
    get actualOffset() { return offset; },
  };
  return element;
}

function createViewer({
  scrollTop = 0,
  maxOffset = Infinity,
  pageOffsets = [0, 100, 200, 300, 400, 500],
  viewportHeight = 50,
} = {}) {
  const store = createStore();
  const slots = [], effects = [], pendingEffects = [];
  const frames = new Map(), canceledFrames = [], calls = [], updates = [];
  const element = createElement(scrollTop, maxOffset);
  let slotIndex = 0, frameId = 0, output;
  const setters = new Map();
  const sameDependencies = (previous, next) => previous && next &&
    previous.length === next.length && next.every((value, index) => Object.is(value, previous[index]));
  const state = { scale: 1, positionX: 0, positionY: 0 };
  const scaleRef = { current: {
    state,
    resetTransform(duration) {
      calls.push(["reset", duration]);
      Object.assign(state, { scale: 1, positionX: 0, positionY: 0 });
      // The real transform emits onTransform before scrollToRow runs.
      output.scheduleUpdate();
    },
  } };
  const listRef = { current: {
    element,
    scrollToRow(options) {
      calls.push(["row", options]);
      element.scrollTop = props.pageOffsets[options.index];
    },
  } };
  let props = { listRef, scaleRef, pageOffsets, viewportHeight };
  const { usePdfViewingPage: invokeViewingPage } = loadModule("src/hooks/usePdfViewingPage.ts", {
    react: {
      useRef: (value) => slots[slotIndex++] ??= { current: value },
      useCallback(callback, dependencies) {
        const index = slotIndex++;
        const previous = slots[index];
        if (!sameDependencies(previous?.dependencies, dependencies)) {
          slots[index] = { callback, dependencies };
        }
        return slots[index].callback;
      },
      useLayoutEffect(callback, dependencies) {
        const index = slotIndex++;
        if (!sameDependencies(effects[index]?.dependencies, dependencies)) {
          pendingEffects.push({ index, callback, dependencies });
        }
      },
    },
    jotai: {
      useStore: () => store,
      useAtomValue: (atom) => store.get(atom),
      useSetAtom(atom) {
        if (!setters.has(atom)) setters.set(atom, (value) => store.set(atom, value));
        return setters.get(atom);
      },
    },
    "../store/pdf": atoms,
    "../libs/utils/pageLayout": pageLayout,
  }, {
    requestAnimationFrame(callback) {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame(id) {
      canceledFrames.push(id);
      frames.delete(id);
    },
  });
  const unsubscribe = store.sub(atoms.currentViewingPageAtom, () => {
    updates.push(store.get(atoms.currentViewingPageAtom));
  });
  const render = (changes = {}) => {
    props = { ...props, ...changes };
    slotIndex = 0;
    output = invokeViewingPage(props);
    // Commit effects after rendering, with previous cleanups before new setups.
    const pending = pendingEffects.splice(0);
    for (const { index } of pending) effects[index]?.cleanup?.();
    for (const effect of pending) {
      effects[effect.index] = { ...effect, cleanup: effect.callback() };
    }
    return output;
  };
  render();
  return {
    store, element, listRef, state, frames, canceledFrames, calls, updates, render,
    get hook() { return output; },
    get page() { return store.get(atoms.currentViewingPageAtom); },
    flushFrame() {
      const pending = [...frames];
      frames.clear();
      for (const [, callback] of pending) callback();
    },
    replayLayoutEffects() {
      for (const effect of effects) effect?.cleanup?.();
      for (const effect of effects) if (effect) effect.cleanup = effect.callback();
    },
    unmount() {
      for (const effect of effects) effect?.cleanup?.();
      unsubscribe();
    },
  };
}

test("pinch updates share one frame and use the latest scroll event and transform without DOM reads", () => {
  const viewer = createViewer();
  viewer.flushFrame();
  viewer.hook.recordScrollOffset(90);
  viewer.hook.scheduleUpdate();
  viewer.element.scrollTop = 190;
  viewer.hook.onScroll({ currentTarget: viewer.element });
  Object.assign(viewer.state, { scale: 2, positionY: -40 });
  viewer.hook.scheduleUpdate();
  assert.equal(viewer.frames.size, 1);
  const reads = viewer.element.reads;
  viewer.element.forbidReads = true;
  viewer.flushFrame();
  assert.equal(viewer.page, 3);
  assert.deepEqual(viewer.updates, [3]);
  assert.equal(viewer.element.reads, reads);
  viewer.unmount();
});

test("page jumps reset first and immediately cache the browser-clamped offset before any scroll event", () => {
  const viewer = createViewer({
    pageOffsets: [0, 100, 200, 300, 400], viewportHeight: 180, maxOffset: 220,
  });
  viewer.flushFrame();
  viewer.state.scale = 2;
  viewer.hook.scrollToPage(3);
  assert.deepEqual(viewer.calls, [
    ["reset", 0],
    ["row", { index: 3, align: "start", behavior: "instant" }],
  ]);
  assert.equal(viewer.element.actualOffset, 220);
  assert.equal(viewer.frames.size, 1);
  viewer.element.forbidReads = true;
  viewer.flushFrame();
  assert.equal(viewer.page, 4);
  // A new pinch before a scroll event must start at actual 220, not requested 300.
  viewer.state.scale = 2;
  viewer.hook.scheduleUpdate();
  viewer.flushFrame();
  assert.equal(viewer.page, 3);
  viewer.unmount();
});

test("multiple page jumps in one frame display the final jump rather than the reset's previous position", () => {
  const viewer = createViewer({ maxOffset: 450 });
  viewer.flushFrame();
  viewer.hook.scrollToPage(4);
  viewer.hook.scrollToPage(1);
  assert.equal(viewer.frames.size, 1);
  assert.equal(viewer.element.actualOffset, 100);
  viewer.element.forbidReads = true;
  viewer.flushFrame();
  assert.equal(viewer.page, 2);
  assert.deepEqual(viewer.updates, [2]);
  viewer.unmount();
});

for (const scenario of [
  { name: "viewport height", changes: { viewportHeight: 300 }, clampedOffset: 200, zoomedPage: 3 },
  { name: "row sizes", changes: { pageOffsets: [0, 60, 120, 180, 240, 300] }, clampedOffset: 220, zoomedPage: 4 },
]) {
  test(`changing ${scenario.name} cancels the previous frame and resyncs the clamped scroll position`, () => {
    const viewer = createViewer({ scrollTop: 350, viewportHeight: 80 });
    viewer.flushFrame();
    viewer.hook.scheduleUpdate();
    const oldFrame = [...viewer.frames.keys()][0];
    const reads = viewer.element.reads;
    viewer.element.maxOffset = scenario.clampedOffset;
    viewer.element.scrollTop = 350;
    viewer.render(scenario.changes);
    assert.ok(viewer.canceledFrames.includes(oldFrame));
    assert.equal(viewer.frames.has(oldFrame), false);
    assert.equal(viewer.frames.size, 1);
    assert.equal(viewer.element.reads, reads + 1);
    viewer.element.forbidReads = true;
    viewer.flushFrame();
    assert.equal(viewer.page, 5);
    viewer.state.scale = 2;
    viewer.hook.scheduleUpdate();
    viewer.flushFrame();
    assert.equal(viewer.page, scenario.zoomedPage);
    // An unrelated React render must not read layout or schedule another frame.
    const previousHook = viewer.hook;
    viewer.render();
    assert.equal(viewer.hook.scheduleUpdate, previousHook.scheduleUpdate);
    assert.equal(viewer.frames.size, 0);
    viewer.unmount();
  });
}

test("StrictMode effect replay reschedules once and unmount cancels pending work", () => {
  const viewer = createViewer({ scrollTop: 150 });
  const initialFrame = [...viewer.frames.keys()][0];
  viewer.replayLayoutEffects();
  assert.deepEqual(viewer.canceledFrames, [initialFrame]);
  assert.equal(viewer.frames.size, 1);
  viewer.element.forbidReads = true;
  viewer.flushFrame();
  assert.equal(viewer.page, 2);
  viewer.hook.scheduleUpdate();
  const pendingFrame = [...viewer.frames.keys()][0];
  viewer.unmount();
  assert.ok(viewer.canceledFrames.includes(pendingFrame));
  assert.equal(viewer.frames.size, 0);
  viewer.hook.scheduleUpdate();
  viewer.hook.recordScrollOffset(350);
  assert.equal(viewer.frames.size, 0);
  assert.equal(viewer.page, 2);
});

test("a temporary null list ref retains the cached offset and a new DOM connection resyncs it", () => {
  const viewer = createViewer({ scrollTop: 150 });
  viewer.flushFrame();
  viewer.listRef.current = null;
  viewer.hook.syncScrollPosition();
  Object.assign(viewer.state, { scale: 2, positionY: -140 });
  viewer.hook.scheduleUpdate();
  viewer.flushFrame();
  assert.equal(viewer.page, 3);
  viewer.listRef.current = { element: null };
  viewer.hook.syncScrollPosition();
  assert.equal(viewer.frames.size, 0);
  const replacement = createElement(50);
  viewer.listRef.current = { element: replacement };
  viewer.state.positionY = 0;
  viewer.hook.syncScrollPosition();
  replacement.forbidReads = true;
  viewer.flushFrame();
  assert.equal(viewer.page, 1);
  assert.equal(replacement.reads, 1);
  viewer.unmount();
});

test("an old document's pending frame cannot overwrite the new document's reset page", () => {
  const viewer = createViewer({ scrollTop: 150 });
  viewer.flushFrame();
  assert.equal(viewer.page, 2);
  viewer.hook.recordScrollOffset(350);
  viewer.store.set(atoms.loadDocumentAtom, {
    file: { base64: "new-document", bytes: null, paths: "", isNew: false, type: "pdf" },
    source: { kind: "base64", base64: "new-document" },
  });
  assert.equal(viewer.page, 1);
  // The previous component has not committed its unmount cleanup yet.
  assert.equal(viewer.frames.size, 1);
  viewer.flushFrame();
  assert.equal(viewer.page, 1);
  assert.deepEqual(viewer.updates, [2, 1]);
  viewer.unmount();
});
