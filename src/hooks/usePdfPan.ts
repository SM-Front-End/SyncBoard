import { type PointerEvent, type RefObject, useCallback, useRef } from "react";
import { type ReactZoomPanPinchContentRef } from "react-zoom-pan-pinch";

interface Props {
  scaleRef: RefObject<ReactZoomPanPinchContentRef | null>;
  canDraw: boolean;
  width: number;
  height: number;
  onScrollPositionChange: (offset: number) => void;
}

export function usePdfPan({ scaleRef, canDraw, width, height, onScrollPositionChange }: Props) {
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest("button")) {
        return;
      }

      pointers.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });

      if (!canDraw && (scaleRef.current?.state.scale ?? 1) > 1) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    },
    [canDraw, scaleRef],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const previous = pointers.current.get(event.pointerId);
      if (!previous) return;

      pointers.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });

      const transform = scaleRef.current;
      // 두 손가락 제스처는 확대 라이브러리에 맡기고, 필기 중에는 문서를 움직이지 않는다.
      if (!transform || canDraw || pointers.current.size !== 1) return;
      const { scale, positionX, positionY } = transform.state;
      if (scale <= 1) return;

      event.preventDefault();
      const deltaX = event.clientX - previous.x;
      const deltaY = event.clientY - previous.y;
      const nextX = Math.max(width * (1 - scale), Math.min(0, positionX + deltaX));
      const nextY = Math.max(height * (1 - scale), Math.min(0, positionY + deltaY));

      if (nextX !== positionX || nextY !== positionY) {
        transform.setTransform(nextX, nextY, scale, 0);
      }

      // 확대된 뷰포트의 끝에 도달하면 남은 이동량으로 가상 목록을 스크롤한다.
      // 매 이벤트의 이동량을 사용해야 경계에서 방향을 바꿔도 즉시 움직인다.
      const remainingY = deltaY - (nextY - positionY);
      if (remainingY !== 0) {
        event.currentTarget.scrollTop -= remainingY / scale;
        onScrollPositionChange(event.currentTarget.scrollTop);
      }
    },
    [canDraw, height, onScrollPositionChange, scaleRef, width],
  );

  const onPointerEnd = useCallback((event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
  }, []);

  const onPointerLeave = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      pointers.current.delete(event.pointerId);
    }
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
    onLostPointerCapture: onPointerEnd,
    onPointerLeave,
  };
}
