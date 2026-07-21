import type { DocumentProps, PageProps, ThumbnailProps } from "react-pdf";
import { colorMap } from "../utils/common";

// react-pdf 공개 타입에서 유도 (내부 경로 import 대체)
export type OnRenderSuccess = NonNullable<PageProps["onRenderSuccess"]>;
export type CustomTextRenderer = NonNullable<PageProps["customTextRenderer"]>;
export type OnItemClickArgs = Parameters<
  NonNullable<ThumbnailProps["onItemClick"]>
>[0];
export type PdfDocumentType = Parameters<
  NonNullable<DocumentProps["onLoadSuccess"]>
>[0];

export type DrawType = "pen" | "highlight" | "eraser";
export type TouchType = "touch" | "pen";
export type canvasEventType = React.PointerEvent<HTMLCanvasElement> &
  React.TouchEvent<HTMLCanvasElement>;
export type PathsType = {
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  lineWidth: number;
  color: (typeof colorMap)[number];
  drawOrder: string;
  alpha: number;
};
export type PageSize = { width: number; height: number };
export type PdfStateType = {
  isToolBarOpen: boolean;
  isListOpen: boolean;
  isFullScreen: boolean;
  isStrokeOpen: boolean;
  pageNumber: number;
  totalPage: number;
  renderedPageNumber: number;
};
export type PdfConfigType = {
  size: { width: number; height: number };
  strokeStep: number;
  devicePixelRatio: number;
};
