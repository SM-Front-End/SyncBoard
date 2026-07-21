import { RefObject, useCallback, useMemo, useRef, useState } from "react";
import {
  colorMap,
  drawDashedLine,
  drawLine,
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
      const points = paths.current[currentPage];
      if (!points || points.length === 0) return;
      const context = canvasRefs.current[currentPage].getContext("2d")!;
      context.clearRect(
        0,
        0,
        canvasRefs.current[currentPage].width,
        canvasRefs.current[currentPage].height
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
            pageWidth,
            pageHeight
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
          pageWidth,
          pageHeight
        );
      }
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

      // 지우기 모드에서 겹치는 drawOrder를 찾기
      const drawOrdersToDelete = new Set();

      // 모든 erasePath에 대해 반복
      erasePaths.forEach((erasePath) => {
        const eraseX = erasePath.x * pageSize.width;
        const eraseY = erasePath.y * pageSize.height;

        // currentPaths를 반복하여 겹치는 경로를 찾기
        currentPaths.forEach((path) => {
          const distance = Math.hypot(
            path.x * pageSize.width - eraseX,
            path.y * pageSize.height - eraseY
          );
          // 겹치는 경로가 있으면 drawOrder를 추가
          if (distance <= strokeStep) {
            drawOrdersToDelete.add(path.drawOrder);
          }

          // 선이 지나간 경우도 처리
          const pathLength = Math.hypot(
            path.lastX * pageSize.width - path.x * pageSize.width,
            path.lastY * pageSize.height - path.y * pageSize.height
          );

          // 선의 중간 점들에 대해 거리 체크
          for (let i = 0; i <= pathLength; i += 1) {
            const t = i / pathLength;
            const midX =
              (1 - t) * (path.x * pageSize.width) +
              t * (path.lastX * pageSize.width);
            const midY =
              (1 - t) * (path.y * pageSize.height) +
              t * (path.lastY * pageSize.height);
            const midDistance = Math.hypot(midX - eraseX, midY - eraseY);
            if (midDistance <= strokeStep) {
              drawOrdersToDelete.add(path.drawOrder);
              break; // 한 번이라도 겹치면 더 이상 체크할 필요 없음
            }
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
