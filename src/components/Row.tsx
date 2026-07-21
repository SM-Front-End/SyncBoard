import { CSSProperties, useCallback } from "react";
import { Page } from "react-pdf";
import { type RowComponentProps } from "react-window";
import PlaceholderPage from "./PlaceholderPage";
import {
  CustomTextRenderer,
  OnRenderSuccess,
} from "react-pdf/src/shared/types.js";
import { highlightPattern } from "../libs/utils/common";
import clsx from "clsx";
import { canvasEventType } from "../libs/types/common";
import { typedMemo } from "../libs/utils/typedMemo";

const Row = typedMemo(
  ({
    index,
    style,
    pdfSize,
    searchText,
    setRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    canDraw,
    onRenderSuccess,
  }: RowComponentProps<{
    pdfSize: { width: number; height: number };
    searchText: string;
    canDraw?: boolean;
    onPointerDown: (e: canvasEventType) => void;
    onPointerMove: (e: canvasEventType) => void;
    onPointerUp: (e: canvasEventType) => void;
    setRef: (node: HTMLCanvasElement) => void;
    onRenderSuccess: OnRenderSuccess;
  }>) => {
    const textRenderer: CustomTextRenderer = useCallback(
      (textItem) => highlightPattern(textItem.str, searchText.trim()),
      [searchText]
    );

    const Loading = useCallback(
      () => (
        <div style={{ width: pdfSize.width, height: pdfSize.height }}>
          <PlaceholderPage />
        </div>
      ),
      [pdfSize]
    );

    const _style: CSSProperties = {
      ...style,
      height: Number(style.height) - 10,
    };

    return (
      <div
        key={index + 1}
        className="w-full flex justify-center bg-[#94A3B8]"
        style={_style}
      >
        <div
          style={{
            position: "absolute",
            width: pdfSize.width,
            height: pdfSize.height,
            backgroundColor: "white",
          }}
        >
          <PlaceholderPage />
        </div>
        <Page
          pageNumber={index + 1}
          width={pdfSize.width}
          height={pdfSize.height}
          devicePixelRatio={2}
          renderAnnotationLayer={false}
          onRenderSuccess={onRenderSuccess}
          customTextRenderer={textRenderer}
          loading={Loading}
          noData={<></>}
        >
          <canvas
            ref={setRef}
            width={pdfSize.width * 2}
            height={pdfSize.height * 2}
            className={clsx(
              "absolute touch-none z-[1000] top-0 w-full h-full",
              canDraw ? "" : "pointer-events-none"
            )}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            data-index={index + 1}
          />
        </Page>
      </div>
    );
  }
);

export default Row;
