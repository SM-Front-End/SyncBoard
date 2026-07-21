import { LineCapStyle, PageSizes, PDFDocument, PDFPage, rgb } from "pdf-lib";
import { canvasEventType, PathsType } from "../types/common";
import { isTablet } from "react-device-detect";
import UTIF from "utif";
import { RefObject } from "react";

export const __DEV__ = import.meta.env.MODE === "development";

// 필기 좌표계가 가정하는 고정 픽셀 배율. pdfConfigAtom.devicePixelRatio 및
// 캔버스 2배 렌더링과 항상 같은 값이어야 저장된 PDF 좌표가 어긋나지 않는다.
export const DRAWING_DPR = 2;

export const colorMap = [
  "#202325",
  "#007AFF",
  "#54B41D",
  "#FFBB00",
  "#F34A47",
] as const;

export const colors = {
  "#202325": rgb(32 / 255, 35 / 255, 37 / 255),
  "#007AFF": rgb(0 / 255, 122 / 255, 255 / 255),
  "#54B41D": rgb(84 / 255, 180 / 255, 29 / 255),
  "#FFBB00": rgb(255 / 255, 187 / 255, 0 / 255),
  "#F34A47": rgb(243 / 255, 74 / 255, 71 / 255),
} as const;

export const getClientPosition = (
  e: canvasEventType,
  devicePixelRatio: number,
  type: "x" | "y"
) => {
  return (
    (e.nativeEvent instanceof MouseEvent
      ? e[type === "x" ? "clientX" : "clientY"]
      : e.touches[0][type === "x" ? "clientX" : "clientY"]) * devicePixelRatio
  );
};

export const getDrawingPosition = (
  canvas: HTMLCanvasElement,
  e: canvasEventType,
  devicePixelRatio: number,
  scale: number
) => {
  if (!canvas) {
    return { x: 0, y: 0 };
  }

  const rect = canvas.getBoundingClientRect(); // 캔버스의 위치와 크기를 가져옴
  const clientX = getClientPosition(e, devicePixelRatio, "x");
  const clientY = getClientPosition(e, devicePixelRatio, "y");
  const x = (clientX - devicePixelRatio * rect.left) / scale;
  const y = (clientY - devicePixelRatio * rect.top) / scale;

  return { x, y };
};

export const drawDashedLine = (
  context: CanvasRenderingContext2D,
  lastX: number,
  lastY: number,
  x: number,
  y: number
) => {
  context.globalAlpha = 1;
  context.strokeStyle = "red";
  context.lineWidth = 5;
  context.lineCap = "round";

  context.setLineDash([1, 10]);
  context.beginPath();
  context.moveTo(lastX, lastY);
  context.lineTo(x, y);
  context.stroke();
  context.closePath();
  context.setLineDash([]);
};

export const drawLine = (
  context: CanvasRenderingContext2D,
  lastX: number,
  lastY: number,
  x: number,
  y: number,
  style: { color: string; lineWidth: number; alpha: number }
) => {
  context.globalAlpha = style.alpha;
  context.strokeStyle = style.color;
  context.lineWidth = style.lineWidth;
  context.lineCap = style.alpha === 1 ? "round" : "butt";
  context.lineJoin = "round";

  context.beginPath();
  context.moveTo(lastX, lastY);
  context.lineTo(x, y);
  context.stroke();
};

export const reDrawPathGroup = (
  context: CanvasRenderingContext2D,
  group: PathsType[],
  style: { color: string; lineWidth: number; alpha: number },
  pageWidth: number,
  pageHeight: number
) => {
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.globalAlpha = style.alpha;
  context.strokeStyle = style.color;
  context.lineWidth = style.lineWidth * pageWidth;

  // 패스 그리기
  context.moveTo(group[0].x * pageWidth, group[0].y * pageHeight);
  for (let i = 1; i < group.length; i++) {
    context.lineTo(group[i].x * pageWidth, group[i].y * pageHeight);
  }
  context.stroke();

  // 컨텍스트 상태 복원
  context.restore();
};

export const colorToRGB = (color: (typeof colorMap)[number]) => {
  return colors[color as keyof typeof colors];
};

export const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const highlightPattern = (text: string, pattern: string) => {
  if (!pattern) return text;
  const regex = new RegExp(escapeRegExp(pattern), "gi");
  return text.replace(
    regex,
    (value) =>
      `<span style="
        background-color: rgba(255, 255, 0, 0.4);
      ">${value}</span>`
  );
};

