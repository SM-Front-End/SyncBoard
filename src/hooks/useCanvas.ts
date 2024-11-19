import { useCallback, useMemo, useRef, useState } from "react";
import {
  colorMap,
  drawDashedLine,
  reDrawSinglePoint,
  drawLine,
  getDrawingPosition,
  reDrawPathGroup,
} from "../utils/common";
import {
  canvasEventType,
  DrawType,
  PathsType,
  TouchType,
} from "../types/common";

interface Props {
  devicePixelRatio: number;
  pageSize: {
    width: number;
    height: number;
  };
  strokeStep: number;
  pageNumber: number;
}

export default function useCanvas({
  devicePixelRatio,
  pageSize,
  strokeStep,
  pageNumber,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const prevPosRef = useRef({ x: 0, y: 0 });
  const scale = useRef(1);
  const isDrawing = useRef(false);
  const touchPoints = useRef(0);
  const tempPathsRef = useRef<PathsType[]>([]);
  const paths = useRef<{ [pageNumber: number]: PathsType[] }>({});
  const drawOrder = useRef(0);
  const [canDraw, setCanDraw] = useState(false);
  const [color, setColor] = useState<(typeof colorMap)[number]>("#F34A47");
  const [touchType, setTouchType] = useState<TouchType>("pen");
  const [drawType, setDrawType] = useState<DrawType>("pen");
  const [zoomEnabled, setZoomEnabled] = useState(false);

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
      if (!canvas.current) return;
      if (
        !canDraw ||
        e.pointerType !== touchType ||
        touchPoints.current === 2
      ) {
        return;
      }

      const lineWidth = defaultLineWidth;
      const { x, y } = getDrawingPosition(
        canvas,
        e,
        devicePixelRatio,
        scale.current
      );

      tempPathsRef.current.push({
        x: x / pageSize.width,
        y: y / pageSize.height,
        lastX: x / pageSize.width,
        lastY: y / pageSize.height,
        lineWidth,
        color,
        drawOrder: drawOrder.current,
        alpha: drawType === "highlight" ? 0.4 : 1,
      });

      touchPoints.current += 1;
      isDrawing.current = true;
      prevPosRef.current = { x, y };
    },
    [
      canDraw,
      color,
      defaultLineWidth,
      devicePixelRatio,
      drawType,
      pageSize.height,
      pageSize.width,
      touchType,
    ]
  );

  const draw = useCallback(
    (e: canvasEventType) => {
      if (!canvas.current) return;
      if (!isDrawing.current || touchPoints.current === 2) return;
      const context = canvas.current.getContext("2d")!;
      const { x, y } = getDrawingPosition(
        canvas,
        e,
        devicePixelRatio,
        scale.current
      );

      const distance = Math.hypot(
        x - prevPosRef.current.x,
        y - prevPosRef.current.y
      );
      const DISTANCE_THRESHOLD = 20;
      const lineWidth = defaultLineWidth;

      if (distance >= DISTANCE_THRESHOLD) {
        if (drawType === "eraser") {
          drawDashedLine(
            context,
            prevPosRef.current.x,
            prevPosRef.current.y,
            x,
            y
          );
        } else {
          drawLine(
            context,
            prevPosRef.current.x,
            prevPosRef.current.y,
            x,
            y,
            defaultDrawStyle
          );
        }

        tempPathsRef.current.push({
          x: x / pageSize.width,
          y: y / pageSize.height,
          lastX: prevPosRef.current.x / pageSize.width,
          lastY: prevPosRef.current.y / pageSize.height,
          lineWidth,
          color,
          drawOrder: drawOrder.current,
          alpha: drawType === "highlight" ? 0.4 : 1,
        });

        prevPosRef.current = { x, y };
      }
    },
    [
      color,
      defaultDrawStyle,
      defaultLineWidth,
      devicePixelRatio,
      drawType,
      pageSize.height,
      pageSize.width,
    ]
  );

  const redrawPaths = useCallback(
    (pageWidth: number, pageHeight: number) => {
      if (!canvas.current) return;
      const points = paths.current[pageNumber];
      if (!points || points.length === 0) return;
      const context = canvas.current.getContext("2d")!;
      let currentGroup: PathsType[] = [];

      reDrawSinglePoint(context, points[0], pageWidth, pageHeight);

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
          if (i === 1) {
            currentGroup.push(points[0]);
          }
          currentGroup.push(points[i]);
          continue;
        }
        context.beginPath();
        reDrawSinglePoint(context, points[i], pageWidth, pageHeight);
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
    [pageNumber]
  );

  const stopDrawing = useCallback(
    async (e: canvasEventType) => {
      if (!canvas.current) return;
      const context = canvas.current.getContext("2d")!;

      if (drawType === "eraser") {
        const currentPaths = paths.current[pageNumber] || [];
        const erasePaths = tempPathsRef.current;

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
          [pageNumber]: newPaths,
        };

        // 점선도 지우기
        context.reset();
        redrawPaths(pageSize.width, pageSize.height);
      } else {
        if (tempPathsRef.current.length === 1) {
          const { x, y } = getDrawingPosition(
            canvas,
            e,
            devicePixelRatio,
            scale.current
          );
          drawLine(
            context,
            prevPosRef.current.x,
            prevPosRef.current.y,
            x,
            y,
            defaultDrawStyle
          );
        }

        if (touchPoints.current === 1) {
          const newValue = tempPathsRef.current;
          drawOrder.current += 1;
          paths.current = {
            ...paths.current,
            [pageNumber]: [...(paths.current[pageNumber] || []), ...newValue],
          };
        }
      }

      isDrawing.current = false;
      tempPathsRef.current = [];
      touchPoints.current = 0;
    },
    [
      defaultDrawStyle,
      devicePixelRatio,
      drawType,
      pageNumber,
      pageSize.height,
      pageSize.width,
      redrawPaths,
      strokeStep,
    ]
  );

  return {
    canvas,
    canDraw,
    paths,
    drawOrder,
    scale,
    drawType,
    color,
    touchType,
    zoomEnabled,
    setZoomEnabled,
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
