import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const filename = fileURLToPath(new URL("../src/libs/utils/common.ts", import.meta.url));
const source = readFileSync(filename, "utf8");
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
const names = new Set(["getClientPosition", "getDrawingPosition"]);
const functions = ast.statements.filter((node) =>
  ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) =>
    ts.isIdentifier(declaration.name) && names.has(declaration.name.text)));
const { outputText } = ts.transpileModule(functions.map((node) => node.getText(ast)).join("\n"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
class MouseEvent {}
const exports = {};
vm.runInNewContext(outputText, { exports, MouseEvent });
const { getDrawingPosition } = exports;

function position({ width, height, rect, clientX, clientY, dpr = 2, scale = 1 }) {
  return getDrawingPosition(
    { width, height, getBoundingClientRect: () => rect },
    { nativeEvent: new MouseEvent(), clientX, clientY },
    dpr,
    scale,
  );
}

test("pointer locations map to the same bitmap point at 1x, 2x and 3x", () => {
  for (const scale of [1, 2, 3]) {
    const rect = { left: -143, top: -271, width: 684 * scale, height: 900 * scale };
    const point = position({ width: 1368, height: 1800, rect, scale,
      clientX: rect.left + rect.width / 4, clientY: rect.top + rect.height / 4 });
    assert.equal(point.x, 342);
    assert.equal(point.y, 450);
  }
});

test("rounded and unequal CSS dimensions map each axis independently", () => {
  const rect = { left: 27.25, top: -118.5, width: 683, height: 901.25 };
  const point = position({ width: 1368, height: 1800, rect,
    clientX: rect.left + rect.width * 0.375,
    clientY: rect.top + rect.height * 0.625 });
  assert.equal(point.x, 513);
  assert.equal(point.y, 1125);
});

test("the measured rectangle overrides a stale scale or a different device DPR", () => {
  const rect = { left: -300, top: 80, width: 1366.5, height: 1799.75 };
  const point = position({ width: 1368, height: 1800, rect, scale: 1, dpr: 3,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2 });
  assert.equal(point.x, 684);
  assert.ok(Math.abs(point.y - 900) < 1e-9);
});

test("a zero-sized rectangle retains the existing DPR and scale fallback", () => {
  const point = position({ width: 1368, height: 1800,
    rect: { left: 10, top: 20, width: 0, height: 0 },
    clientX: 40, clientY: 80, dpr: 2, scale: 3 });
  assert.equal(point.x, 20);
  assert.equal(point.y, 40);
});
