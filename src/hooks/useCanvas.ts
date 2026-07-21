import { RefObject, useCallback, useMemo, useRef, useState } from "react";
import {
  colorMap,
  distancePointToSegment,
  drawDashedLine,
  drawLine,
  forEachPathGroup,
  getDrawingPosition,
  reDrawPathGroup,
} from "../libs/utils/common";
import {
  canvasEventType,
  DrawType,
  PathsType,
  TouchType,
} from "../libs/types/common";
import throttle from "lodash.throttle";
import { v4 as uuidv4 } from "uuid";

interface Props {
  canvasRefs: RefObject<HTMLCanvasElement[]>;
  devicePixelRatio: number;
  pageSize: {
    width: number;
    height: number;
  };
  strokeStep: number;
}

export default function useCanvas({
  canvasRefs,
  devicePixelRatio,
  pageSize,
  strokeStep,
}: Props) {
  const prevPosRef = useRef({ x: 0, y: 0 });
  const currentPage = useRef(0);
  const scale = useRef(1);
  const isDrawing = useRef(false);
  const touchPoints = useRef(0);
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

  const defaultLineWidth = useMemo(
    () => (strokeStep * (drawType === "highlight" ? 2 : 1)) / pageSize.width,
    [drawType, pageSize.width, strokeStep]
  );

  const startDrawing = useCallback(
    (e: canvasEventType) => {
      currentPage.current = Number((e.target as HTMLElement).dataset.index);
      if (!canvasRefs.current.length) return;
      if (e.pointerType !== touchType) {
        setIsWrongTouch(true);
      }
      if (
        !canDraw ||
        e.pointerType !== touchType ||
        touchPoints.current === 2
      ) {
        return;
      }
      const { x, y } = getDrawingPosition(
        canvasRefs.current[currentPage.current],
        e,
        devicePixelRatio,
        scale.current
      );

      touchPoints.current += 1;
      isDrawing.current = true;
      prevPosRef.current = { x, y };
    },
    [canDraw, canvasRefs, devicePixelRatio, touchType]
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

  const draw = useMemo(
    () =>
      throttle((e: canvasEventType) => {
        if (!canvasRefs.current.length) return;
        if (!isDrawing.current || touchPoints.current === 2) return;
        const context =
          canvasRefs.current[currentPage.current].getContext("2d")!;
        const { x, y } = getDrawingPosition(
          canvasRefs.current[currentPage.current],
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
      defaultLineWidth,
      devicePixelRatio,
      drawType,
      pageSize.height,
      pageSize.width,
      redrawPaths,
    ]
  );

  const stopDrawing = useCallback(async () => {
    if (!canvasRefs.current.length) return;
    const context = canvasRefs.current[currentPage.current].getContext("2d")!;
    if (drawType === "eraser") {
      const currentPaths = paths.current[currentPage.current] || [];
      const erasePaths = erasePathsRef.current;

      // 지우기 경로와 겹치는 획의 drawOrder 수집
      const drawOrdersToDelete = new Set();

      erasePaths.forEach((erasePath) => {
        const eraseX = erasePath.x * pageSize.width;
        const eraseY = erasePath.y * pageSize.height;

        currentPaths.forEach((path) => {
          // 이미 삭제 대상인 획은 다시 계산하지 않음
          if (drawOrdersToDelete.has(path.drawOrder)) return;

          const distance = distancePointToSegment(
            eraseX,
            eraseY,
            path.x * pageSize.width,
            path.y * pageSize.height,
            path.lastX * pageSize.width,
            path.lastY * pageSize.height
          );
          if (distance <= strokeStep) {
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
      context.clearRect(
        0,
        0,
        canvasRefs.current[currentPage.current].width,
        canvasRefs.current[currentPage.current].height
      );
      redrawPaths(pageSize.width, pageSize.height, currentPage.current);
    } else {
      if (touchPoints.current === 1) {
        drawOrder.current = uuidv4();
      }
    }

    isDrawing.current = false;
    erasePathsRef.current = [];
    touchPoints.current = 0;
  }, [
    canvasRefs,
    drawType,
    pageSize.height,
    pageSize.width,
    redrawPaths,
    strokeStep,
  ]);

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
    setTouchType,
  };
}
