import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { loadModule } from "./helpers/load-typescript.mjs";

class InputMouseEvent {}
const common = loadModule("src/libs/utils/common.ts", {
  "react-device-detect": { isTablet: true },
}, { MouseEvent: InputMouseEvent });
const geometry = loadModule("src/libs/utils/drawingGeometry.ts", { "./common": common });

test("eraser sweep distance includes crossings, collinear and zero-length segments", () => {
  for (const { name, points, expected } of [
    { name: "fast crossing", points: [-100, 0, 100, 0, 0, -100, 0, 100], expected: 0 },
    { name: "diagonal crossing", points: [0, 0, 100, 100, 0, 100, 100, 0], expected: 0 },
    { name: "parallel", points: [0, 0, 100, 0, 0, 7, 100, 7], expected: 7 },
    { name: "collinear overlap", points: [0, 0, 100, 0, 25, 0, 200, 0], expected: 0 },
    { name: "collinear separated", points: [0, 0, 100, 0, 120, 0, 200, 0], expected: 20 },
    { name: "shared endpoint", points: [0, 0, 100, 0, 100, 0, 100, 100], expected: 0 },
    { name: "one point segment", points: [20, 30, 20, 30, 0, 0, 100, 0], expected: 30 },
    { name: "two point segments", points: [0, 0, 0, 0, 3, 4, 3, 4], expected: 5 },
    { name: "point on segment", points: [50, 0, 50, 0, 0, 0, 100, 0], expected: 0 },
  ]) {
    assert.equal(geometry.distanceSegmentToSegment(...points), expected, name);
    assert.equal(geometry.distanceSegmentToSegment(...points.slice(4), ...points.slice(0, 4)),
      expected, `${name}: symmetric`);
  }
});

function createCanvas(index, size) {
  const context = {
    lines: [], visibleLines: [], clearCalls: [], save() {}, restore() {}, beginPath() {},
    moveTo(x, y) { this.position = { x, y }; },
    lineTo(x, y) {
      this.lines.push({ x, y });
      this.visibleLines.push({
        from: this.position, to: { x, y }, color: this.strokeStyle, alpha: this.globalAlpha,
      });
      this.position = { x, y };
    },
    stroke() {}, closePath() {}, setLineDash() {},
    clearRect(...bounds) { this.clearCalls.push(bounds); this.visibleLines = []; },
  };
  const captured = new Set();
  return {
    dataset: { index: String(index) }, width: size.width * 2, height: size.height * 2,
    context, captured, getContext: () => context,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: size.width, height: size.height }),
    setPointerCapture: (id) => captured.add(id),
    hasPointerCapture: (id) => captured.has(id),
    releasePointerCapture: (id) => captured.delete(id),
  };
}

