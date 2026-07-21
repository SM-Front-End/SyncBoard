import clsx from "clsx";
import { Close } from "../assets/icons";
import { Thumbnail } from "react-pdf";
import { useAtom } from "jotai";
import { pdfStateAtom } from "../store/pdf";
import { OnItemClickArgs, PathsType } from "../libs/types/common";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { forEachPathGroup, reDrawPathGroup } from "../libs/utils/common";
import PlaceholderPage from "./PlaceholderPage";

const ThumbnailOvelay = ({
  paths,
  currentViewingPage,
  pdfSize,
  onThumbnailClick,
}: {
  paths: {
    [pageNumber: number]: PathsType[];
  };
  currentViewingPage: number;
  pdfSize: {
    width: number;
    height: number;
  };
  onThumbnailClick: (args: OnItemClickArgs) => void;
}) => {
  const thumbnailCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const [isOpenFirst, setIsOpenFirst] = useState(true);
  const [pdfState, setPdfState] = useAtom(pdfStateAtom);
  const thumbnailHeight = useMemo(
    () => (pdfSize.height / pdfSize.width) * 180,
    [pdfSize]
  );

  const setRef = useCallback((node: HTMLCanvasElement) => {
    if (node) {
      const indexValue = Number(node.getAttribute("data-index"));
      thumbnailCanvasRefs.current[indexValue] = node;
    }
  }, []);

  const redrawPaths = useCallback(
    (pageNumber: number) => {
      const canvas = thumbnailCanvasRefs.current[pageNumber];
      if (!canvas) return;

      // 전체 삭제 후 잔상이 남지 않도록, 필기가 없어도 항상 캔버스를 초기화
      canvas.width = 180 * 2;
      canvas.height = thumbnailHeight * 2;

      const points = paths[pageNumber];
      if (!points || points.length <= 1) return;
      const context = canvas.getContext("2d")!;

      forEachPathGroup(points, (group, style) => {
        context.beginPath();
        reDrawPathGroup(context, group, style, 180, thumbnailHeight);
      });
    },
    [thumbnailHeight, paths]
  );

  useEffect(() => {
    if (pdfState.isListOpen) {
      if (isOpenFirst) {
        setIsOpenFirst(false);
      }
      Object.keys(paths)
        .map(Number)
        .forEach((pageNumber) => {
          redrawPaths(pageNumber);
        });
    }
  }, [
    currentViewingPage,
    isOpenFirst,
    paths,
    pdfState.isListOpen,
    redrawPaths,
  ]);

  return (
    !isOpenFirst && (
      <div
        className={clsx(
          "fixed top-0 left-0 bottom-0 right-0 pb-[100px] bg-black/70 z-[9999]",
          pdfState.isListOpen ? "" : "hidden"
        )}
      >
        <div className="fixed top-0 left-0 right-0 px-[20px] pt-[20px] z-10">
          <div className="flex justify-end items-center">
            <button
              onClick={() => {
                setPdfState((prev) => ({
                  ...prev,
                  isListOpen: false,
                }));
              }}
              className="bg-white size-[40px] flex-center rounded-lg"
            >
              <Close />
            </button>
          </div>
        </div>

        <div className="h-full pl-[20px] mt-[88px] overflow-y-auto">
          <div
            className="grid mt-[20px] gap-y-5 relative"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            }}
          >
            {[...new Array(pdfState.totalPage)].map((_, index) => {
              return (
                <div key={index} className="w-[180px]">
                  <div
                    className={clsx(
                      "bg-white",
                      currentViewingPage === index + 1
                        ? "ring-[3px] ring-[#FF9A51]"
                        : ""
                    )}
                    style={{ height: thumbnailHeight }}
                  >
                    <Thumbnail
                      pageNumber={index + 1}
                      width={180}
                      devicePixelRatio={2}
                      onItemClick={onThumbnailClick}
                      loading={
                        <div style={{ width: 180, height: thumbnailHeight }}>
                          <PlaceholderPage />
                        </div>
                      }
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
      </div>
    )
  );
};

export default ThumbnailOvelay;
