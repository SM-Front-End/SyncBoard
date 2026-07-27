import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document } from "react-pdf";
import {
  OnItemClickArgs,
  OnRenderSuccess,
  PathsType,
  PdfDocumentType,
} from "./libs/types/common";
import {
  ReactZoomPanPinchContentRef,
  ReactZoomPanPinchRef,
  TransformComponent,
  TransformWrapper,
} from "react-zoom-pan-pinch";
import useCanvas from "./hooks/useCanvas";
import PdfOverlay from "./components/PdfOverlay";
import ThumbnailOvelay from "./components/ThumbnailOvelay";
import { getReducedPdfSize, removeAllPath } from "./libs/utils/common";
import { reportErrorToNative } from "./libs/utils/errorReporter";
import { usePdfTextSearch } from "./hooks/usePdfTextSearch";
import { useWebviewInterface } from "./hooks/useWebviewInterface";
import { useAtom, useAtomValue } from "jotai";
import {
  documentBase64Atom,
  fileAtom,
  pdfConfigAtom,
  pdfStateAtom,
  searchTextAtom,
} from "./store/pdf";
import { List, type ListImperativeAPI } from "react-window";
import Row from "./components/Row";
import { useWindowSize } from "./hooks/useWIndowSIze";
import { useTranslation } from "./hooks/useTranslation";