function createDrawing() {
  const hooks = { index: 0, slots: [], effects: [] };
  const windowListeners = new Map();
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useRef(initial) { return hooks.slots[hooks.index++] ??= { current: initial }; },
    useState(initial) {
      const i = hooks.index++;
      hooks.slots[i] ??= { value: initial };
      return [hooks.slots[i].value, (value) => {
        hooks.slots[i].value = typeof value === "function" ? value(hooks.slots[i].value) : value;
      }];
    },
    useMemo(fn, dependencies) {
      const i = hooks.index++;
      const previous = hooks.slots[i];
      if (!previous || !same(previous.dependencies, dependencies)) {
        hooks.slots[i] = { value: fn(), dependencies };
      }
      return hooks.slots[i].value;
    },
    useCallback(fn, dependencies) { return react.useMemo(() => fn, dependencies); },
    useEffect(fn, dependencies) {
      const i = hooks.index++;
      const previous = hooks.slots[i];
      if (!previous || !same(previous.dependencies, dependencies)) {
        hooks.effects.push(() => {
          previous?.cleanup?.();
          hooks.slots[i] = { dependencies, cleanup: fn() };
        });
      }
    },
  };
  const pageSizes = [{ width: 400, height: 600 }, { width: 600, height: 300 }];
  const canvases = [null, ...pageSizes.map((size, i) => createCanvas(i + 1, size))];
  let props = { canvasRefs: { current: canvases }, devicePixelRatio: 2, pageSizes, strokeStep: 4 };
  const { default: invokeCanvas } = loadModule("src/hooks/useCanvas.ts", {
    react,
    "../libs/utils/common": common,
    "../libs/utils/drawingGeometry": geometry,
  }, {
    localStorage: { getItem: () => "pen" },
    window: {
      addEventListener(type, callback) {
        if (!windowListeners.has(type)) windowListeners.set(type, new Set());
        windowListeners.get(type).add(callback);
      },
      removeEventListener(type, callback) { windowListeners.get(type)?.delete(callback); },
    },
  });
  let api;
  const render = () => {
    hooks.index = 0;
    hooks.effects = [];
    api = invokeCanvas(props);
    hooks.effects.forEach((effect) => effect());
  };
  render();
  api.setCanDraw(true);
  render();
  return {
    canvases,
    get api() { return api; },
    render,
    setSizes: (sizes) => { props = { ...props, pageSizes: sizes }; render(); },
    blur: () => windowListeners.get("blur")?.forEach((callback) => callback()),
    unmount: () => hooks.slots.forEach((slot) => slot.cleanup?.()),
    event: (page, id, x, y, type = "pen") => ({
      currentTarget: canvases[page], target: canvases[page], pointerId: id, pointerType: type, isPrimary: true,
      clientX: x, clientY: y, nativeEvent: new InputMouseEvent(),
    }),
  };
}
const stroke = (drawOrder, lastX, lastY, x, y, lineWidth = 4 / 600) => ({
  lastX, lastY, x, y, lineWidth, color: "#F34A47", alpha: 1, drawOrder,
});
function erase(drawing, id, from, to) {
  drawing.api.startDrawing(drawing.event(2, id, ...from));
  drawing.api.draw(drawing.event(2, id, ...to));
  drawing.api.stopDrawing(drawing.event(2, id, ...to));
}

test("a stroke uses its own page dimensions and rejects another page's pointer", (t) => {
  const drawing = createDrawing();
  t.after(drawing.unmount);
  const { api, event, canvases } = drawing;
  api.startDrawing(event(2, 1, 60, 30));
  api.startDrawing(event(1, 2, 20, 20));
  api.draw(event(1, 2, 80, 80));
  api.stopDrawing(event(1, 2, 80, 80));
  assert.equal(api.paths.current[1], undefined);
  api.draw(event(2, 1, 300, 120));
  api.stopDrawing(event(2, 1, 300, 120));
  const point = api.paths.current[2][0];
  assert.equal(point.lastX, 0.2);
  assert.equal(point.lastY, 0.2);
  assert.equal(point.x, 1);
  assert.equal(point.y, 0.8);
  assert.equal(point.lineWidth, 4 / 600);
  assert.equal(canvases[2].captured.size, 0);
});

test("a fast erase sweep removes crossed strokes while retaining nearby strokes and other pages", (t) => {
  const drawing = createDrawing();
  t.after(drawing.unmount);
  drawing.api.paths.current = {
    1: [stroke("other-page", 1, 0.2, 1, 1.8)],
    2: [stroke("crossed", 1, 0.2, 1, 1.8), stroke("far", 1.8, 0.2, 1.8, 1.8)],
  };
  drawing.api.setDrawType("eraser");
  drawing.render();
  erase(drawing, 3, [200, 150], [400, 150]);
  assert.deepEqual(Array.from(drawing.api.paths.current[2], (point) => point.drawOrder), ["far"]);
  assert.equal(drawing.api.paths.current[1].length, 1);
});

test("eraser hit testing includes visible ink width without deleting a near miss", (t) => {
  const drawing = createDrawing();
  t.after(drawing.unmount);
  drawing.api.setDrawType("eraser");
  drawing.render();
  drawing.api.paths.current[2] = [stroke("thick", 1, 0.2, 1, 1.8, 40 / 600)];
  erase(drawing, 4, [310, 60], [310, 200]);
  assert.equal(drawing.api.paths.current[2].length, 0);
  drawing.api.paths.current[2] = [stroke("near-but-clear", 1, 0.2, 1, 1.8, 40 / 600)];
  erase(drawing, 5, [315, 60], [315, 200]);
  assert.equal(drawing.api.paths.current[2].length, 1);
});

