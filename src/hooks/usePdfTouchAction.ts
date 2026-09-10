import { type RefObject, type TouchEvent as ReactTouchEvent, useCallback, useLayoutEffect, useRef } from "react";

interface Props {
  scale: RefObject<number>;
  canDraw: boolean;
}

export function usePdfTouchAction({ scale, canDraw }: Props) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const lastElementRef = useRef<HTMLDivElement | null>(null);
  const touchCount = useRef(0);
  const drawing = useRef(canDraw);
  const touchTargets = useRef(new Map<EventTarget, EventListener>());

  const clearTouchTargets = useCallback(() => {
    for (const [target, listener] of touchTargets.current) {
      target.removeEventListener("touchend", listener);
      target.removeEventListener("touchcancel", listener);
    }
    touchTargets.current.clear();
  }, []);

  const syncTouchAction = useCallback(() => {
    // 진행 중인 접촉의 정책은 유지하고, 다음 제스처 전에 최종 배율을 반영한다.
    // 핀치 중 1배 경계를 반복해서 넘어도 touch-action을 다시 쓰지 않는다.
    if (touchCount.current > 0) return;
    const element = elementRef.current;
    if (!element) return;
    const touchAction = scale.current > 1 && !drawing.current ? "none" : "pan-x pan-y";
    if (element.style.touchAction !== touchAction) {
      element.style.touchAction = touchAction;
    }
  }, [scale]);

  const setElement = useCallback((element: HTMLDivElement | null) => {
    elementRef.current = element;
    if (element && element !== lastElementRef.current) {
      lastElementRef.current = element;
      touchCount.current = 0;
      clearTouchTargets();
    }
    // 모드/크기 변경으로 같은 DOM의 ref가 재연결돼도 접촉 상태를 유지한다.
    syncTouchAction();
  }, [clearTouchTargets, syncTouchAction]);

  const onTouchEnd = useCallback((event: TouchEvent) => {
    if (touchCount.current === 0) return;
    touchCount.current = event.touches.length;
    if (touchCount.current === 0) clearTouchTargets();
    syncTouchAction();
  }, [clearTouchTargets, syncTouchAction]);

  const onTouchStartCapture = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    touchCount.current = event.touches.length;
    for (const touch of Array.from(event.touches)) {
      const target = touch.target;
      if (touchTargets.current.has(target)) continue;
      const onDetachedTouchEnd: EventListener = (nativeEvent) => {
        // 가상 행이 제거되면 종료 이벤트가 document까지 올라오지 않는다.
        // 연결된 행은 라이브러리 정렬 뒤의 document 경로에서 처리한다.
        if ((target as Node).isConnected === false) onTouchEnd(nativeEvent as TouchEvent);
      };
      touchTargets.current.set(target, onDetachedTouchEnd);
      target.addEventListener("touchend", onDetachedTouchEnd, { passive: true });
      target.addEventListener("touchcancel", onDetachedTouchEnd, { passive: true });
    }
  }, [onTouchEnd]);

  useLayoutEffect(() => {
    drawing.current = canDraw;
    syncTouchAction();
  }, [canDraw, syncTouchAction]);

  useLayoutEffect(() => {
    const targets = touchTargets.current;
    const onBlur = () => {
      touchCount.current = 0;
      clearTouchTargets();
      syncTouchAction();
    };

    // onPinchStop은 2→1에서도 호출된다. 모든 접촉의 종료/취소를 별도로 확인한다.
    // bubble 단계에서 라이브러리의 touchend 정렬이 끝난 뒤 최신 배율을 읽는다.
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchEnd, { passive: true });
    window.addEventListener("blur", onBlur);
    // StrictMode가 effect를 재실행해도 진행 중인 접촉의 종료 리스너를 복원한다.
    for (const [target, listener] of targets) {
      target.addEventListener("touchend", listener, { passive: true });
      target.addEventListener("touchcancel", listener, { passive: true });
    }
    return () => {
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("blur", onBlur);
      for (const [target, listener] of targets) {
        target.removeEventListener("touchend", listener);
        target.removeEventListener("touchcancel", listener);
      }
    };
  }, [clearTouchTargets, onTouchEnd, syncTouchAction]);

  return { syncTouchAction, setElement, onTouchStartCapture };
}
