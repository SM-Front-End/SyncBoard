import {
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  colorMap,
  drawDashedLine,
  drawLine,
  forEachPathGroup,
  getDrawingPosition,
  reDrawPathGroup,
} from "../libs/utils/common";
import {
  canvasEventType,
  DrawType,
  PageSize,
  PathsType,
  TouchType,
} from "../libs/types/common";
import throttle from "lodash.throttle";
import { v4 as uuidv4 } from "uuid";
import { distanceSegmentToSegment } from "../libs/utils/drawingGeometry";

interface Props {
  canvasRefs: RefObject<HTMLCanvasElement[]>;
  devicePixelRatio: number;
  pageSizes: PageSize[];
  strokeStep: number;
}

export default function useCanvas({
  canvasRefs,
  devicePixelRatio,
  pageSizes,
  strokeStep,
}: Props) {
  const prevPosRef = useRef({ x: 0, y: 0 });
  const currentPage = useRef(0);
  const scale = useRef(1);
  const activePointer = useRef<{
    id: number;
    type: string;
    canvas: HTMLCanvasElement;
    pageSize: PageSize;
  } | null>(null);
  const erasePathsRef = useRef<PathsType[]>([]);
  const paths = useRef<{ [pageNumber: number]: PathsType[] }>({});
  const drawOrder = useRef(uuidv4());
  const [canDraw, setCanDraw] = useState(false);
  const [color, setColor] = useState<(typeof colorMap)[number]>("#F34A47");
  const [touchType, setTouchType] = useState<TouchType>(
    (localStorage.getItem("TOUCH_TYPE") as TouchType) ?? "pen"
  );
  const [drawType, setDrawType] = useState<DrawType>("pen");
  const [isWrongTouch, setIsWrongTouch] = useState(false);

  const defaultDrawStyle = useMemo(
    () => ({
      alpha: drawType === "highlight" ? 0.4 : 1,
      color,
      lineWidth: strokeStep * (drawType === "highlight" ? 2 : 1),
    }),
    [color, drawType, strokeStep]
  );

  const startDrawing = useCallback(
    (e: canvasEventType) => {
      if (!canDraw || activePointer.current) return;
      if (e.pointerType !== touchType) {
        setIsWrongTouch(true);
        return;
      }

      const canvas = e.currentTarget;
      const pageNumber = Number(canvas.dataset.index);
      if (canvasRefs.current[pageNumber] !== canvas) return;
      const pageSize = pageSizes[pageNumber - 1];
      if (!pageSize || pageSize.width <= 0 || pageSize.height <= 0) return;
      const { x, y } = getDrawingPosition(
        canvas,
        e,
        devicePixelRatio,
        scale.current
      );

      // 획을 시작한 포인터와 페이지를 고정한다. 손바닥 입력이 들어와도 바꾸지 않는다.
      currentPage.current = pageNumber;
      activePointer.current = {
        id: e.pointerId,
        type: e.pointerType,
        canvas,
        pageSize: { ...pageSize },
      };
      drawOrder.current = uuidv4();
      prevPosRef.current = { x, y };
      canvas.setPointerCapture(e.pointerId);
    },
    [canDraw, canvasRefs, devicePixelRatio, pageSizes, touchType]
  );

  const redrawPaths = useCallback(
    (pageWidth: number, pageHeight: number, currentPage: number) => {
      if (!canvasRefs.current.length) return;
      const canvas = canvasRefs.current[currentPage];
      const points = paths.current[currentPage];
      if (!canvas || !points || points.length === 0) return;
      const context = canvas.getContext("2d")!;
      context.clearRect(0, 0, canvas.width, canvas.height);

      forEachPathGroup(points, (group, style) => {
        context.beginPath();
        reDrawPathGroup(context, group, style, pageWidth, pageHeight);
      });
    },
    [canvasRefs]
  );

  const isActivePointer = useCallback((e: canvasEventType) => {
    const pointer = activePointer.current;
    return (
      pointer !== null &&
      pointer.id === e.pointerId &&
      pointer.type === e.pointerType &&
      pointer.canvas === e.target
    );
  }, []);

  const throttledDraw = useMemo(
    () =>
      throttle((e: canvasEventType) => {
        if (!isActivePointer(e)) return;
        // 스로틀 지연 사이에 해당 행이 언마운트되면 참조가 사라질 수 있다
        const canvas = canvasRefs.current[currentPage.current];
        const pointer = activePointer.current;
        if (!canvas || !pointer || canvas !== pointer.canvas) return;
        const pageSize = pointer.pageSize;
        const defaultLineWidth = defaultDrawStyle.lineWidth / pageSize.width;
        const context = canvas.getContext("2d")!;
        const { x, y } = getDrawingPosition(
          canvas,
          e,
          devicePixelRatio,
          scale.current
        );

        if (drawType === "eraser") {
          drawDashedLine(
            context,
            prevPosRef.current.x,
            prevPosRef.current.y,
            x,
            y
          );
          erasePathsRef.current.push({
            x: x / pageSize.width,
            y: y / pageSize.height,
            lastX: prevPosRef.current.x / pageSize.width,
            lastY: prevPosRef.current.y / pageSize.height,
            lineWidth: defaultLineWidth,
            color,
            drawOrder: drawOrder.current,
            alpha: 1,
          });
        } else {
          const pagePaths = (paths.current[currentPage.current] ??= []);
          pagePaths.push({
            x: x / pageSize.width,
            y: y / pageSize.height,
            lastX: prevPosRef.current.x / pageSize.width,
            lastY: prevPosRef.current.y / pageSize.height,
            lineWidth: defaultLineWidth,
            color: defaultDrawStyle.color,
            drawOrder: drawOrder.current,
            alpha: drawType === "highlight" ? 0.4 : 1,
          });
          if (drawType === "highlight") {
            // 형광펜은 겹침 부분 농도가 균일해야 하므로 전체 재그리기
            redrawPaths(pageSize.width, pageSize.height, currentPage.current);
          } else {
            drawLine(
              context,
              prevPosRef.current.x,
              prevPosRef.current.y,
              x,
              y,
              {
                color: defaultDrawStyle.color,
                lineWidth: defaultLineWidth * pageSize.width,
                alpha: 1,
              }
            );
          }
        }

        prevPosRef.current = { x, y };
      }, 8),
    [
      canvasRefs,
      color,
      defaultDrawStyle.color,
      defaultDrawStyle.lineWidth,
      devicePixelRatio,
      drawType,
      isActivePointer,
      redrawPaths,
    ]
  );

  const draw = useCallback(
    (e: canvasEventType) => {
      // 손가락 이벤트가 대기 중인 펜 이벤트를 스로틀 내부에서 덮어쓰지 못하게 한다.
      if (isActivePointer(e)) throttledDraw(e);
    },
    [isActivePointer, throttledDraw],
  );

  const finishDrawing = useCallback((flushPending: boolean) => {
    const pointer = activePointer.current;
    if (!pointer) return;
    if (flushPending) throttledDraw.flush();
    throttledDraw.cancel();
    activePointer.current = null;

    const canvas = pointer.canvas;
    const pageSize = pointer.pageSize;
    const context = canvas.getContext("2d")!;
    if (drawType === "eraser") {
      const currentPaths = paths.current[currentPage.current] || [];
      const erasePaths = erasePathsRef.current;

      // 지우기 경로와 겹치는 획의 drawOrder 수집
      const drawOrdersToDelete = new Set<string>();

      erasePaths.forEach((erasePath) => {
        currentPaths.forEach((path) => {
          // 이미 삭제 대상인 획은 다시 계산하지 않음
          if (drawOrdersToDelete.has(path.drawOrder)) return;

          const distance = distanceSegmentToSegment(
            erasePath.lastX * pageSize.width,
            erasePath.lastY * pageSize.height,
            erasePath.x * pageSize.width,
            erasePath.y * pageSize.height,
            path.x * pageSize.width,
            path.y * pageSize.height,
            path.lastX * pageSize.width,
            path.lastY * pageSize.height
          );
          const inkRadius = (path.lineWidth * pageSize.width) / 2;
          if (distance <= strokeStep + inkRadius) {
            drawOrdersToDelete.add(path.drawOrder);
          }
        });
      });

      // drawOrder가 포함되지 않은 경로만 남기기
      const newPaths = currentPaths.filter((path) => {
        return !drawOrdersToDelete.has(path.drawOrder);
      });

      // paths 업데이트
      paths.current = {
        ...paths.current,
        [currentPage.current]: newPaths,
      };

      // 점선도 지우기
      context.clearRect(0, 0, canvas.width, canvas.height);
      redrawPaths(pageSize.width, pageSize.height, currentPage.current);
    }

    erasePathsRef.current = [];
    if (canvas.hasPointerCapture(pointer.id)) {
      canvas.releasePointerCapture(pointer.id);
    }
  }, [
    drawType,
    redrawPaths,
    strokeStep,
    throttledDraw,
  ]);

  const stopDrawing = useCallback(
    (e: canvasEventType) => {
      if (isActivePointer(e)) finishDrawing(true);
    },
    [finishDrawing, isActivePointer],
  );

  const cancelDrawing = useCallback(
    (e?: canvasEventType) => {
      if (!e || isActivePointer(e)) finishDrawing(false);
    },
    [finishDrawing, isActivePointer],
  );

  useEffect(() => {
    const onBlur = () => finishDrawing(false);
    window.addEventListener("blur", onBlur);
    // 크기/도구/입력 모드가 바뀌거나 뷰어가 내려가면 이전 획과 지연 이벤트를
    // 정리한다. 진행 중이던 획은 시작할 때 캡처한 페이지 크기로 마무리한다.
    return () => {
      window.removeEventListener("blur", onBlur);
      finishDrawing(false);
    };
  }, [canDraw, finishDrawing, pageSizes, touchType]);

  return {
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
  };
}