export const removeAllPath = (
  paths: RefObject<{ [pageNumber: number]: PathsType[] }>
) => {
  for (const key in paths.current) {
    if (paths.current[key]) {
      paths.current[key] = [];
    }
  }
};

// 이어진 선분(이전 점의 좌표가 lastX/lastY와 일치)끼리 그룹으로 묶어
// 그룹 단위로 콜백을 실행한다. 캔버스 재그리기·썸네일·PDF 저장이 공유하는 로직.
export const forEachPathGroup = (
  points: PathsType[] | undefined,
  callback: (
    group: PathsType[],
    style: { color: string; lineWidth: number; alpha: number }
  ) => void
) => {
  if (!points || points.length <= 1) return;

  let currentGroup: PathsType[] = [];
  let currentStyle = {
    color: points[1].color,
    lineWidth: points[1].lineWidth,
    alpha: points[1].alpha,
  };

  for (let i = 1; i < points.length; i++) {
    // 선이 이어진 경우
    if (
      points[i].lastX === points[i - 1].x &&
      points[i].lastY === points[i - 1].y
    ) {
      if (i === 1) currentGroup.push(points[0]);
      currentGroup.push(points[i]);
      continue;
    }

    // 선이 띄워진 경우: 지금까지의 그룹을 처리하고 새 그룹 시작
    if (currentGroup.length) {
      callback(currentGroup, currentStyle);
    }
    currentGroup = [points[i]];
    currentStyle = {
      color: points[i].color,
      lineWidth: points[i].lineWidth,
      alpha: points[i].alpha,
    };
  }

  // 마지막 그룹 처리
  if (currentGroup.length) {
    callback(currentGroup, currentStyle);
  }
};

// 점 (px, py)와 선분 (x1,y1)-(x2,y2) 사이의 최단 거리
export const distancePointToSegment = (
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};

export const getModifiedPDFBase64 = async (
  paths: {
    [pageNumber: number]: PathsType[];
  },
  base64Data: string
) => {
  // 기존 PDF 로드
  const existingPdfBytes = base64Data;
  const pdfDoc = await PDFDocument.load(existingPdfBytes);
  for (let i = 0; i < pdfDoc.getPageCount(); i++) {
    const points = paths[i + 1];
    const page = pdfDoc.getPage(i);
    const { width: pageWidth, height: pageHeight } = page.getSize();

    forEachPathGroup(points, (group, style) => {
      drawPDFPathGroup(page, group, style, pageWidth, pageHeight);
    });
  }

  if (!isTablet || __DEV__) {
    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "modified.pdf");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
  const base64DataUri = await pdfDoc.saveAsBase64();
  return base64DataUri;
};

const drawPDFPathGroup = (
  page: PDFPage,
  group: PathsType[],
  style: { color: string; lineWidth: number; alpha: number },
  pageWidth: number,
  pageHeight: number
) => {
  // 필기 좌표는 DRAWING_DPR 배율 기준으로 정규화되어 있으므로, 기기의
  // window.devicePixelRatio가 아니라 항상 같은 고정 배율로 되돌려야 한다.
  if (style.alpha !== 1) {
    // 첫 점의 좌표로 시작 (y좌표는 pageHeight에서 빼서 뒤집기)
    let pathData = `M ${(group[0].x * pageWidth) / DRAWING_DPR},${
      (group[0].y * pageHeight) / DRAWING_DPR
    }`;

    // 나머지 점들을 L 명령어로 연결
    for (let i = 1; i < group.length; i++) {
      pathData += ` L ${(group[i].x * pageWidth) / DRAWING_DPR},${
        (group[i].y * pageHeight) / DRAWING_DPR
      }`;
    }
    page.drawSvgPath(pathData, {
      borderColor: colorToRGB(style.color as (typeof colorMap)[number]),
      borderWidth: (style.lineWidth * pageWidth) / DRAWING_DPR,
      borderOpacity: style.alpha,
      borderLineCap: LineCapStyle.Round,
      x: 0,
      y: pageHeight,
    });
  } else {
    for (let i = 1; i < group.length; i++) {
      page.drawLine({
        start: {
          x: (group[i - 1].x * pageWidth) / DRAWING_DPR,
          y: pageHeight - (group[i - 1].y * pageHeight) / DRAWING_DPR,
        },
        end: {
          x: (group[i].x * pageWidth) / DRAWING_DPR,
          y: pageHeight - (group[i].y * pageHeight) / DRAWING_DPR,
        },
        color: colorToRGB(style.color as (typeof colorMap)[number]),
        thickness: (style.lineWidth * pageWidth) / DRAWING_DPR,
        lineCap: style.alpha === 1 ? LineCapStyle.Round : LineCapStyle.Butt,
        opacity: style.alpha,
      });
    }
  }
};