export default function PdfEngine() {
  const { t } = useTranslation();
  const { width: windowWidth, height: windowHeight } = useWindowSize();
  const canvasRefs = useRef<HTMLCanvasElement[]>([]);
  const scaleRef = useRef<ReactZoomPanPinchContentRef>(null);
  const [currentViewingPage, setCurrentViewingPage] = useState(1);
  const listRef = useRef<ListImperativeAPI>(null);
  const scrollRafRef = useRef<number | null>(null);
  const searchText = useAtomValue(searchTextAtom);
  const file = useAtomValue(fileAtom);
  const documentBase64 = useAtomValue(documentBase64Atom);
  const [pdfState, setPdfState] = useAtom(pdfStateAtom);
  const [pdfConfig, setPdfConfig] = useAtom(pdfConfigAtom);
  const [initialLoading, setInitialLoading] = useState(true);
  const [pdfDocument, setPdfDocument] = useState<PdfDocumentType | null>(null);
  const isInitializedRef = useRef(false);

  const pdfSize = useMemo(() => {
    const reducedSize = getReducedPdfSize(
      pdfConfig.size.width,
      pdfConfig.size.height,
      windowWidth - 128,
      windowHeight - 84,
    );
    return { width: reducedSize.width, height: reducedSize.height };
  }, [pdfConfig.size, windowWidth, windowHeight]);

  const {
    canDraw,
    paths,
    scale,
    drawType,
    color,
    touchType,
    isWrongTouch,
    setIsWrongTouch,
    setCanDraw,
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
    pageSize: { width: pdfSize.width, height: pdfSize.height },
    strokeStep: pdfConfig.strokeStep,
  });

  const pdfFile = useMemo(
    () => `data:application/pdf;base64,${documentBase64}`,
    [documentBase64],
  );
  // 원본 문서가 실제로 담고 있는 페이지 수. 이보다 뒤 번호는 newPage로 덧붙인
  // 빈 페이지이며, 원본을 다시 파싱하지 않기 위해 로컬에서 빈 화면으로 그린다.
  const documentPageCount = pdfDocument?.numPages ?? 0;
  const pdfOptions = useMemo(
    () => ({
      cMapUrl: "/cmaps/",
      standardFontDataUrl: "/standard_fonts/",
    }),
    [],
  );
  const containerHeight = useMemo(
    () => (Math.round(pdfSize.height) + 10) * pdfState.totalPage,
    [pdfSize.height, pdfState.totalPage],
  );
  const listStyle = useMemo(
    () =>
      pdfState.totalPage === 1
        ? {
            height: windowHeight,
            top: Math.max((windowHeight - pdfSize.height) / 2, 0),
          }
        : {},
    [pdfSize.height, pdfState.totalPage, windowHeight],
  );

  const { getSearchResult } = usePdfTextSearch(pdfDocument);
  useWebviewInterface({
    paths,
    getSearchResult,
    scaleRef,
    listRef,
  });

  const setRef = useCallback((node: HTMLCanvasElement) => {
    if (!node) return;
    const indexValue = Number(node.getAttribute("data-index"));
    canvasRefs.current[indexValue] = node;
    // 가상 스크롤로 행이 언마운트되면 참조를 끊는다. 남겨두면 화면 밖 페이지의
    // 2배율 캔버스(수 MB)가 문서를 끝까지 스크롤하는 동안 전부 메모리에 쌓인다.
    return () => {
      if (canvasRefs.current[indexValue] === node) {
        delete canvasRefs.current[indexValue];
      }
    };
  }, []);

  const onRenderSuccess: OnRenderSuccess = useCallback(
    (page) => {
      if (canvasRefs.current) {
        redrawPaths(page.width, page.height, page.pageNumber);
      }
    },
    [redrawPaths],
  );

  // 빈 페이지는 <Page>가 없어 onRenderSuccess가 오지 않으므로, 마운트 시점에
  // 직접 저장된 필기를 복원해 준다.
  const onBlankPageMount = useCallback(
    (pageNumber: number) => {
      redrawPaths(pdfSize.width, pdfSize.height, pageNumber);
    },
    [pdfSize.height, pdfSize.width, redrawPaths],
  );

  const itemData = useMemo(
    () => ({
      pdfSize,
      searchText,
      setRef,
      onPointerDown: startDrawing,
      onPointerMove: draw,
      onPointerUp: stopDrawing,
      canDraw,
      onRenderSuccess,
      documentPageCount,
      onBlankPageMount,
    }),
    [
      canDraw,
      documentPageCount,
      draw,
      onBlankPageMount,
      onRenderSuccess,
      pdfSize,
      searchText,
      setRef,
      startDrawing,
      stopDrawing,
    ],
  );

  const onEraseAllClick = useCallback(() => {
    if (confirm(t("confirm_delete"))) {
      removeAllPath(paths);
      canvasRefs.current.forEach((canvasRef) => {
        canvasRef
          .getContext("2d")!
          .clearRect(0, 0, canvasRef.width, canvasRef.height);
      });
    }
  }, [paths, t]);

  const onZoomStop = useCallback(
    (ref: ReactZoomPanPinchRef) => {
      scale.current = ref.state.scale;
    },
    [scale],
  );

  const onThumbnailClick = useCallback(
    (args: OnItemClickArgs) => {
      setPdfState((prev) => ({
        ...prev,
        isListOpen: false,
      }));
      scaleRef.current?.resetTransform(0);
      listRef.current?.scrollToRow({ index: args.pageIndex, align: "start" });
    },
    [setPdfState],
  );

  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const scrollOffset = e.currentTarget.scrollTop;
      // 스크롤 이벤트마다 rAF를 새로 예약하면 한 프레임에 콜백이 수십 개 쌓인다.
      // 직전 예약을 취소해 프레임당 한 번만 계산한다.
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        const scrollPosition = scrollOffset + 5;
        const scrollRatio = scrollPosition / containerHeight;
        const currentPage = Math.min(
          Math.floor(scrollRatio * pdfState.totalPage) + 1,
          pdfState.totalPage,
        );

        const isNearBottom =
          scrollPosition + windowHeight + 50 >= containerHeight;

        // 값이 같으면 React가 리렌더를 생략하므로 currentViewingPage를 의존성에
        // 넣지 않아도 된다 (넣으면 페이지가 바뀔 때마다 List가 새 핸들러를 받는다).
        setCurrentViewingPage(isNearBottom ? pdfState.totalPage : currentPage);
      });
    },
    [containerHeight, pdfState.totalPage, windowHeight],
  );

  useEffect(
    () => () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    },
    [],
  );

  const onDocumentLoadSuccess = useCallback(
    async (pdf: PdfDocumentType) => {
      setPdfDocument(pdf);

      const page = await pdf.getPage(1);
      const { width, height } = page.getViewport({ scale: 1 });

      setPdfConfig((prev) => ({
        ...prev,
        size: { width: Math.floor(width), height: Math.floor(height) },
      }));
      // 원본 문서가 새로 열릴 때만 실행된다(페이지 추가는 문서를 다시 로드하지
      // 않는다). 따라서 numPages가 곧 시작 페이지 수이며, 이후 newPage가
      // totalPage를 증가시킨다.
      setPdfState((prev) => ({
        ...prev,
        totalPage: pdf.numPages,
      }));
      if (!isInitializedRef.current) {
        isInitializedRef.current = true;
        if (file.paths) {
          const savedPaths: { [pageNumber: number]: PathsType[] } = JSON.parse(
            file.paths,
          );
          paths.current = savedPaths;
        }
        setInitialLoading(false);
      }
    },
    [file.paths, paths, setPdfConfig, setPdfState],
  );

  const onDocumentError = useCallback((error: Error) => {
    // 문서 자체를 못 여는 상황이라 화면에 아무것도 뜨지 않는다. 네이티브가
    // 안내를 띄우거나 파일을 다시 보낼 수 있도록 알린다.
    reportErrorToNative("document", error, { fatal: true });
  }, []);

  return (
    <Document
      file={pdfFile}
      loading={<></>}
      options={pdfOptions}
      onLoadSuccess={onDocumentLoadSuccess}
      onLoadError={onDocumentError}
      onSourceError={onDocumentError}
    >
      {!initialLoading && (
        <div className="bg-[#94A3B8] min-h-dvh flex-center">
          <TransformWrapper
            ref={scaleRef}
            initialScale={1}
            maxScale={3}
            disablePadding
            doubleClick={{ disabled: true }}
            onZoomStop={onZoomStop}
            limitToBounds={true}
            panning={{
              disabled: true,
            }}
            centerZoomedOut
          >
            <TransformComponent>
              <List
                listRef={listRef}
                onScroll={onScroll}
                rowCount={pdfState.totalPage}
                rowHeight={Math.round(pdfSize.height) + 10}
                rowProps={itemData}
                rowComponent={Row}
                className="overflow-auto scrollbar-thin scrollbar-thumb-gray-400 scrollbar-track-gray-300 hover:scrollbar-thumb-gray-500"
                style={{
                  width: windowWidth,
                  height: windowHeight,
                  ...listStyle,
                }}
              />
            </TransformComponent>
          </TransformWrapper>
        </div>
      )}
      <ThumbnailOvelay
        paths={paths.current}
        currentViewingPage={currentViewingPage}
        pdfSize={pdfSize}
        documentPageCount={documentPageCount}
        onThumbnailClick={onThumbnailClick}
      />
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
          isWrongTouch={isWrongTouch}
          setIsWrongTouch={setIsWrongTouch}
        />
      )}
    </Document>
  );
}
