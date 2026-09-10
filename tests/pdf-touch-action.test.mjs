import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModule } from "./helpers/load-typescript.mjs";

function createEventTarget() {
  const listeners = [];
  const captureOf = (options) => typeof options === "boolean" ? options : Boolean(options?.capture);
  return {
    addEventListener(type, callback, options) {
      const capture = captureOf(options);
      if (!listeners.some((entry) => entry.type === type && entry.callback === callback && entry.capture === capture)) {
        listeners.push({ type, callback, capture, passive: Boolean(options?.passive) });
      }
    },
    removeEventListener(type, callback, options) {
      const index = listeners.findIndex((entry) => entry.type === type &&
        entry.callback === callback && entry.capture === captureOf(options));
      if (index !== -1) listeners.splice(index, 1);
    },
    dispatch(type, count = 0) {
      const event = {
        type, touches: Array.from({ length: count }, (_, identifier) => ({ identifier, target: this })),
        preventDefault() { assert.fail("the policy listener must not suppress touch events"); },
        stopPropagation() { assert.fail("the policy listener must not stop touch propagation"); },
      };
      for (const entry of [...listeners]) if (entry.type === type) entry.callback(event);
    },
    entries: (type) => listeners.filter((entry) => entry.type === type),
    get count() { return listeners.length; },
  };
}

function createElement() {
  let touchAction = "";
  const element = {
    isConnected: true,
    forbidStyleAccess: false,
    reads: 0,
    writes: [],
    get policy() { return touchAction; },
    style: {
      get touchAction() {
        assert.equal(element.forbidStyleAccess, false, "active touches must not read CSS touchAction");
        element.reads++;
        return touchAction;
      },
      set touchAction(value) {
        assert.equal(element.forbidStyleAccess, false, "active touches must not write CSS touchAction");
        element.writes.push(value);
        touchAction = value;
      },
    },
  };
  Object.defineProperties(element, Object.getOwnPropertyDescriptors(createEventTarget()));
  return element;
}

const createTouchTarget = () => Object.assign(createEventTarget(), { isConnected: true });

