import { CSSProperties, useCallback, useEffect, useMemo } from "react";
import { Page } from "react-pdf";
import { type RowComponentProps } from "react-window";
import PlaceholderPage from "./PlaceholderPage";
import {
  createHighlightRegex,
  DRAWING_DPR,
  highlightPattern,
} from "../libs/utils/common";
import clsx from "clsx";
import {
  canvasEventType,
  CustomTextRenderer,
  OnRenderSuccess,
} from "../libs/types/common";
import { typedMemo } from "../libs/utils/typedMemo";
import { usePageRenderRetry } from "../hooks/usePageRenderRetry";
import { useTranslation } from "../hooks/useTranslation";

const Row = typedMemo(
  ({
    index,
    style,
    pageSizes,
    searchText,
    setRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    canDraw,
    onRenderSuccess,
    documentPageCount,
    onBlankPageMount,
  }: RowComponentProps<{
    pageSizes: { width: number; height: number }[];
    searchText: string;
    canDraw?: boolean;
    onPointerDown: (e: canvasEventType) => void;
    onPointerMove: (e: canvasEventType) => void;
    onPointerUp: (e: canvasEventType) => void;
    onPointerCancel: (e: canvasEventType) => void;
    setRef: (node: HTMLCanvasElement) => (() => void) | void;
    onRenderSuccess: OnRenderSuccess;
    documentPageCount: number;
    onBlankPageMount: (pageNumber: number) => void;
  }>) => {
    const { t } = useTranslation();
    const pageNumber = index + 1;
    const pdfSize = pageSizes[index];
    // newPage로 덧붙인 페이지. 원본 문서에는 없으므로 <Page> 없이 흰 배경만 그린다.
    const isBlankPage = documentPageCount > 0 && pageNumber > documentPageCount;

    const {
      renderKey,
      hasFailed,
      isRendered,
      onLoadError,
      onRenderError,
      onRenderSuccess: markRendered,
      retryManually,
    } = usePageRenderRetry({
      pageNumber,
      // 페이지 번호나 렌더 크기가 바뀌면 재시도 카운터를 초기화한다
      resetKey: `${pageNumber}:${pdfSize.width}x${pdfSize.height}`,
    });

    const handleRenderSuccess: OnRenderSuccess = useCallback(
      (page) => {
        markRendered();
        onRenderSuccess(page);
      },
      [markRendered, onRenderSuccess],
    );

    // 검색어당 정규식을 한 번만 만든다 (텍스트 아이템마다 재생성하면 페이지당 수백 회)
    const highlightRegex = useMemo(
      () => createHighlightRegex(searchText.trim()),
      [searchText],
    );

    const textRenderer: CustomTextRenderer = useCallback(
      (textItem) => highlightPattern(textItem.str, highlightRegex),
      [highlightRegex],
    );

    const _style: CSSProperties = useMemo(
      () => ({ ...style, height: Number(style.height) - 10 }),
      [style],
    );

    // 빈 페이지는 onRenderSuccess가 없으므로 마운트 시 필기를 직접 복원한다.
    useEffect(() => {
      if (isBlankPage) onBlankPageMount(pageNumber);
    }, [isBlankPage, onBlankPageMount, pageNumber]);

    const drawingCanvas = (
      <canvas
        ref={setRef}
        width={pdfSize.width * DRAWING_DPR}
        height={pdfSize.height * DRAWING_DPR}
        className={clsx(
          "absolute touch-none z-1000 top-0 w-full h-full",
          canDraw ? "" : "pointer-events-none",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerCancel}
        data-index={pageNumber}
      />
    );

    return (
      <div className="w-full flex justify-center bg-[#94A3B8]" style={_style}>
        <div
          style={{
            position: "absolute",
            width: pdfSize.width,
            height: pdfSize.height,
            backgroundColor: "white",
          }}
        >
          {/* 렌더가 끝나면 스피너를 걷어낸다. 계속 두면 마운트된 모든 행에서
              애니메이션이 영원히 돌아 스크롤 성능을 갉아먹는다. */}
          {!isBlankPage && !isRendered && !hasFailed && <PlaceholderPage />}
        </div>
        {isBlankPage ? (
          <div
            className="relative"
            style={{ width: pdfSize.width, height: pdfSize.height }}
          >
            {drawingCanvas}
          </div>
        ) : (
          <Page
            key={renderKey}
            pageNumber={pageNumber}
            width={pdfSize.width}
            devicePixelRatio={DRAWING_DPR}
            renderAnnotationLayer={false}
            onRenderSuccess={handleRenderSuccess}
            onRenderError={onRenderError}
            onLoadError={onLoadError}
            customTextRenderer={highlightRegex ? textRenderer : undefined}
            loading={<></>}
            noData={<></>}
            error={<></>}
          >
            {drawingCanvas}
          </Page>
        )}
        {/* 재시도를 모두 소진한 경우: 실패한 캔버스(z-1000) 위에 덮어 수동 재시도 제공 */}
        {hasFailed && !isBlankPage && (
          <div
            className="absolute z-1001 bg-white flex-center flex-col gap-3"
            style={{ width: pdfSize.width, height: pdfSize.height }}
          >
            <span className="text-[#353B45] text-sm">
              {t("page_render_failed")}
            </span>
            <button
              onClick={retryManually}
              className="h-9 px-4 rounded-lg bg-[#5865FA] text-white text-sm"
            >
              {t("retry")}
            </button>
          </div>
        )}
      </div>
    );
  },
);

export default Row;