export async function createOrMergePdf(base64String?: string) {
  let pdfDoc: PDFDocument;

  if (!base64String) {
    // Base64 문자열이 없는 경우 새로운 PDF 문서 생성
    pdfDoc = await PDFDocument.create();
  } else {
    // 기존 Base64 문자열이 있는 경우 해당 PDF 로드
    pdfDoc = await base64ToPdf(base64String);
  }

  // 새로운 페이지 추가
  pdfDoc.addPage(PageSizes.A4);

  // 최종 PDF를 Base64 문자열로 변환하여 반환
  return pdfToBase64(pdfDoc);
}

export async function base64ToPdf(base64String: string) {
  const pdfBytes = Uint8Array.from(atob(base64String), (c) => c.charCodeAt(0));
  return await PDFDocument.load(pdfBytes);
}

export async function pdfToBase64(pdfDoc: PDFDocument) {
  return pdfDoc.saveAsBase64();
}

export async function createPDFFromImgBase64(
  base64Image: string,
  imageType: string
) {
  // PDF 문서 생성
  const pdfDoc = await PDFDocument.create();

  // base64 이미지를 PDF에 삽입
  let image;
  let embedPng;
  // 이미지 타입에 따른 처리
  switch (imageType.toLowerCase()) {
    case "png":
      image = await pdfDoc.embedPng(base64Image);
      break;
    case "jpg":
    case "jpeg":
      image = await pdfDoc.embedJpg(base64Image);
      break;
    case "bmp":
    case "wbmp":
    case "gif":
    case "ico":
      embedPng = (await convertImageToPng(base64Image, imageType)) as string;
      image = await pdfDoc.embedPng(embedPng);
      break;
    case "svg":
      embedPng = (await convertImageToPng(base64Image, "svg+xml")) as string;
      image = await pdfDoc.embedPng(embedPng);
      break;
    case "tif":
    case "tiff":
      embedPng = (await convertTiffToPng(base64Image)) as string;
      image = await pdfDoc.embedPng(embedPng);
      break;
    default:
      throw new Error("지원하지 않는 이미지 형식입니다.");
  }

  const page = pdfDoc.addPage([image.width, image.height]);
  page.drawImage(image);

  return pdfDoc.saveAsBase64();
}

const convertImageToPng = async (imageBase64: string, imageType: string) => {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = `data:image/${imageType};base64,${imageBase64}`;

    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      // PNG로 변환
      const pngBase64 = canvas.toDataURL("image/png");
      resolve(pngBase64); // 변환된 PNG의 base64 문자열 반환
    };

    img.onerror = (error) => {
      reject(error); // 이미지 로드 실패 시 에러 반환
    };
  });
};

function convertTiffToPng(tiffBase64: string) {
  // base64 문자열을 ArrayBuffer로 변환
  const binaryString = atob(tiffBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const buffer = bytes.buffer;

  // TIFF 디코딩
  const ifds = UTIF.decode(buffer);
  const tiffData = ifds[0];
  UTIF.decodeImage(buffer, tiffData);
  const rgba = UTIF.toRGBA8(tiffData);

  // Canvas 생성 및 이미지 그리기
  const canvas = document.createElement("canvas");
  canvas.width = tiffData.width;
  canvas.height = tiffData.height;
  const ctx = canvas.getContext("2d")!;

  const imageData = new ImageData(
    new Uint8ClampedArray(rgba),
    tiffData.width,
    tiffData.height
  );
  ctx.putImageData(imageData, 0, 0);

  // PNG base64 문자열로 변환
  return canvas.toDataURL("image/png");
}

export function getReducedPdfSize(
  pdfWidth: number,
  pdfHeight: number,
  screenWidth: number,
  screenHeight: number
) {
  // 비율 계산
  const pdfAspectRatio = pdfWidth / pdfHeight;
  const screenAspectRatio = screenWidth / screenHeight;

  let reducedWidth, reducedHeight;

  if (pdfAspectRatio > screenAspectRatio) {
    // PDF가 더 넓은 비율일 때
    reducedWidth = screenWidth;
    reducedHeight = screenWidth / pdfAspectRatio;
  } else {
    // PDF가 더 높은 비율일 때
    reducedHeight = screenHeight;
    reducedWidth = screenHeight * pdfAspectRatio;
  }

  return {
    width: Math.min(reducedWidth, screenWidth),
    height: Math.min(reducedHeight, screenHeight),
  };
}
