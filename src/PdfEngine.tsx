import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page } from "react-pdf";
import { useResizeDetector } from "react-resize-detector";
import { useMobileOrientation, isMobile } from "react-device-detect";
import {
  CustomTextRenderer,
  OnRenderSuccess,
} from "react-pdf/src/shared/types.js";
import {
  ReactZoomPanPinchContentRef,
  TransformComponent,
  TransformWrapper,
} from "react-zoom-pan-pinch";
import { base64 } from "./base64";
import useCanvas from "./hooks/useCanvas";
import PdfOverlay from "./components/PdfOverlay";
import ThumbnailOvelay from "./components/ThumbnailOvelay";
import { getModifiedPDFBase64, highlightPattern } from "./utils";
// import { usePdfTextSearch } from "./hooks/usePdfTextSearch ";

interface window {
  webviewApi: (data: string) => void;
  getBase64: () => void;
  AndroidInterface: {
    getBase64: (data: string) => void;
    setFullMode: (data: boolean) => void;
  };
}

export default function PdfEngine() {
  const { orientation } = useMobileOrientation();
  const { width, height, ref } = useResizeDetector();
  const scaleRef = useRef<ReactZoomPanPinchContentRef>(null);
  const [isToolBarOpen, setIsToolBarOpen] = useState(false);
  const [pageNumber, setPageNumber] = useState(1);
  const [renderedPageNumber, setRenderedPageNumber] = useState<number>(0);
  const [file, setFile] = useState(
    import.meta.env.MODE === "development" ? base64 : ""
  );
  const [pageSize, setPageSize] = useState({
    width: 0,
    height: 0,
  });
  const [isListOpen, setIsListOpen] = useState(false);
  const [totalPage, setTotalPage] = useState(0);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [strokeStep, setStrokeStep] = useState(12);
  const [devicePixelRatio] = useState(2);
  const [isStrokeOpen, setIsStrokeOpen] = useState(false);
  const [searchText] = useState("");
  // const { resultsList } = usePdfTextSearch(file, searchText);
  // console.log(resultsList.map((result) => result.pageNumber));
  const isLoading = useMemo(
    () => renderedPageNumber !== pageNumber,
    [pageNumber, renderedPageNumber]
  );

  const {
    canvas,
    canDraw,
    setCanDraw,
    paths,
    scale,
    isRendering,
    drawType,
    color,
    setColor,
    setDrawType,
    setIsRendering,
    startDrawing,
    draw,
    redrawPaths,
    stopDrawing,
  } = useCanvas({
    devicePixelRatio,
    pageSize,
    strokeStep,
    pageNumber,
  });

  const onRenderSuccess: OnRenderSuccess = useCallback(
    (page) => {
      setRenderedPageNumber(pageNumber);
      setIsRendering(true);
      setPageSize({
        width: page.width,
        height: page.height,
      });
    },
    [pageNumber, setIsRendering]
  );

  useEffect(() => {
    if (isRendering) {
      redrawPaths(pageSize.width, pageSize.height);
    }
  }, [isRendering, pageSize, redrawPaths]);

  useEffect(() => {
    if (!isMobile || import.meta.env.MODE === "development") {
      setFile(base64);
    }
  }, []);

  useEffect(() => {
    if (isMobile) {
      (window as unknown as window).webviewApi = (data: string) => {
        const param = JSON.parse(data);
        setFile(param?.data?.base64);
      };
      (window as unknown as window).getBase64 = async () => {
        const data = await getModifiedPDFBase64(paths.current, file);
        (window as unknown as window).AndroidInterface.getBase64(data);
      };
    }
  }, [file, paths]);

  // useEffect(() => {
  //   const getData = async () => {
  //     const d = await loadPDFAnnotations(annotBase64);
  //     // console.log(d);
  //   };
  //   getData();
  // });

  const textRenderer: CustomTextRenderer = useCallback(
    (textItem) => highlightPattern(textItem.str, searchText),
    [searchText]
  );

  return (
    <>
      <div className="w-dvw h-dvh bg-gray-400 flex-center">
        {file && (
          <Document
            file={`data:application/pdf;base64,${file}`}
            onLoadSuccess={(pdf) => {
              setTotalPage(pdf.numPages);
            }}
            loading={<></>}
          >
            <TransformWrapper
              ref={scaleRef}
              disabled={canDraw}
              initialScale={1}
              maxScale={3}
              minScale={1}
              disablePadding
              onPinchingStop={(ref) => {
                scale.current = ref.state.scale;
                // 1 ~3
                // 1일때 0 3일때 1
                // setDevicePixelRatio(2 + ref.state.scale * 0.33);
              }}
            >
              <TransformComponent>
                <div
                  ref={ref}
                  className="w-dvw h-dvh flex-center"
                  style={{
                    paddingLeft: isFullScreen ? 0 : 100,
                    paddingRight: isFullScreen ? 0 : 100,
                    paddingTop: isFullScreen ? 0 : 40,
                    paddingBottom: isFullScreen ? 0 : 40,
                  }}
                >
                  <>
                    {isLoading && (
                      <Page
                        key={renderedPageNumber}
                        pageNumber={renderedPageNumber}
                        width={orientation === "portrait" ? width : undefined}
                        height={height}
                        devicePixelRatio={devicePixelRatio}
                        loading={<></>}
                        noData={<></>}
                      />
                    )}
                    <Page
                      key={pageNumber}
                      className={isLoading ? "hidden" : ""}
                      pageNumber={pageNumber}
                      width={orientation === "portrait" ? width : undefined}
                      height={height}
                      devicePixelRatio={devicePixelRatio}
                      onRenderSuccess={onRenderSuccess}
                      loading={<></>}
                      noData={<></>}
                      customTextRenderer={textRenderer}
                    />
                    <div className="absolute top-0 left-0 right-0 bottom-0 flex-center">
                      <canvas
                        ref={canvas}
                        key={pageNumber}
                        width={pageSize.width * devicePixelRatio}
                        height={pageSize.height * devicePixelRatio}
                        style={{
                          width: `${pageSize.width}px`,
                          height: `${pageSize.height}px`,
                          pointerEvents: canDraw ? "auto" : "none",
                          zIndex: 1000,
                        }}
                        onTouchStart={startDrawing}
                        onTouchMove={draw}
                        onTouchCancel={stopDrawing}
                        onTouchEnd={stopDrawing}
                      />
                    </div>
                  </>
                </div>
              </TransformComponent>
            </TransformWrapper>
            {isListOpen && (
              <ThumbnailOvelay
                pageNumber={pageNumber}
                scaleRef={scaleRef}
                setIsListOpen={setIsListOpen}
                setPageNumber={setPageNumber}
                totalPage={totalPage}
              />
            )}
          </Document>
        )}
      </div>
      {!isListOpen && (
        <PdfOverlay
          color={color}
          drawType={drawType}
          file={file}
          isFullScreen={isFullScreen}
          isStrokeOpen={isStrokeOpen}
          isToolBarOpen={isToolBarOpen}
          pageNumber={pageNumber}
          paths={paths.current}
          strokeStep={strokeStep}
          totalPage={totalPage}
          scaleRef={scaleRef}
          setCanDraw={setCanDraw}
          setColor={setColor}
          setDrawType={setDrawType}
          setIsFullScreen={setIsFullScreen}
          setIsListOpen={setIsListOpen}
          setIsStrokeOpen={setIsStrokeOpen}
          setIsToolBarOpen={setIsToolBarOpen}
          setPageNumber={setPageNumber}
          setStrokeStep={setStrokeStep}
        />
      )}
    </>
  );
}
