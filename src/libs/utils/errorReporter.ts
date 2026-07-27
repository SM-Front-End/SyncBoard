export type ErrorScope =
  /** 파일 수신/초기화 실패 */
  | "init"
  /** 문서 전체 로드 실패 */
  | "document"
  /** 개별 페이지 로드/렌더 실패 */
  | "page"
  /** 저장(getBase64) 실패 */
  | "save"
  /** 페이지 추가 실패 */
  | "new-page"
  /** 검색용 텍스트 추출 실패 */
  | "text-extract"
  /** 처리되지 않은 전역 예외 */
  | "uncaught";

interface ReportOptions {
  /**
   * 사용자 작업이 실패로 끝났는지. 네이티브가 안내를 띄울지, 콜백을 기다리다
   * 포기할지 판단하는 기준이 된다.
   */
  fatal?: boolean;
  pageNumber?: number;
}

// 같은 오류가 반복될 때(페이지별 재시도, 렌더 루프 등) 브릿지를 도배하지 않도록
const DEDUPE_WINDOW_MS = 5_000;
const MAX_TRACKED_KEYS = 50;
const MAX_STACK_LENGTH = 2_000;

const lastReportedAt = new Map<string, number>();

const isDuplicate = (key: string, now: number) => {
  const previous = lastReportedAt.get(key);
  if (previous !== undefined && now - previous < DEDUPE_WINDOW_MS) {
    return true;
  }
  // 창을 벗어난 항목을 정리해 Map이 무한히 커지지 않게 한다
  if (lastReportedAt.size >= MAX_TRACKED_KEYS) {
    for (const [trackedKey, at] of lastReportedAt) {
      if (now - at >= DEDUPE_WINDOW_MS) lastReportedAt.delete(trackedKey);
    }
  }
  lastReportedAt.set(key, now);
  return false;
};

/**
 * 오류를 콘솔에 남기고 네이티브로 보고한다.
 * 네이티브에 AndroidInterface.onError가 없으면(구버전 앱, 브라우저 개발 환경)
 * 콘솔까지만 남기고 조용히 끝난다.
 */
export const reportErrorToNative = (
  scope: ErrorScope,
  error: unknown,
  { fatal = false, pageNumber }: ReportOptions = {}
) => {
  const normalized =
    error instanceof Error ? error : new Error(String(error ?? "Unknown error"));

  console.error(
    `[${scope}]${pageNumber ? ` page ${pageNumber}` : ""}`,
    normalized
  );

  const now = Date.now();
  const key = `${scope}:${pageNumber ?? ""}:${normalized.message}`;
  if (isDuplicate(key, now)) return;

  if (typeof window.AndroidInterface?.onError !== "function") return;

  try {
    window.AndroidInterface.onError(
      JSON.stringify({
        scope,
        fatal,
        message: normalized.message,
        stack: normalized.stack?.slice(0, MAX_STACK_LENGTH),
        pageNumber,
        occurredAt: new Date(now).toISOString(),
      })
    );
  } catch (reportingError) {
    // 보고 실패가 앱을 죽여서는 안 된다
    console.error("에러 보고 실패:", reportingError);
  }
};

/** 어디서도 잡히지 않은 예외를 네이티브로 흘려보낸다. 앱 시작 시 한 번 호출. */
export const installGlobalErrorReporting = () => {
  window.addEventListener("error", (event) => {
    reportErrorToNative("uncaught", event.error ?? event.message, { fatal: true });
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportErrorToNative("uncaught", event.reason, { fatal: true });
  });
};