test("resizing cancels active pointer ownership and a pending throttled move", async (t) => {
  const drawing = createDrawing();
  t.after(drawing.unmount);
  // Keep both moves within one throttle interval without depending on machine speed.
  t.mock.method(Date, "now", () => 100);
  drawing.api.startDrawing(drawing.event(2, 6, 50, 50));
  drawing.api.draw(drawing.event(2, 6, 80, 80));
  drawing.api.draw(drawing.event(2, 6, 100, 100));
  assert.equal(drawing.api.paths.current[2].length, 1);
  drawing.setSizes([{ width: 200, height: 300 }, { width: 300, height: 150 }]);
  assert.equal(drawing.canvases[2].captured.size, 0);
  drawing.api.draw(drawing.event(2, 6, 150, 100));
  drawing.api.stopDrawing(drawing.event(2, 6, 150, 100));
  await delay(20);
  assert.equal(drawing.api.paths.current[2].length, 1);
});

test("resize finalizes an eraser with the dimensions captured before resizing", (t) => {
  const drawing = createDrawing();
  t.after(drawing.unmount);
  drawing.api.setDrawType("eraser");
  drawing.render();
  drawing.api.paths.current[2] = [stroke("just-outside", 1, 0.2, 1, 1.8, 40 / 600)];
  drawing.api.startDrawing(drawing.event(2, 7, 313, 60));
  drawing.api.draw(drawing.event(2, 7, 313, 200));
  drawing.setSizes([{ width: 200, height: 300 }, { width: 300, height: 150 }]);
  // In the original bitmap the gap is 26px and the hit radius is 24px. Incorrectly
  // applying the new size makes these 13px and 14px and would delete the stroke.
  assert.equal(drawing.api.paths.current[2].length, 1);
  assert.equal(drawing.canvases[2].captured.size, 0);
});

for (const tool of ["pen", "highlight"]) {
  test(`switching finger ${tool} to pinch removes only the active stroke and cancels late moves`, async (t) => {
    const drawing = createDrawing();
    t.after(drawing.unmount);
    t.mock.method(Date, "now", () => 100);
    drawing.api.setTouchType("touch");
    drawing.api.setDrawType(tool);
    drawing.render();
    const touch = (id, x, y) => drawing.event(2, id, x, y, "touch");
    drawing.api.startDrawing(touch(20, 40, 40));
    drawing.api.draw(touch(20, 80, 80));
    drawing.api.stopDrawing(touch(20, 80, 80));
    const completed = structuredClone(drawing.api.paths.current[2]);
    drawing.api.paths.current[1] = [stroke("other-page", 0.1, 0.1, 0.4, 0.5)];
    drawing.api.redrawPaths(400, 600, 1);
    const otherPage = structuredClone(drawing.api.paths.current[1]);
    const otherVisible = structuredClone(drawing.canvases[1].context.visibleLines);
    const canvas = drawing.canvases[2];
    const completedVisible = structuredClone(canvas.context.visibleLines);

    drawing.api.startDrawing(touch(21, 100, 100));
    drawing.api.draw(touch(21, 110, 110));
    drawing.api.draw(touch(21, 120, 120));
    assert.equal(drawing.api.paths.current[2].length, completed.length + 1);
    const canceledOrder = drawing.api.paths.current[2].at(-1).drawOrder;
    assert.notEqual(canceledOrder, completed[0].drawOrder);
    assert.ok(canvas.context.visibleLines.length > completedVisible.length);
    const clearsBeforePinch = canvas.context.clearCalls.length;
    drawing.api.cancelDrawingForPinch();
    assert.deepEqual(drawing.api.paths.current[2], completed);
    assert.deepEqual(drawing.api.paths.current[1], otherPage);
    assert.deepEqual(canvas.context.visibleLines, completedVisible);
    assert.deepEqual(drawing.canvases[1].context.visibleLines, otherVisible);
    assert.ok(canvas.context.clearCalls.length > clearsBeforePinch);
    assert.deepEqual(canvas.context.clearCalls.at(-1), [0, 0, canvas.width, canvas.height]);
    assert.equal(canvas.captured.size, 0);

    const drawsAfterRollback = canvas.context.lines.length;
    drawing.api.draw(touch(21, 150, 150));
    drawing.api.stopDrawing(touch(21, 150, 150));
    drawing.api.cancelDrawingForPinch();
    await delay(20);
    assert.deepEqual(drawing.api.paths.current[2], completed);
    assert.equal(canvas.context.lines.length, drawsAfterRollback);
    drawing.api.startDrawing(touch(22, 180, 100));
    drawing.api.draw(touch(22, 200, 120));
    drawing.api.stopDrawing(touch(22, 200, 120));
    assert.equal(drawing.api.paths.current[2].length, completed.length + 1);
    assert.deepEqual(drawing.api.paths.current[2].slice(0, completed.length), completed);
    assert.notEqual(drawing.api.paths.current[2].at(-1).drawOrder, canceledOrder);
    assert.equal(canvas.captured.size, 0);
  });

  test(`pinch clears a finger ${tool} dot even when the page has no remaining saved strokes`, (t) => {
    const drawing = createDrawing();
    t.after(drawing.unmount);
    drawing.api.setTouchType("touch");
    drawing.api.setDrawType(tool);
    drawing.render();
    const event = drawing.event(2, 23, 100, 100, "touch");
    drawing.api.startDrawing(event);
    drawing.api.draw(event);
    const canvas = drawing.canvases[2];
    assert.equal(drawing.api.paths.current[2].length, 1);
    assert.equal(canvas.context.visibleLines.length, 1);
    const clears = canvas.context.clearCalls.length;
    drawing.api.cancelDrawingForPinch();
    assert.deepEqual(drawing.api.paths.current[2], []);
    assert.deepEqual(canvas.context.visibleLines, []);
    assert.ok(canvas.context.clearCalls.length > clears);
    assert.equal(canvas.captured.size, 0);
  });
}

