/**
 * 네이티브(WebView)가 직접 호출하는 전역 함수들.
 * 반환값이 있는 메서드는 네이티브가 evaluateJavascript의 결과를 읽어가므로,
 * 시그니처를 바꾸면(특히 async로 만들면) 브릿지가 깨진다.
 */
type WebviewInterface = {
  /** 결과는 AndroidInterface.getBase64로 전달 */
  getBase64: () => Promise<void>;
  /** 필기 데이터 JSON 문자열을 반환 */
  getPathData: () => string;
  /** 결과는 AndroidInterface.getPdfData로 전달 */
  newPage: () => Promise<void>;
  /** 결과는 AndroidInterface.getPdfData로 전달 */
  newPageSetting: () => Promise<void>;
  /** 검색어가 포함된 페이지 번호 배열을 반환 (1-based) */
  getSearchText: (data: string) => number[];
  getPageNumber: (data: string) => void;
  endSearch: () => void;
};

interface Window extends WebviewInterface {
  /**
   * 네이티브가 문서를 넘겨주는 진입점. 기존 data.base64와 아래 URL 입력을 모두 지원.
   * { data: { type: "pdf", source: { kind: "url", url: "https://appassets.androidplatform.net/doc/<id>" } } }
   */
  webviewApi: (data: string) => Promise<void>;
  AndroidInterface: {
    getBase64: (data: string) => void;
    getPdfData: (data: string) => void;
    setFullMode: (data: boolean) => void;
    setPdfData: (data: boolean) => void;
    /**
     * 웹뷰 오류 보고. 인자는 아래 형태의 JSON 문자열.
     * {
     *   scope: "init" | "document" | "page" | "save"
     *        | "new-page" | "text-extract" | "uncaught",
     *   fatal: boolean,        // 사용자 작업이 실패로 끝났는지
     *   message: string,
     *   stack?: string,
     *   pageNumber?: number,   // scope가 "page"일 때
     *   occurredAt: string     // ISO 8601
     * }
     * 구버전 앱에는 없을 수 있어 optional. reportErrorToNative가 존재 여부를 확인한다.
     */
    onError?: (data: string) => void;
  };
}
