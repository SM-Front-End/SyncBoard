import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page } from "react-pdf";
import { useMobileOrientation } from "react-device-detect";
import {
  CustomTextRenderer,
  OnDocumentLoadSuccess,
  OnPageLoadSuccess,
  OnRenderSuccess,
} from "react-pdf/src/shared/types.js";
import { ReactZoomPanPinchContentRef } from "react-zoom-pan-pinch";
import useCanvas from "./hooks/useCanvas";
import PdfOverlay from "./components/PdfOverlay";
import ThumbnailOvelay from "./components/ThumbnailOvelay";
import { highlightPattern, removeAllPath } from "./utils/common";
import { usePdfTextSearch } from "./hooks/usePdfTextSearch";
import PinchZoomLayout from "./components/PinchZoomLayout";
import { PathsType } from "./types/common";
import clsx from "clsx";
import { useWebviewInterface } from "./hooks/useWebviewInterface";
import { useAtom, useAtomValue } from "jotai";
import {
  fileAtom,
  pdfConfigAtom,
  pdfStateAtom,
  searchTextAtom,
} from "./store/pdf";
import { PageSizes } from "pdf-lib";
import { PDF_Y_GAP } from "./contstants/pdf";

export default function PdfEngine() {
  const { orientation } = useMobileOrientation();
  const canvasRefs = useRef<HTMLCanvasElement[]>([]);
  const scaleRef = useRef<ReactZoomPanPinchContentRef>(null);
  const searchText = useAtomValue(searchTextAtom);
  const file = useAtomValue(fileAtom);
  const [pdfState, setPdfState] = useAtom(pdfStateAtom);
  const [pdfConfig, setPdfConfig] = useAtom(pdfConfigAtom);
  const {
    canDraw,
    setCanDraw,
    paths,
    drawOrder,
    scale,
    drawType,
    color,
    touchType,
    setColor,
    setDrawType,
    startDrawing,
    draw,
    redrawPaths,
    stopDrawing,
    setTouchType,
  } = useCanvas({
    canvasRefs,
    devicePixelRatio: pdfConfig.devicePixelRatio,
    pageSize: pdfConfig.size,
    strokeStep: pdfConfig.strokeStep,
  });
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [currentViewingPage, setCurrentViewingPage] = useState(1);
  const [intersectEnabled, setIntersectEnabled] = useState(false);

  const { pdfWidth, pdfHeight } = useMemo(() => {
    let width, height;

    if (orientation === "portrait") {
      if (window.innerHeight < pdfConfig.size.height) {
        width = undefined;
        height = window.innerHeight;
      } else {
        width = pdfConfig.size.width;
        height = pdfConfig.size.height;
      }
    } else {
      if (window.innerHeight < pdfConfig.size.height) {
        width = undefined;
        height = window.innerHeight;
      } else {
        width = pdfConfig.size.width;
        height = window.innerHeight;
      }
    }

    return { pdfWidth: width, pdfHeight: height };
  }, [orientation, pdfConfig]);

  const pdfFile = useMemo(
    () => `data:application/pdf;base64,${file.base64}`,
    [file.base64]
  );

  const setRef = useCallback(
    (node: HTMLCanvasElement) => {
      if (node) {
        const indexValue = Number(node.getAttribute("data-index"));
        canvasRefs.current[indexValue] = node;
        if (!intersectEnabled) {
          setIntersectEnabled(true);
        }
      }
    },
    [intersectEnabled]
  );

  const { getSearchResult } = usePdfTextSearch(pdfFile);

  useWebviewInterface({
    paths,
    getSearchResult,
  });

  const OnPageLoadSuccess: OnPageLoadSuccess = useCallback(
    (page) => {
      if (!file.isNew || page.width !== PageSizes.A4[0]) {
        setPdfConfig((prev) => ({
          ...prev,
          size: { width: page.width, height: page.height },
        }));
      }
      scaleRef.current?.resetTransform();
    },
    [file.isNew, setPdfConfig]
  );

  const OnDocumentLoadSuccess: OnDocumentLoadSuccess = useCallback(
    (pdf) => {
      if (!file.isNew) {
        setPdfState((prev) => ({
          ...prev,
          totalPage: pdf.numPages,
        }));
      }
    },
    [file.isNew, setPdfState]
  );

  const onRenderSuccess: OnRenderSuccess = useCallback(
    (page) => {
      if (canvasRefs.current) {
        redrawPaths(page.width, page.height, page.pageNumber);
        // setCurrentViewingPage(1);
      }
    },
    [redrawPaths]
  );

  const textRenderer: CustomTextRenderer = useCallback(
    (textItem) => highlightPattern(textItem.str, searchText.trim()),
    [searchText]
  );

  const onEraseAllClick = useCallback(() => {
    if (
      confirm(
        "모두 지우기를 선택하면 문서 전체의 변경 내용이 삭제됩니다.\n진행하시겠습니까?"
      )
    ) {
      removeAllPath(paths);
      canvasRefs.current.forEach((canvasRef) => {
        canvasRef
          .getContext("2d")!
          .clearRect(0, 0, canvasRef.width, canvasRef.height);
      });
    }
  }, [paths]);

  const PdfItem = useCallback(
    (_: any, index: number) => {
      return (
        <div
          key={index + 1}
          ref={(el) => (pageRefs.current[index] = el)}
          data-page={index + 1}
        >
          <Page
            pageNumber={index + 1}
            width={pdfWidth}
            height={pdfHeight}
            devicePixelRatio={pdfConfig.devicePixelRatio}
            onLoadSuccess={OnPageLoadSuccess}
            onRenderSuccess={onRenderSuccess}
            customTextRenderer={textRenderer}
            renderAnnotationLayer={false}
            renderTextLayer={file.isNew ? false : true}
            loading={<></>}
            noData={<></>}
          >
            <canvas
              ref={setRef}
              width={pdfConfig.size.width * pdfConfig.devicePixelRatio}
              height={pdfConfig.size.height * pdfConfig.devicePixelRatio}
              className={clsx(
                "absolute touch-none z-[1000] top-0 w-full h-full",
                canDraw ? "" : "pointer-events-none"
              )}
              onPointerDown={startDrawing}
              onPointerMove={draw}
              onPointerUp={stopDrawing}
              data-index={index + 1}
            />
          </Page>
        </div>
      );
    },
    [
      OnPageLoadSuccess,
      canDraw,
      draw,
      file.isNew,
      onRenderSuccess,
      pdfConfig.devicePixelRatio,
      pdfConfig.size.height,
      pdfConfig.size.width,
      pdfHeight,
      pdfWidth,
      setRef,
      startDrawing,
      stopDrawing,
      textRenderer,
    ]
  );

  useEffect(() => {
    if (intersectEnabled) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
              const pageNumber = Number(entry.target.getAttribute("data-page"));
              setCurrentViewingPage(pageNumber);
            }
          });
        },
        {
          threshold: 0.5, // 페이지가 50% 이상 보일 때 감지
          root: null, // viewport 기준
        }
      );

      // 각 페이지 요소에 observer 등록
      pageRefs.current.forEach((ref) => {
        if (ref) observer.observe(ref);
      });

      return () => observer.disconnect();
    }
  }, [intersectEnabled]);

  useEffect(() => {
    if (file.isNew && pdfState.isDocumentLoading) {
      setPdfState((prev) => ({
        ...prev,
        isDocumentLoading: false,
      }));
    }
  }, [file.isNew, pdfState.isDocumentLoading, setPdfState]);

  useEffect(() => {
    if (file.paths) {
      const savedPaths: { [pageNumber: number]: PathsType[] } = JSON.parse(
        file.paths
      );

      const maxDrawOrderItem = Object.values(savedPaths)
        .flat()
        .reduce(
          (maxItem, currentItem) => {
            return currentItem.drawOrder > maxItem.drawOrder
              ? currentItem
              : maxItem;
          },
          { drawOrder: 0 }
        );
      paths.current = savedPaths;
      drawOrder.current = maxDrawOrderItem.drawOrder;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="w-dvw min-h-dvh bg-gray-400">
        {pdfState.isDocumentLoading && file.isNew && (
          <div
            className="absolute bg-white"
            style={{
              width: pdfConfig.size.width,
              height: pdfConfig.size.height,
            }}
          />
        )}
        <Document
          file={pdfFile}
          onLoadSuccess={OnDocumentLoadSuccess}
          loading={<></>}
        >
          <PinchZoomLayout scale={scale} scaleRef={scaleRef}>
            <div
              className={clsx(
                "w-dvw flex-center flex-col",
                pdfState.totalPage === 1 ? "h-dvh" : ""
              )}
              style={{ rowGap: PDF_Y_GAP }}
            >
              {[...new Array(pdfState.totalPage)].map(PdfItem)}
            </div>
          </PinchZoomLayout>
          <ThumbnailOvelay
            paths={paths.current}
            canvasRefs={canvasRefs}
            currentViewingPage={currentViewingPage}
            scaleRef={scaleRef}
          />
        </Document>
      </div>
      {!pdfState.isListOpen && (
        <PdfOverlay
          paths={paths}
          color={color}
          drawType={drawType}
          touchType={touchType}
          setTouchType={setTouchType}
          setCanDraw={setCanDraw}
          setColor={setColor}
          setDrawType={setDrawType}
          onEraseAllClick={onEraseAllClick}
          currentViewingPage={currentViewingPage}
        />
      )}
    </>
  );
}
