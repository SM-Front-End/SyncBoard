import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

function compile(source, mocks = {}) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    require: (name) => {
      if (!Object.hasOwn(mocks, name)) throw new Error(`Unexpected dependency: ${name}`);
      return mocks[name];
    },
  });
  return exports;
}

const readSource = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
const commonSource = readSource("src/libs/utils/common.ts");
const commonAst = ts.createSourceFile("common.ts", commonSource, ts.ScriptTarget.Latest, true);
const fitFunction = commonAst.statements.find((node) =>
  ts.isFunctionDeclaration(node) && node.name?.text === "getReducedPdfSize");
const common = compile(fitFunction.getText(commonAst));
const { fitPageSize, getPageOffsets, getPageAtOffset, getPdfPageSizes } = compile(
  readSource("src/libs/utils/pageLayout.ts"), { "./common": common },
);

test("portrait, landscape and square pages receive independent fitted dimensions", () => {
  const portrait = fitPageSize({ width: 600, height: 800 }, 1024, 768);
  const landscape = fitPageSize({ width: 800, height: 600 }, 1024, 768);
  const square = fitPageSize({ width: 600, height: 600 }, 1024, 768);
  assert.equal(portrait.width, 513);
  assert.equal(portrait.height, 684);
  assert.equal(landscape.width, 896);
  assert.equal(landscape.height, 672);
  assert.equal(square.width, 684);
  // 600 * (684 / 600) is just below 684 in floating point, as in PDF.js.
  assert.equal(square.height, 683);
});

test("fractional PDF dimensions round to the same CSS pixels as the rendered viewport", () => {
  const page = { width: 595.275590551, height: 841.88976378 };
  for (const [width, height] of [[1024, 768], [768, 1024], [1280, 800]]) {
    const fit = fitPageSize(page, width, height);
    assert.equal(Number.isInteger(fit.width), true);
    assert.equal(fit.height, Math.floor(page.height * (fit.width / page.width)));
    assert.ok(fit.width > 0 && fit.width <= width - 128);
    assert.ok(fit.height > 0 && fit.height <= height - 84);
  }
});

test("mixed-height virtual rows use cumulative offsets including the page gaps", () => {
  const offsets = getPageOffsets([
    { width: 400, height: 600 },
    { width: 600, height: 200 },
    { width: 400, height: 400 },
  ]);
  assert.deepEqual(Array.from(offsets), [0, 610, 820, 1230]);
  for (const [offset, page] of [[-20, 1], [0, 1], [609, 1], [610, 2],
    [819, 2], [820, 3], [1230, 3], [2000, 3]]) {
    assert.equal(getPageAtOffset(offsets, offset), page);
  }
});

test("metadata batching preserves page order across batches and rotated viewports", async () => {
  let inFlight = 0;
  let maximumInFlight = 0;
  const requested = [];
  const pdf = {
    numPages: 23,
    getPage: async (pageNumber) => {
      requested.push(pageNumber);
      maximumInFlight = Math.max(maximumInFlight, ++inFlight);
      await Promise.resolve();
      inFlight--;
      return {
        getViewport: ({ scale }) => {
          assert.equal(scale, 1);
          return pageNumber % 2
            ? { width: 600 + pageNumber, height: 800 }
            : { width: 800, height: 600 + pageNumber };
        },
      };
    },
  };
  const sizes = await getPdfPageSizes(pdf);
  assert.equal(sizes.length, 23);
  assert.equal(maximumInFlight, 10);
  assert.deepEqual(requested, Array.from({ length: 23 }, (_, index) => index + 1));
  for (let index = 0; index < sizes.length; index++) {
    const pageNumber = index + 1;
    assert.equal(sizes[index].width, pageNumber % 2 ? 600 + pageNumber : 800);
    assert.equal(sizes[index].height, pageNumber % 2 ? 800 : 600 + pageNumber);
  }
});

test("metadata failures reject preparation instead of publishing partial dimensions", async () => {
  await assert.rejects(getPdfPageSizes({
    numPages: 12,
    getPage: async (pageNumber) => {
      if (pageNumber === 11) throw new Error("failed page metadata");
      return { getViewport: () => ({ width: 600, height: 800 }) };
    },
  }), /failed page metadata/);
});