test("a finger eraser interrupted by pinch discards its preview and cannot delete saved strokes later", (t) => {
  const drawing = createDrawing();
  t.after(drawing.unmount);
  t.mock.method(Date, "now", () => 100);
  drawing.api.setTouchType("touch");
  drawing.api.setDrawType("eraser");
  drawing.render();
  drawing.api.paths.current = {
    1: [stroke("other-page", 1, 0.2, 1, 1.8)],
    2: [stroke("crossed", 1, 0.2, 1, 1.8), stroke("far", 1.8, 0.2, 1.8, 1.8)],
  };
  drawing.api.redrawPaths(600, 300, 2);
  const saved = structuredClone(drawing.api.paths.current);
  const context = drawing.canvases[2].context;
  const visible = structuredClone(context.visibleLines);
  const touch = (id, x, y) => drawing.event(2, id, x, y, "touch");
  drawing.api.startDrawing(touch(24, 200, 150));
  drawing.api.draw(touch(24, 400, 150));
  drawing.api.draw(touch(24, 450, 150));
  assert.ok(context.visibleLines.some((line) => line.color === "red"));
  drawing.api.cancelDrawingForPinch();
  assert.deepEqual(drawing.api.paths.current, saved);
  assert.deepEqual(context.visibleLines, visible);
  assert.equal(drawing.canvases[2].captured.size, 0);
  drawing.api.stopDrawing(touch(24, 450, 150));
  // A later eraser that misses the ink must not reuse the canceled sweep.
  drawing.api.startDrawing(touch(25, 50, 20));
  drawing.api.draw(touch(25, 60, 20));
  drawing.api.stopDrawing(touch(25, 60, 20));
  assert.deepEqual(drawing.api.paths.current, saved);
  assert.deepEqual(context.visibleLines, visible);
});

test("pinch finishes a stylus stroke without rolling back its ink or flushing a queued move", async (t) => {
  const drawing = createDrawing();
  t.after(drawing.unmount);
  t.mock.method(Date, "now", () => 100);
  const event = (x) => drawing.event(2, 26, x, 80);
  drawing.api.startDrawing(event(60));
  drawing.api.draw(event(80));
  drawing.api.draw(event(100));
  const saved = structuredClone(drawing.api.paths.current[2]);
  const context = drawing.canvases[2].context;
  const visible = structuredClone(context.visibleLines);
  const clears = context.clearCalls.length;
  drawing.api.cancelDrawingForPinch();
  drawing.api.draw(event(120));
  drawing.api.stopDrawing(event(120));
  await delay(20);
  assert.deepEqual(drawing.api.paths.current[2], saved);
  assert.deepEqual(context.visibleLines, visible);
  assert.equal(context.clearCalls.length, clears);
  assert.equal(drawing.canvases[2].captured.size, 0);
});

