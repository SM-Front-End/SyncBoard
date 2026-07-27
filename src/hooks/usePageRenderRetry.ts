import { useCallback, useEffect, useRef, useState } from "react";
import { reportErrorToNative } from "../libs/utils/errorReporter";

const MAX_RETRY = 3;
const BASE_DELAY_MS = 250;
const MAX_DELAY_MS = 4000;
const JITTER_RATIO = 0.25;

// react-pdf는 렌더 취소(AbortException/RenderingCancelledException)를 onRenderError
// 전에 걸러내지만, 페이지 로드(onLoadError) 경로에는 그대로 전달될 수 있다.
// 취소는 실패가 아니므로 재시도 대상에서 제외한다.
const isAbortError = (error: Error) =>
  error.name === "AbortException" ||
  error.name === "RenderingCancelledException";

interface Options {
  /** 이 값이 바뀌면 재시도 상태를 초기화한다 (행 재사용, 페이지 크기 변경 등) */
  resetKey: unknown;
  /** 로그에 남길 페이지 번호 */
  pageNumber: number;
}

/**
 * 페이지 로드/렌더 실패 시 지수 백오프 + 지터로 재시도한다.
 * `renderKey`를 <Page key>에 연결하면 값이 바뀔 때마다 Page가 리마운트되며 재시도된다.
 */
export function usePageRenderRetry({ resetKey, pageNumber }: Options) {
  const [renderKey, setRenderKey] = useState(0);
  const [hasFailed, setHasFailed] = useState(false);
  const [isRendered, setIsRendered] = useState(false);
  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // 행이 다른 페이지로 재사용되거나 크기가 바뀌면, 이전에 재시도를 소진했더라도
  // 다시 렌더를 시도할 수 있도록 상태를 초기화한다.
  useEffect(() => {
    clearTimer();
    attemptRef.current = 0;
    setHasFailed(false);
    setIsRendered(false);
  }, [clearTimer, resetKey]);

  // 언마운트 시 예약된 재시도 타이머 정리 (setState 후 경고 방지)
  useEffect(() => clearTimer, [clearTimer]);

  const handleError = useCallback(
    (phase: "load" | "render", error: Error) => {
      if (isAbortError(error)) return;
      console.error(`[react-pdf] page ${pageNumber} ${phase} error:`, error);

      if (attemptRef.current >= MAX_RETRY) {
        setHasFailed(true);
        // 백오프 재시도를 모두 소진한 뒤에만 보고한다. 매 시도마다 보내면
        // 여러 페이지가 동시에 실패할 때 브릿지가 도배된다.
        reportErrorToNative("page", error, { fatal: true, pageNumber });
        return;
      }

      attemptRef.current += 1;
      // 지수 백오프: 250ms → 500ms → 1000ms (최대 4s)
      const delay = Math.min(
        BASE_DELAY_MS * 2 ** (attemptRef.current - 1),
        MAX_DELAY_MS
      );
      // 지터: 여러 페이지가 동시에 실패해도 재시도가 한 프레임에 몰리지 않게 분산
      const jitter = delay * JITTER_RATIO * Math.random();

      clearTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setRenderKey((key) => key + 1);
      }, delay + jitter);
    },
    [clearTimer, pageNumber]
  );

  const onLoadError = useCallback(
    (error: Error) => handleError("load", error),
    [handleError]
  );
  const onRenderError = useCallback(
    (error: Error) => handleError("render", error),
    [handleError]
  );

  const onSuccess = useCallback(() => {
    attemptRef.current = 0;
    setHasFailed(false);
    setIsRendered(true);
  }, []);

  /** 사용자가 직접 누르는 재시도: 백오프 카운터를 리셋하고 즉시 다시 그린다 */
  const retryManually = useCallback(() => {
    clearTimer();
    attemptRef.current = 0;
    setHasFailed(false);
    setRenderKey((key) => key + 1);
  }, [clearTimer]);

  return {
    renderKey,
    hasFailed,
    isRendered,
    onLoadError,
    onRenderError,
    onRenderSuccess: onSuccess,
    retryManually,
  };
}
