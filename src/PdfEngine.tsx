import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document } from "react-pdf";
import {
  OnItemClickArgs,
  OnRenderSuccess,
  PathsType,
  PageSize,
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
import { removeAllPath } from "./libs/utils/common";
import { PageSizes } from "pdf-lib";
import { fitPageSize, getPageAtOffset, getPageOffsets, getPdfPageSizes } from "./libs/utils/pageLayout";
import { reportErrorToNative } from "./libs/utils/errorReporter";
import { usePdfTextSearch } from "./hooks/usePdfTextSearch";
import { useWebviewInterface } from "./hooks/useWebviewInterface";
import { useAtom, useAtomValue, useStore } from "jotai";
import {
  documentSourceAtom,
  documentSessionAtom,
  documentReadyAtom,
  fileAtom,
  pdfConfigAtom,
  pdfStateAtom,
  searchTextAtom,
} from "./store/pdf";
import { List, type ListImperativeAPI } from "react-window";
import Row from "./components/Row";
import { useWindowSize } from "./hooks/useWIndowSIze";
import { useTranslation } from "./hooks/useTranslation";
import { usePdfPan } from "./hooks/usePdfPan";
import Loading from "./components/Loading";

export default function PdfEngine() {
  const { t } = useTranslation();
  const store = useStore();
  const documentSession = useAtomValue(documentSessionAtom);
  const { width: windowWidth, height: windowHeight } = useWindowSize();
  const canvasRefs = useRef<HTMLCanvasElement[]>([]);
  const scaleRef = useRef<ReactZoomPanPinchContentRef>(null);
  const [isZoomed, setIsZoomed] = useState(false);
  const [currentViewingPage, setCurrentViewingPage] = useState(1);
  const listRef = useRef<ListImperativeAPI>(null);
  const viewingPageRafRef = useRef<number | null>(null);
  const searchText = useAtomValue(searchTextAtom);
  const [file, setFile] = useAtom(fileAtom);
  const documentSource = useAtomValue(documentSourceAtom);
  const [pdfState, setPdfState] = useAtom(pdfStateAtom);
  const [pdfConfig, setPdfConfig] = useAtom(pdfConfigAtom);
  const [initialLoading, setInitialLoading] = useState(true);
  const [pdfDocument, setPdfDocument] = useState<PdfDocumentType | null>(null);
  const [originalPageSizes, setOriginalPageSizes] = useState<PageSize[]>([]);
  const isInitializedRef = useRef(false);
  const loadIdRef = useRef(0);

  const pageSizes = useMemo(
    () => Array.from({ length: pdfState.totalPage }, (_, index) => fitPageSize(
      originalPageSizes[index] ?? { width: PageSizes.A4[0], height: PageSizes.A4[1] },
      windowWidth,
      windowHeight,
    )),
    [originalPageSizes, pdfState.totalPage, windowWidth, windowHeight],
  );
  const pageOffsets = useMemo(() => getPageOffsets(pageSizes), [pageSizes]);
  const rowHeight = useCallback((index: number) => pageSizes[index].height + 10, [pageSizes]);

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
    cancelDrawing,
    setTouchType,
  } = useCanvas({
    canvasRefs,
    devicePixelRatio: pdfConfig.devicePixelRatio,
    pageSizes,
    strokeStep: pdfConfig.strokeStep,
  });
  const panHandlers = usePdfPan({
    scaleRef,
    canDraw,
    width: windowWidth,
    height: windowHeight,
  });

  const pdfFile = useMemo(
    () => {
      if (!documentSource) return null;
      return documentSource.kind === "url"
        ? documentSource.url
        : `data:application/pdf;base64,${documentSource.base64}`;
    },
    [documentSource],
  );
  // 원본 문서가 실제로 담고 있는 페이지 수. 이보다 뒤 번호는 newPage로 덧붙인
  // 빈 페이지이며, 원본을 다시 파싱하지 않기 위해 로컬에서 빈 화면으로 그린다.
  const documentPageCount = pdfDocument?.numPages ?? 0;
  const pdfOptions = useMemo(
    () => ({
      cMapUrl: `${import.meta.env.BASE_URL}cmaps/`,
      standardFontDataUrl: `${import.meta.env.BASE_URL}standard_fonts/`,
    }),
    [],
  );
  const listStyle = useMemo(
    () =>
      pdfState.totalPage === 1
        ? {
            height: windowHeight,
            top: Math.max((windowHeight - pageSizes[0].height) / 2, 0),
          }
        : {},
    [pageSizes, pdfState.totalPage, windowHeight],
  );

  const { getSearchResult, prepareSearch } = usePdfTextSearch();
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
      const size = pageSizes[page.pageNumber - 1];
      if (size) redrawPaths(size.width, size.height, page.pageNumber);
    },
    [pageSizes, redrawPaths],
  );

  // 빈 페이지는 <Page>가 없어 onRenderSuccess가 오지 않으므로, 마운트 시점에
  // 직접 저장된 필기를 복원해 준다.
  const onBlankPageMount = useCallback(
    (pageNumber: number) => {
      const size = pageSizes[pageNumber - 1];
      if (size) redrawPaths(size.width, size.height, pageNumber);
    },
    [pageSizes, redrawPaths],
  );

  const itemData = useMemo(
    () => ({
      pageSizes,
      searchText,
      setRef,
      onPointerDown: startDrawing,
      onPointerMove: draw,
      onPointerUp: stopDrawing,
      onPointerCancel: cancelDrawing,
      canDraw,
      onRenderSuccess,
      documentPageCount,
      onBlankPageMount,
    }),
    [
      canDraw,
      cancelDrawing,
      documentPageCount,
      draw,
      onBlankPageMount,
      onRenderSuccess,
      pageSizes,
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

  const updateViewingPage = useCallback(
    (scrollOffset: number, transform = scaleRef.current?.state) => {
      const zoom = transform?.scale ?? 1;
      const top = scrollOffset - (transform?.positionY ?? 0) / zoom;
      const bottom = top + windowHeight / zoom;
      const lastPage = pageOffsets.length - 1;
      setCurrentViewingPage(
        top > 0 && bottom >= pageOffsets[lastPage] - 5 / zoom
          ? lastPage
          : getPageAtOffset(pageOffsets, top + 5 / zoom),
      );
    },
    [pageOffsets, windowHeight],
  );

  useEffect(() => {
    updateViewingPage(listRef.current?.element?.scrollTop ?? 0);
    return () => {
      if (viewingPageRafRef.current !== null) {
        cancelAnimationFrame(viewingPageRafRef.current);
        viewingPageRafRef.current = null;
      }
    };
  }, [updateViewingPage]);

  const scheduleViewingPageUpdate = useCallback(() => {
    if (viewingPageRafRef.current !== null) return;
    // 줌과 스크롤이 같은 프레임에 발생해도 페이지 번호는 한 번만 계산한다.
    // 실행 시점의 위치를 읽어 경계 스크롤과 페이지 이동의 마지막 상태를 반영한다.
    viewingPageRafRef.current = requestAnimationFrame(() => {
      viewingPageRafRef.current = null;
      updateViewingPage(listRef.current?.element?.scrollTop ?? 0);
    });
  }, [updateViewingPage]);

  const onTransform = useCallback(
    (ref: ReactZoomPanPinchRef) => {
      scale.current = ref.state.scale;
      setIsZoomed(ref.state.scale > 1);
      scheduleViewingPageUpdate();
    },
    [scale, scheduleViewingPageUpdate],
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

  useEffect(
    () => () => {
      loadIdRef.current += 1;
    },
    [],
  );

  const onDocumentLoadSuccess = useCallback(
    async (pdf: PdfDocumentType) => {
      if (isInitializedRef.current) return;
      const loadedSource = documentSource;
      const loadId = ++loadIdRef.current;
      const isCurrent = () =>
        loadIdRef.current === loadId &&
        store.get(documentSessionAtom) === documentSession &&
        store.get(documentSourceAtom) === loadedSource;

      try {
        const savedPaths: { [pageNumber: number]: PathsType[] } = file.paths ? JSON.parse(file.paths) : {};
        const [sizes, bytes] = await Promise.all([
          getPdfPageSizes(pdf),
          loadedSource?.kind === "url" ? pdf.getData() : Promise.resolve(null),
          prepareSearch(pdf).catch((error) => {
            if (isCurrent()) reportErrorToNative("text-extract", error);
          }),
        ]);
        if (!isCurrent()) return;
        const { width, height } = sizes[0];

        paths.current = savedPaths;
        setPdfDocument(pdf);
        setOriginalPageSizes(sizes);
        if (bytes) setFile((prev) => ({ ...prev, bytes }));

        // floor하면 종횡비가 react-pdf가 쓰는 실제 viewport와 미세하게 어긋난다.
        // pdfSize 계산이 이 비율에 의존하므로 원본 값을 그대로 보관한다.
        setPdfConfig((prev) => ({
          ...prev,
          size: { width, height },
        }));
        // 원본 문서가 새로 열릴 때만 실행된다(페이지 추가는 문서를 다시 로드하지
        // 않는다). 따라서 numPages가 곧 시작 페이지 수이며, 이후 newPage가
        // totalPage를 증가시킨다.
        setPdfState((prev) => ({
          ...prev,
          totalPage: pdf.numPages,
        }));
        isInitializedRef.current = true;
        store.set(documentReadyAtom, true);
        setInitialLoading(false);
      } catch (error) {
        if (isCurrent()) {
          reportErrorToNative("document", error, { fatal: true });
        }
      }
    },
    [documentSession, documentSource, file.paths, paths, prepareSearch, setFile, setPdfConfig, setPdfState, store],
  );

  const onDocumentError = useCallback((error: Error) => {
    // 문서 자체를 못 여는 상황이라 화면에 아무것도 뜨지 않는다. 네이티브가
    // 안내를 띄우거나 파일을 다시 보낼 수 있도록 알린다.
    reportErrorToNative("document", error, { fatal: true });
  }, []);

  return (
    <Document
      file={pdfFile}
      loading={<Loading />}
      options={pdfOptions}
      onLoadSuccess={onDocumentLoadSuccess}
      onLoadError={onDocumentError}
      onSourceError={onDocumentError}
    >
      {initialLoading ? <Loading /> : (
        <div className="bg-[#94A3B8] min-h-dvh flex-center">
          <TransformWrapper
            ref={scaleRef}
            initialScale={1}
            maxScale={3}
            disablePadding
            autoAlignment={{ animationTime: 0 }}
            doubleClick={{ disabled: true }}
            onTransform={onTransform}
            onPinchStart={() => cancelDrawing()}
            limitToBounds={true}
            panning={{
              // usePdfPan에서 확대 이동과 페이지 스크롤을 함께 처리한다.
              disabled: true,
            }}
            centerZoomedOut
          >
            <TransformComponent contentStyle={{ willChange: "transform" }}>
              <List
                {...panHandlers}
                listRef={listRef}
                onScroll={scheduleViewingPageUpdate}
                rowCount={pdfState.totalPage}
                rowHeight={rowHeight}
                overscanCount={2}
                rowProps={itemData}
                rowComponent={Row}
                className="overflow-auto scrollbar-thin scrollbar-thumb-gray-400 scrollbar-track-gray-300 hover:scrollbar-thumb-gray-500"
                style={{
                  width: windowWidth,
                  height: windowHeight,
                  touchAction: isZoomed && !canDraw ? "none" : "pan-x pan-y",
                  ...listStyle,
                }}
              />
            </TransformComponent>
          </TransformWrapper>
        </div>
      )}
      {!initialLoading && <ThumbnailOvelay
        paths={paths.current}
        currentViewingPage={currentViewingPage}
        pageSizes={pageSizes}
        documentPageCount={documentPageCount}
        onThumbnailClick={onThumbnailClick}
      />}
      {!initialLoading && !pdfState.isListOpen && (
        <PdfOverlay
          paths={paths}
          color={color}
          drawType={drawType}
          canDraw={canDraw}
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
