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
    lines: [], save() {}, restore() {}, beginPath() {}, moveTo() {},
    lineTo(x, y) { this.lines.push({ x, y }); },
    stroke() {}, closePath() {}, setLineDash() {}, clearRect() {},
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
    window: { addEventListener() {}, removeEventListener() {} },
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
    unmount: () => hooks.slots.forEach((slot) => slot.cleanup?.()),
    event: (page, id, x, y, type = "pen") => ({
      currentTarget: canvases[page], target: canvases[page], pointerId: id, pointerType: type,
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
