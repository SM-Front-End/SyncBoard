import clsx from "clsx";
import { Close } from "../assets/icons";
import { Thumbnail } from "react-pdf";
import { useAtom } from "jotai";
import { pdfStateAtom } from "../store/pdf";
import { OnItemClickArgs, PathsType } from "../libs/types/common";
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefCallback,
} from "react";
import {
  DRAWING_DPR,
  forEachPathGroup,
  reDrawPathGroup,
} from "../libs/utils/common";
import PlaceholderPage from "./PlaceholderPage";

// 스크롤로 currentViewingPage가 바뀔 때 전체 썸네일 그리드가 리렌더되지 않도록
// 아이템을 분리해 memo한다. 실제로 바뀌는 건 이전/현재 두 개뿐이다.
const ThumbnailItem = memo(
  ({
    pageNumber,
    totalPage,
    thumbnailHeight,
    isActive,
    isBlankPage,
    setRef,
    onThumbnailClick,
  }: {
    pageNumber: number;
    totalPage: number;
    thumbnailHeight: number;
    isActive: boolean;
    isBlankPage: boolean;
    setRef: RefCallback<HTMLCanvasElement>;
    onThumbnailClick: (args: OnItemClickArgs) => void;
  }) => (
    <div className="w-[180px]">
      <div
        className={clsx("bg-white", isActive ? "ring-[3px] ring-[#FF9A51]" : "")}
        style={{ height: thumbnailHeight }}
        // 빈 페이지에는 Thumbnail이 없으므로 컨테이너가 클릭을 받는다
        onClick={
          isBlankPage
            ? () => onThumbnailClick({ pageIndex: pageNumber - 1 } as OnItemClickArgs)
            : undefined
        }
      >
        {/* newPage로 덧붙인 페이지는 원본 문서에 없으므로 흰 배경만 보여준다 */}
        {!isBlankPage && (
          <Thumbnail
            pageNumber={pageNumber}
            width={180}
            devicePixelRatio={DRAWING_DPR}
            onItemClick={onThumbnailClick}
            loading={
              <div style={{ width: 180, height: thumbnailHeight }}>
                <PlaceholderPage />
              </div>
            }
            className="absolute"
          />
        )}
        <canvas
          ref={setRef}
          style={{ width: 180, height: thumbnailHeight }}
          className="absolute pointer-events-none"
          data-index={pageNumber}
        />
      </div>
      <div className="h-[31px] flex justify-center items-center">
        <span
          className={
            isActive ? "text-[#FF9A51] font-bold text-lg" : "text-white"
          }
        >
          {pageNumber}/{totalPage}
        </span>
      </div>
    </div>
  )
);

const ThumbnailOvelay = ({
  paths,
  currentViewingPage,
  pageSizes,
  documentPageCount,
  onThumbnailClick,
}: {
  paths: {
    [pageNumber: number]: PathsType[];
  };
  currentViewingPage: number;
  pageSizes: {
    width: number;
    height: number;
  }[];
  documentPageCount: number;
  onThumbnailClick: (args: OnItemClickArgs) => void;
}) => {
  const thumbnailCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const [hasOpened, setHasOpened] = useState(false);
  const [pdfState, setPdfState] = useAtom(pdfStateAtom);

  const redrawPaths = useCallback(
    (pageNumber: number, canvas = thumbnailCanvasRefs.current[pageNumber]) => {
      const pageSize = pageSizes[pageNumber - 1];
      if (!canvas || !pageSize || pageSize.width <= 0) return;
      const thumbnailHeight = (pageSize.height / pageSize.width) * 180;

      // 전체 삭제 후 잔상이 남지 않도록, 필기가 없어도 항상 캔버스를 초기화
      canvas.width = 180 * DRAWING_DPR;
      canvas.height = Math.round(thumbnailHeight * DRAWING_DPR);

      const points = paths[pageNumber];
      if (!points || points.length === 0) return;
      const context = canvas.getContext("2d")!;

      forEachPathGroup(points, (group, style) => {
        context.beginPath();
        reDrawPathGroup(context, group, style, 180, thumbnailHeight);
      });
    },
    [pageSizes, paths]
  );

  const setRef = useCallback<RefCallback<HTMLCanvasElement>>(
    (node) => {
      if (!node) return;
      const pageNumber = Number(node.dataset.index);
      thumbnailCanvasRefs.current[pageNumber] = node;
      // 첫 열기에도 캔버스가 연결된 시점에 복원한다. 페이지 크기 변경 시에도 재연결된다.
      redrawPaths(pageNumber, node);
      return () => {
        if (thumbnailCanvasRefs.current[pageNumber] === node) {
          thumbnailCanvasRefs.current[pageNumber] = null;
        }
      };
    },
    [redrawPaths],
  );

  // 목록이 열릴 때만 필기를 다시 그린다. currentViewingPage는 스크롤 중 계속
  // 바뀌므로 의존성에 넣으면 열려 있는 동안 전 페이지 썸네일을 반복해서 다시 그린다.
  useEffect(() => {
    if (!pdfState.isListOpen) return;
    setHasOpened(true);
    thumbnailCanvasRefs.current.forEach((canvas, pageNumber) => {
      if (canvas) redrawPaths(pageNumber, canvas);
    });
  }, [pdfState.isListOpen, redrawPaths]);

  return (
    (pdfState.isListOpen || hasOpened) && (
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
            {pageSizes.map((pageSize, index) => (
              <ThumbnailItem
                key={index}
                pageNumber={index + 1}
                totalPage={pdfState.totalPage}
                thumbnailHeight={(pageSize.height / pageSize.width) * 180}
                isActive={currentViewingPage === index + 1}
                isBlankPage={
                  documentPageCount > 0 && index + 1 > documentPageCount
                }
                setRef={setRef}
                onThumbnailClick={onThumbnailClick}
              />
            ))}
          </div>
        </div>
      </div>
    )
  );
};

export default ThumbnailOvelay;
