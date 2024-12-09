import clsx from "clsx";
import { Close } from "../assets/icons";
import { Thumbnail } from "react-pdf";
import { useAtom } from "jotai";
import { pdfStateAtom } from "../store/pdf";
import { PathsType } from "../types/common";
import {
  MutableRefObject,
  RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { reDrawPathGroup } from "../utils/common";
import {
  OnItemClickArgs,
  OnPageLoadSuccess,
} from "react-pdf/src/shared/types.js";
import { ReactZoomPanPinchContentRef } from "react-zoom-pan-pinch";

const ThumbnailOvelay = ({
  paths,
  canvasRefs,
  currentViewingPage,
  scaleRef,
}: {
  paths: {
    [pageNumber: number]: PathsType[];
  };
  canvasRefs: MutableRefObject<HTMLCanvasElement[]>;
  currentViewingPage: number;
  scaleRef: RefObject<ReactZoomPanPinchContentRef>;
}) => {
  const thumbnailCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const [thumbnailHeight, setThumbnailHeight] = useState(0);
  const [pdfState, setPdfState] = useAtom(pdfStateAtom);

  const setRef = useCallback((node: HTMLCanvasElement) => {
    if (node) {
      const indexValue = Number(node.getAttribute("data-index"));
      thumbnailCanvasRefs.current[indexValue] = node;
    }
  }, []);

  const onLoadSuccess: OnPageLoadSuccess = useCallback(
    (page) => {
      if (!thumbnailHeight) {
        setThumbnailHeight(page.height);
      }
    },
    [thumbnailHeight]
  );

  const onItemClick = useCallback(
    (args: OnItemClickArgs) => {
      setPdfState((prev) => ({
        ...prev,
        // pageNumber: args.pageNumber,
        isListOpen: false,
      }));
      scaleRef.current?.resetTransform(0);
      canvasRefs.current[args.pageNumber].scrollIntoView();
    },
    [canvasRefs, scaleRef, setPdfState]
  );

  const redrawPaths = useCallback(
    (pageNumber: number) => {
      if (!thumbnailCanvasRefs.current[pageNumber] || !paths[pageNumber])
        return;
      thumbnailCanvasRefs.current[pageNumber].width = 180 * 2;
      thumbnailCanvasRefs.current[pageNumber].height = thumbnailHeight * 2;
      const points = paths[pageNumber];
      if (!points || points.length === 0) return;
      const context = thumbnailCanvasRefs.current[pageNumber].getContext("2d")!;
      context.clearRect(
        0,
        0,
        thumbnailCanvasRefs.current[pageNumber].width,
        thumbnailCanvasRefs.current[pageNumber].height
      );
      let currentGroup: PathsType[] = [];

      if (points.length === 1) return;

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

        // 선이 띄워진 경우
        if (currentGroup.length) {
          context.beginPath();

          // 현재 그룹이 2개 이상의 점을 포함하면 선 그리기
          reDrawPathGroup(
            context,
            currentGroup,
            currentStyle,
            180,
            thumbnailHeight
          );
        }

        // 단일 점 처리
        currentGroup = [points[i]]; // 새로운 그룹 초기화
        currentStyle = {
          color: points[i].color,
          lineWidth: points[i].lineWidth,
          alpha: points[i].alpha,
        };
      }
      // 마지막 그룹 처리
      if (currentGroup.length) {
        context.beginPath();

        reDrawPathGroup(
          context,
          currentGroup,
          currentStyle,
          180,
          thumbnailHeight
        );
      }
    },
    [thumbnailHeight, paths]
  );
  useEffect(() => {
    if (pdfState.isListOpen) {
      Object.keys(paths)
        .map(Number)
        .forEach((pageNumber) => {
          redrawPaths(pageNumber);
        });
    }
  }, [paths, pdfState.isListOpen, redrawPaths]);

  return (
    <div
      className={clsx(
        "fixed top-0 left-0 bottom-0 right-0 overflow-auto bg-black/70 px-[20px] pt-[24px] z-[9999] touch-none",
        pdfState.isListOpen ? "" : "hidden"
      )}
    >
      <div className="flex justify-end items-center">
        <button
          onClick={() => {
            setPdfState((prev) => ({
              ...prev,
              isListOpen: false,
            }));
          }}
          className="bg-white size-[44px] flex-center rounded-xl"
        >
          <Close />
        </button>
      </div>
      <div
        className="grid mt-[20px] gap-y-5"
        style={{
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
        }}
      >
        {[...new Array(pdfState.totalPage)].map((_, index) => {
          return (
            <div key={index} className="w-[186px]">
              <div
                className={clsx(
                  currentViewingPage === index + 1
                    ? "border-[3px] border-[#FF9A51]"
                    : "",
                  "overflow-hidden relative"
                )}
                style={{ height: thumbnailHeight }}
              >
                <Thumbnail
                  pageNumber={index + 1}
                  width={180}
                  devicePixelRatio={2}
                  onItemClick={onItemClick}
                  onLoadSuccess={onLoadSuccess}
                  loading={<></>}
                  className="absolute"
                />
                <canvas
                  ref={setRef}
                  style={{
                    width: 180,
                    height: thumbnailHeight,
                  }}
                  className="absolute pointer-events-none"
                  data-index={index + 1}
                />
              </div>
              <div className="h-[31px] flex justify-center items-center">
                <span
                  className={
                    currentViewingPage === index + 1
                      ? "text-[#FF9A51] font-bold text-lg"
                      : "text-white"
                  }
                >
                  {index + 1}/{pdfState.totalPage}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ThumbnailOvelay;