function createViewer({ zoom = 1, canDraw = false } = {}) {
  const document = createEventTarget(), window = createEventTarget();
  const slots = [], effects = [], pendingEffects = [];
  const scale = { current: zoom };
  let slotIndex = 0, output, element = createElement();
  let props = { scale, canDraw };
  const sameDependencies = (previous, next) => previous && next &&
    previous.length === next.length && next.every((value, index) => Object.is(value, previous[index]));
  const { usePdfTouchAction: invokeTouchAction } = loadModule("src/hooks/usePdfTouchAction.ts", {
    react: {
      useRef: (value) => slots[slotIndex++] ??= { current: value },
      useCallback(callback, dependencies) {
        const index = slotIndex++;
        if (!sameDependencies(slots[index]?.dependencies, dependencies)) {
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
  }, { document, window });
  const render = (changes = {}) => {
    props = { ...props, ...changes };
    slotIndex = 0;
    output = invokeTouchAction(props);
    const pending = pendingEffects.splice(0);
    for (const { index } of pending) effects[index]?.cleanup?.();
    for (const effect of pending) {
      effects[effect.index] = { ...effect, cleanup: effect.callback() };
    }
    return output;
  };
  render();
  output.setElement(element);
  return {
    document, window, scale, render,
    get element() { return element; },
    get hook() { return output; },
    zoomTo(value) {
      scale.current = value;
      output.syncTouchAction();
    },
    touchStart(count, targets = []) {
      element.forbidStyleAccess = true;
      output.onTouchStartCapture({
        currentTarget: element,
        touches: Array.from({ length: count }, (_, identifier) => ({ identifier, target: targets[identifier] ?? element })),
      });
    },
    touchEnd(count = 0, type = "touchend") {
      if (count === 0) element.forbidStyleAccess = false;
      document.dispatch(type, count);
    },
    replaceElement(nextElement) {
      output.setElement(null);
      element = nextElement;
      output.setElement(element);
    },
    blur() {
      element.forbidStyleAccess = false;
      window.dispatch("blur");
    },
    replayLayoutEffects() {
      for (const effect of effects) effect?.cleanup?.();
      for (const effect of effects) if (effect) effect.cleanup = effect.callback();
    },
    unmount() {
      for (const effect of effects) effect?.cleanup?.();
    },
  };
}

for (const scenario of [
  { zoom: 1, sequence: [2, 1, 2, 1, 2], initial: "pan-x pan-y", final: "none" },
  { zoom: 2, sequence: [1, 2, 1, 2, 1], initial: "none", final: "pan-x pan-y" },
]) {
  test(`a pinch starting at ${scenario.zoom}x freezes its policy through repeated zoom crossings until all contacts end`, () => {
    const viewer = createViewer({ zoom: scenario.zoom });
    assert.equal(viewer.element.policy, scenario.initial);
    viewer.element.writes.length = 0;
    const reads = viewer.element.reads;
    viewer.touchStart(1);
    viewer.touchStart(2);
    for (const zoom of scenario.sequence) viewer.zoomTo(zoom);
    viewer.touchEnd(1);
    viewer.hook.syncTouchAction();
    assert.equal(viewer.element.policy, scenario.initial);
    assert.deepEqual(viewer.element.writes, []);
    assert.equal(viewer.element.reads, reads);
    viewer.touchEnd();
    assert.equal(viewer.element.policy, scenario.final);
    assert.deepEqual(viewer.element.writes, [scenario.final]);
    viewer.unmount();
  });
}

for (const zoom of [1, 2]) {
  test(`a pinch returning to its initial ${zoom}x policy produces no style writes`, () => {
    const viewer = createViewer({ zoom });
    const initialPolicy = viewer.element.policy;
    viewer.element.writes.length = 0;
    viewer.touchStart(2);
    viewer.zoomTo(zoom === 1 ? 2 : 1);
    viewer.zoomTo(zoom);
    viewer.touchEnd();
    assert.equal(viewer.element.policy, initialPolicy);
    assert.deepEqual(viewer.element.writes, []);
    viewer.unmount();
  });
}

test("lifting one finger and adding it again keeps the same touch policy for the entire contact sequence", () => {
  const viewer = createViewer();
  viewer.element.writes.length = 0;
  viewer.touchStart(2);
  viewer.zoomTo(2);
  viewer.touchEnd(1);
  viewer.zoomTo(1);
  viewer.touchStart(2);
  viewer.zoomTo(2);
  viewer.touchEnd(1);
  assert.deepEqual(viewer.element.writes, []);
  viewer.touchEnd();
  assert.deepEqual(viewer.element.writes, ["none"]);
  viewer.unmount();
});

test("partial touch cancellation remains locked and full cancellation applies the final policy", () => {
  const viewer = createViewer();
  viewer.element.writes.length = 0;
  viewer.touchStart(2);
  viewer.zoomTo(2);
  viewer.touchEnd(1, "touchcancel");
  viewer.zoomTo(1);
  viewer.zoomTo(2);
  assert.deepEqual(viewer.element.writes, []);
  viewer.touchEnd(0, "touchcancel");
  assert.deepEqual(viewer.element.writes, ["none"]);
  viewer.zoomTo(1);
  assert.deepEqual(viewer.element.writes, ["none", "pan-x pan-y"]);
  viewer.unmount();
});

test("drawing mode changes and same-DOM ref reconnections remain deferred until the last contact ends", () => {
  const viewer = createViewer({ zoom: 2 });
  viewer.element.writes.length = 0;
  viewer.touchStart(2);
  viewer.render({ canDraw: true });
  viewer.hook.setElement(null);
  viewer.hook.setElement(viewer.element);
  viewer.zoomTo(2);
  assert.deepEqual(viewer.element.writes, []);
  assert.equal(viewer.element.policy, "none");
  viewer.touchEnd();
  assert.deepEqual(viewer.element.writes, ["pan-x pan-y"]);
  viewer.element.writes.length = 0;
  viewer.touchStart(2);
  viewer.render({ canDraw: false });
  viewer.render({ canDraw: true });
  viewer.touchEnd();
  assert.deepEqual(viewer.element.writes, []);
  viewer.unmount();
});

test("a different DOM element starts with current policy instead of inheriting the old element's contacts", () => {
  const viewer = createViewer({ zoom: 2 });
  const oldElement = viewer.element;
  oldElement.writes.length = 0;
  viewer.touchStart(2);
  viewer.zoomTo(1);
  const replacement = createElement();
  viewer.replaceElement(replacement);
  assert.equal(replacement.policy, "pan-x pan-y");
  assert.deepEqual(oldElement.writes, []);
  viewer.zoomTo(2);
  assert.deepEqual(replacement.writes, ["pan-x pan-y", "none"]);
  viewer.unmount();
});

test("wheel and programmatic zoom or reset apply immediately while no touches are active", () => {
  const viewer = createViewer();
  viewer.element.writes.length = 0;
  viewer.zoomTo(2);
  viewer.zoomTo(3);
  viewer.zoomTo(1);
  assert.deepEqual(viewer.element.writes, ["none", "pan-x pan-y"]);
  viewer.zoomTo(2);
  viewer.render({ canDraw: true });
  viewer.render({ canDraw: false });
  assert.deepEqual(viewer.element.writes, ["none", "pan-x pan-y", "none", "pan-x pan-y", "none"]);
  viewer.unmount();
});

test("document bubble listeners apply the scale after the viewer's touchend alignment", () => {
  const viewer = createViewer({ zoom: 2 });
  for (const type of ["touchend", "touchcancel"]) {
    const [listener] = viewer.document.entries(type);
    assert.equal(listener.passive, true);
    assert.equal(listener.capture, false);
  }
  viewer.element.writes.length = 0;
  viewer.touchStart(2);
  viewer.zoomTo(1.1);
  // A connected touch target receives touchend before the zoom library's ancestor.
  // Its fallback must leave the policy locked until the document bubble listener.
  viewer.element.dispatch("touchend");
  assert.deepEqual(viewer.element.writes, []);
  // Simulate the transform library finishing alignment before document bubbling.
  viewer.scale.current = 1;
  viewer.hook.syncTouchAction();
  assert.deepEqual(viewer.element.writes, []);
  viewer.touchEnd();
  assert.deepEqual(viewer.element.writes, ["pan-x pan-y"]);
  viewer.unmount();
});

test("window blur clears abandoned contacts and restores immediate zoom updates", () => {
  const viewer = createViewer();
  viewer.element.writes.length = 0;
  viewer.touchStart(2);
  viewer.zoomTo(2);
  viewer.blur();
  assert.deepEqual(viewer.element.writes, ["none"]);
  viewer.zoomTo(1);
  assert.deepEqual(viewer.element.writes, ["none", "pan-x pan-y"]);
  viewer.unmount();
});

test("StrictMode replay and mode changes do not duplicate listeners, and unmount removes all of them", () => {
  const viewer = createViewer();
  const assertListenerCounts = () => {
    assert.equal(viewer.document.entries("touchend").length, 1);
    assert.equal(viewer.document.entries("touchcancel").length, 1);
    assert.equal(viewer.window.entries("blur").length, 1);
  };
  assertListenerCounts();
  viewer.replayLayoutEffects();
  assertListenerCounts();
  viewer.render({ canDraw: true });
  viewer.render({ canDraw: false });
  assertListenerCounts();
  viewer.element.writes.length = 0;
  viewer.touchStart(2);
  viewer.zoomTo(2);
  viewer.unmount();
  assert.equal(viewer.document.count, 0);
  assert.equal(viewer.window.count, 0);
  viewer.document.dispatch("touchend");
  viewer.document.dispatch("touchcancel");
  viewer.window.dispatch("blur");
  assert.deepEqual(viewer.element.writes, []);
});

for (const type of ["touchend", "touchcancel"]) {
  test(`a detached touch target's ${type} unlocks the policy using the latest drawing mode without document bubbling`, () => {
    const viewer = createViewer({ zoom: 2 });
    const target = createTouchTarget();
    viewer.element.writes.length = 0;
    viewer.touchStart(2, [target, target]);
    viewer.render({ canDraw: true });
    viewer.zoomTo(2);
    target.isConnected = false;
    target.dispatch(type, 1);
    assert.deepEqual(viewer.element.writes, []);
    viewer.hook.syncTouchAction();
    viewer.element.forbidStyleAccess = false;
    target.dispatch(type, 0);
    assert.deepEqual(viewer.element.writes, ["pan-x pan-y"]);
    assert.equal(target.count, 0);
    // No document event arrived, but subsequent mode updates must be immediate.
    viewer.render({ canDraw: false });
    assert.deepEqual(viewer.element.writes, ["pan-x pan-y", "none"]);
    viewer.unmount();
  });
}

test("multiple touches on the same target install one passive fallback per event and clear all tracked targets on final release", () => {
  const viewer = createViewer();
  const first = createTouchTarget(), second = createTouchTarget();
  viewer.touchStart(1, [first]);
  viewer.touchStart(2, [first, first]);
  viewer.touchStart(3, [first, first, second]);
  for (const target of [first, second]) {
    for (const type of ["touchend", "touchcancel"]) {
      const listeners = target.entries(type);
      assert.equal(listeners.length, 1);
      assert.equal(listeners[0].passive, true);
      assert.equal(listeners[0].capture, false);
    }
  }
  viewer.touchEnd();
  assert.equal(first.count, 0);
  assert.equal(second.count, 0);
  viewer.unmount();
});

for (const cleanup of ["blur", "new DOM", "unmount"]) {
  test(`${cleanup} removes fallback listeners from every touch target`, () => {
    const viewer = createViewer();
    const targets = [createTouchTarget(), createTouchTarget()];
    viewer.touchStart(2, targets);
    viewer.zoomTo(2);
    for (const target of targets) assert.equal(target.count, 2);
    if (cleanup === "blur") viewer.blur();
    else if (cleanup === "new DOM") viewer.replaceElement(createElement());
    else viewer.unmount();
    for (const target of targets) {
      assert.equal(target.count, 0);
      target.isConnected = false;
      target.dispatch("touchend");
      target.dispatch("touchcancel");
    }
    if (cleanup !== "unmount") viewer.unmount();
  });
}

test("StrictMode effect replay restores detached-target fallbacks without losing active contacts or duplicating listeners", () => {
  const viewer = createViewer({ zoom: 2 });
  const target = createTouchTarget();
  viewer.element.writes.length = 0;
  viewer.touchStart(2, [target, target]);
  viewer.zoomTo(1);
  const listener = target.entries("touchend")[0].callback;
  viewer.replayLayoutEffects();
  assert.equal(target.entries("touchend").length, 1);
  assert.equal(target.entries("touchcancel").length, 1);
  assert.equal(target.entries("touchend")[0].callback, listener);
  viewer.hook.syncTouchAction();
  assert.deepEqual(viewer.element.writes, []);
  target.isConnected = false;
  viewer.element.forbidStyleAccess = false;
  target.dispatch("touchcancel");
  assert.deepEqual(viewer.element.writes, ["pan-x pan-y"]);
  assert.equal(target.count, 0);
  viewer.unmount();
});
