import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModule } from "./helpers/load-typescript.mjs";

const { usePdfPan: invokePan } = loadModule("src/hooks/usePdfPan.ts", {
  react: {
    useRef: (current) => ({ current }),
    useCallback: (callback) => callback,
  },
});

function createPan(positionY = -100) {
  const calls = [], scrollPositions = [];
  const state = { scale: 2, positionX: -100, positionY };
  const transform = {
    state,
    setTransform(x, y, scale, duration) {
      calls.push([x, y, scale, duration]);
      Object.assign(state, { positionX: x, positionY: y, scale });
    },
  };
  let scrollTop = 500;
  const element = {
    get scrollTop() { return scrollTop; },
    set scrollTop(value) { scrollTop = Math.max(0, Math.min(1000, value)); },
    closest: () => null,
    setPointerCapture() {},
  };
  const event = (x, y) => ({
    button: 0, pointerId: 1, clientX: x, clientY: y,
    target: element, currentTarget: element, preventDefault() {},
  });
  const handlers = invokePan({
    scaleRef: { current: transform }, canDraw: false, width: 300, height: 200,
    onScrollPositionChange: (offset) => scrollPositions.push(offset),
  });
  handlers.onPointerDown(event(100, 100));
  return { calls, state, element, scrollPositions, move: (x, y) => handlers.onPointerMove(event(x, y)) };
}

for (const { name, bound, direction } of [
  { name: "upper", bound: 0, direction: 1 },
  { name: "lower", bound: -200, direction: -1 },
]) {
  test(`pan at the ${name} bound still scrolls without applying an unchanged transform`, () => {
    const pan = createPan(bound);
    pan.move(100, 100 + direction * 20);
    pan.move(100, 100 + direction * 30);
    assert.deepEqual(pan.calls, []);
    assert.equal(pan.state.positionY, bound);
    assert.equal(pan.element.scrollTop, 500 - direction * 15);
    assert.equal(pan.scrollPositions.at(-1), pan.element.scrollTop);
  });

  test(`crossing the ${name} bound splits pan and scroll, then reverses immediately`, () => {
    const pan = createPan(bound - direction * 10);
    pan.move(100, 100 + direction * 30);
    assert.deepEqual(pan.calls, [[-100, bound, 2, 0]]);
    assert.equal(pan.element.scrollTop, 500 - direction * 10);
    assert.equal(pan.scrollPositions.at(-1), pan.element.scrollTop);

    pan.move(100, 100 + direction * 40);
    assert.equal(pan.calls.length, 1);
    assert.equal(pan.element.scrollTop, 500 - direction * 15);

    pan.move(100, 100 + direction * 35);
    assert.deepEqual(pan.calls, [[-100, bound, 2, 0], [-100, bound - direction * 5, 2, 0]]);
    assert.equal(pan.element.scrollTop, 500 - direction * 15);
  });
}

test("interior movement pans both axes while repeated coordinates cause no transform or scroll", () => {
  const pan = createPan();
  pan.move(100, 100);
  assert.deepEqual(pan.calls, []);
  pan.move(115, 85);
  pan.move(115, 85);
  assert.deepEqual(pan.calls, [[-85, -115, 2, 0]]);
  assert.equal(pan.element.scrollTop, 500);
  assert.deepEqual(pan.scrollPositions, []);
});

test("boundary panning reports the browser-clamped offset before a scroll event arrives", () => {
  const pan = createPan(0);
  pan.element.scrollTop = 0;
  pan.move(100, 120);
  assert.deepEqual(pan.calls, []);
  assert.deepEqual(pan.scrollPositions, [0]);
});
