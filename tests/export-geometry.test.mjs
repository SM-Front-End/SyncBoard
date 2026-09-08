import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import { loadModule } from "./helpers/load-typescript.mjs";

const require = createRequire(import.meta.url);
const { PDFDocument, PDFPage, PDFName, PDFNumber, decodePDFRawStream } = require("pdf-lib");
const { getModifiedPDFBase64 } = loadModule("src/libs/utils/common.ts", {
  "react-device-detect": { isTablet: true },
});

// Use the installed renderer's viewport as an independent geometry oracle. Isolating
// this class avoids importing browser-only DOMMatrix/canvas dependencies into Node.
const renderer = readFileSync(require.resolve("pdfjs-dist/build/pdf.mjs"), "utf8");
const start = renderer.indexOf("class PageViewport {");
const end = renderer.indexOf("class RenderingCancelledException", start);
assert.ok(start >= 0 && end > start, "installed pdf.js must expose its viewport class");
const sandbox = {};
vm.runInNewContext(`${renderer.slice(start, end)};this.PageViewport = PageViewport;`, sandbox);

const vertices = [{ x: 0.14, y: 0.22 }, { x: 0.5, y: 1.42 }, { x: 1.8, y: 0.72 }];
const normalizeBox = (box) => [
  Math.min(box[0], box[2]), Math.min(box[1], box[3]),
  Math.max(box[0], box[2]), Math.max(box[1], box[3]),
];
function visibleBox(media, crop) {
  media = normalizeBox(media);
  crop = normalizeBox(crop ?? media);
  const intersection = [
    Math.max(media[0], crop[0]), Math.max(media[1], crop[1]),
    Math.min(media[2], crop[2]), Math.min(media[3], crop[3]),
  ];
  return intersection[0] < intersection[2] && intersection[1] < intersection[3]
    ? intersection : media;
}
const near = (actual, expected, label) => assert.ok(
  Math.abs(actual - expected) < 1e-8,
  `${label}: expected ${expected}, got ${actual}`,
);
const transformPoint = ({ x, y }, m) => [
  x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5],
];

for (const box of [
  { name: "full page", media: [0, 0, 600, 800] },
  { name: "offset CropBox and MediaBox", media: [10, 20, 610, 820], crop: [110, 170, 510, 670] },
  { name: "partially overlapping CropBox", media: [0, 0, 600, 800], crop: [-40, 120, 500, 980] },
  { name: "disjoint CropBox fallback", media: [0, 0, 600, 800], crop: [700, 900, 800, 950] },
  { name: "reversed CropBox coordinates", media: [0, 0, 600, 800], crop: [500, 650, 100, 150] },
]) {
  test(`PDF export preserves visible stroke geometry: ${box.name}`, async (t) => {
    const originalLine = PDFPage.prototype.drawLine;
    const originalSvg = PDFPage.prototype.drawSvgPath;
    let captured = [];
    t.mock.method(PDFPage.prototype, "drawLine", function (options) {
      captured.push({ options });
      return originalLine.call(this, options);
    });
    t.mock.method(PDFPage.prototype, "drawSvgPath", function (svg, options) {
      captured.push({ svg, options });
      return originalSvg.call(this, svg, options);
    });

    for (const rotation of [0, 90, 180, 270, -90, 450, 45]) {
      for (const userUnit of [1, 2.5]) {
        for (const alpha of [1, 0.4]) {
          const label = `${box.name}, rotation=${rotation}, UserUnit=${userUnit}, alpha=${alpha}`;
          const doc = await PDFDocument.create();
          const page = doc.addPage([600, 800]);
          page.node.set(PDFName.of("MediaBox"), doc.context.obj(box.media));
          if (box.crop) page.node.set(PDFName.of("CropBox"), doc.context.obj(box.crop));
          page.node.set(PDFName.of("Rotate"), PDFNumber.of(rotation));
          page.node.set(PDFName.of("UserUnit"), PDFNumber.of(userUnit));
          const view = new sandbox.PageViewport({
            viewBox: visibleBox(box.media, box.crop), userUnit, scale: 1,
            rotation: rotation % 90 === 0 ? ((rotation % 360) + 360) % 360 : 0,
          });
          const stroke = vertices.slice(1).map((point, i) => ({
            lastX: vertices[i].x, lastY: vertices[i].y, x: point.x, y: point.y,
            lineWidth: 0.017, color: "#F34A47", alpha, drawOrder: "one-stroke",
          }));
          captured = [];
          const result = await getModifiedPDFBase64({ 1: stroke }, await doc.save());
          const restored = await PDFDocument.load(result);
          const restoredPage = restored.getPage(0);
          assert.equal(restored.getPageCount(), 1, label);
          assert.equal(restoredPage.getRotation().angle, rotation, `${label}: rotation preserved`);
          assert.equal(restoredPage.node.get(PDFName.of("UserUnit")).asNumber(), userUnit, label);
          assert.deepEqual(restoredPage.node.MediaBox().asArray().map((n) => n.asNumber()), box.media, label);
          if (box.crop) assert.deepEqual(restoredPage.node.CropBox().asArray().map((n) => n.asNumber()), box.crop, label);

          let actualVertices, width;
          if (alpha === 1) {
            assert.equal(captured.length, 2, label);
            actualVertices = [captured[0].options.start, ...captured.map((item) => item.options.end)];
            width = captured[0].options.thickness;
          } else {
            assert.equal(captured.length, 1, `${label}: highlighter stays one stroke`);
            const entry = captured[0];
            assert.equal(entry.options.borderOpacity, alpha, label);
            actualVertices = [...entry.svg.matchAll(/[ML] ([^,]+),([^ ]+)/g)].map((match) => ({
              x: Number(match[1]) + entry.options.x,
              y: -Number(match[2]) + entry.options.y,
            }));
            width = entry.options.borderWidth;
          }
          assert.equal(actualVertices.length, vertices.length, label);
          actualVertices.forEach((point, i) => {
            const screen = transformPoint(point, view.transform);
            near(screen[0], vertices[i].x / 2 * view.width, `${label}: x`);
            near(screen[1], vertices[i].y / 2 * view.height, `${label}: y`);
          });
          near(width * userUnit, 0.017 / 2 * view.width, `${label}: rendered width`);
          const contents = restoredPage.node.Contents().asArray().map((ref) =>
            Buffer.from(decodePDFRawStream(restored.context.lookup(ref)).decode()).toString(),
          ).join("\n");
          assert.ok(contents.includes(" m\n") && contents.includes(" l\n") && contents.includes("S\n"),
            `${label}: saved drawing operators survive reload`);
        }
      }
    }
  });
}