for (const reason of ["cancelDrawing", "pointercancel", "blur", "resize"]) {
  test(`ordinary ${reason} preserves the active finger stroke`, (t) => {
    const drawing = createDrawing();
    t.after(drawing.unmount);
    drawing.api.setTouchType("touch");
    drawing.render();
    const event = (x) => drawing.event(2, 27, x, 80, "touch");
    drawing.api.startDrawing(event(60));
    drawing.api.draw(event(80));
    const saved = structuredClone(drawing.api.paths.current[2]);
    const visible = structuredClone(drawing.canvases[2].context.visibleLines);
    if (reason === "cancelDrawing") drawing.api.cancelDrawing();
    else if (reason === "pointercancel") drawing.api.cancelDrawing(event(80));
    else if (reason === "blur") drawing.blur();
    else drawing.setSizes([{ width: 200, height: 300 }, { width: 300, height: 150 }]);
    assert.deepEqual(drawing.api.paths.current[2], saved);
    assert.deepEqual(drawing.canvases[2].context.visibleLines, visible);
    assert.equal(drawing.canvases[2].captured.size, 0);
  });
}

for (const tool of ["pen", "highlight", "eraser"]) {
  test(`a finger ${tool} that has not moved switches to pinch without clearing or redrawing the page`, (t) => {
    const drawing = createDrawing();
    t.after(drawing.unmount);
    drawing.api.setTouchType("touch");
    drawing.api.setDrawType(tool);
    drawing.render();
    const previous = [stroke("completed", 0.1, 0.2, 0.5, 0.6)];
    drawing.api.paths.current[2] = previous;
    drawing.api.redrawPaths(600, 300, 2);
    const canvas = drawing.canvases[2];
    const clears = canvas.context.clearCalls.length;
    const draws = canvas.context.lines.length;
    drawing.api.startDrawing(drawing.event(2, 28, 80, 80, "touch"));
    assert.equal(canvas.captured.size, 1);
    drawing.api.cancelDrawingForPinch();
    assert.equal(drawing.api.paths.current[2], previous);
    assert.equal(canvas.context.clearCalls.length, clears);
    assert.equal(canvas.context.lines.length, draws);
    assert.equal(canvas.captured.size, 0);
  });
}

test("an extra non-primary finger cannot start a stroke after pinch cancellation, but a new primary gesture can", (t) => {
  const drawing = createDrawing();
  t.after(drawing.unmount);
  drawing.api.setTouchType("touch");
  drawing.render();
  drawing.api.startDrawing(drawing.event(2, 29, 80, 80, "touch"));
  drawing.api.draw(drawing.event(2, 29, 90, 90, "touch"));
  drawing.api.cancelDrawingForPinch();
  const canvas = drawing.canvases[2];
  assert.deepEqual(drawing.api.paths.current[2], []);
  const draws = canvas.context.lines.length;
  const extraFinger = (x) => ({ ...drawing.event(2, 30, x, 100, "touch"), isPrimary: false });
  drawing.api.startDrawing(extraFinger(100));
  drawing.api.draw(extraFinger(120));
  drawing.api.stopDrawing(extraFinger(120));
  assert.deepEqual(drawing.api.paths.current[2], []);
  assert.equal(canvas.context.lines.length, draws);
  assert.equal(canvas.captured.size, 0);
  drawing.api.startDrawing(drawing.event(2, 31, 140, 140, "touch"));
  drawing.api.draw(drawing.event(2, 31, 160, 160, "touch"));
  drawing.api.stopDrawing(drawing.event(2, 31, 160, 160, "touch"));
  assert.equal(drawing.api.paths.current[2].length, 1);
  assert.equal(canvas.context.visibleLines.length, 1);
  assert.equal(canvas.captured.size, 0);
});
