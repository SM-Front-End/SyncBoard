import { RefObject, useEffect, useRef } from "react";
import { PathsType } from "../libs/types/common";
import {
  getModifiedPDFBase64,
  createOrMergePdf,
  __DEV__,
} from "../libs/utils/common";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import {
  documentReadyAtom,
  documentSessionAtom,
  fileAtom,
  pdfStateAtom,
  searchTextAtom,
} from "../store/pdf";
import { ReactZoomPanPinchContentRef } from "react-zoom-pan-pinch";
import { type ListImperativeAPI } from "react-window";
import { useTranslation } from "./useTranslation";
import { type SearchResult } from "./usePdfTextSearch";
import { reportErrorToNative } from "../libs/utils/errorReporter";

export const MAX_PAGE = 5;

interface UseWebviewInterfaceProps {
  paths: React.RefObject<{ [pageNumber: number]: PathsType[] }>;
  getSearchResult: (text: string) => SearchResult[];
  scaleRef: RefObject<ReactZoomPanPinchContentRef | null>;
  listRef: RefObject<ListImperativeAPI | null>;
}

export const useWebviewInterface = ({
  paths,
  getSearchResult,
  scaleRef,
  listRef,
}: UseWebviewInterfaceProps) => {
  const { t } = useTranslation();
  const store = useStore();
  const documentSession = useAtomValue(documentSessionAtom);
  const setFile = useSetAtom(fileAtom);
  const setPdfState = useSetAtom(pdfStateAtom);
  const setSearchText = useSetAtom(searchTextAtom);
  const isAddingPageRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (__DEV__) return;

    const isCurrentDocument = () =>
      isMountedRef.current && store.get(documentSessionAtom) === documentSession;
    const requireDocumentReady = () => {
      if (!isCurrentDocument() || !store.get(documentReadyAtom)) {
        throw new Error("PDF 문서가 아직 준비되지 않았습니다.");
      }
    };

    const getPdfData = () => {
      requireDocumentReady();
      const file = store.get(fileAtom);
      if (file.bytes !== null) return file.bytes;
      if (file.base64.length > 0) return file.base64;
      throw new Error("PDF 원본이 아직 준비되지 않았습니다.");
    };

    // 타입을 명시해야 Object.assign이 검사를 우회하지 않는다.
    // (이게 없어서 미선언 메서드 newPageSetting이 그동안 그냥 통과했다)
    const webviewInterface: WebviewInterface = {
      getBase64: async () => {
        // 실패하면 네이티브는 오지 않을 getBase64 콜백을 계속 기다리게 된다.
        // 반드시 실패를 알려 대기를 끊어 준다.
        if (!isCurrentDocument()) return;
        try {
          // 비동기 PDF 처리 중 새 획이 추가되어도 이번 저장 내용은 바뀌지 않는다.
          const savedPaths = Object.fromEntries(
            Object.entries(paths.current).map(([page, strokes]) => [
              page,
              strokes.map((stroke) => ({ ...stroke })),
            ]),
          );
          const data = await getModifiedPDFBase64(
            savedPaths,
            getPdfData(),
          );
          if (!isCurrentDocument()) return;
          window.AndroidInterface.getBase64(data);
        } catch (error) {
          if (isCurrentDocument()) {
            reportErrorToNative("save", error, { fatal: true });
          }
        }
      },

      getPathData: () => {
        try {
          requireDocumentReady();
          return JSON.stringify(paths.current);
        } catch (error) {
          if (isCurrentDocument()) {
            reportErrorToNative("document", error, { fatal: true });
          }
          throw error;
        }
      },

      newPage: async () => {
        // 연타 시 중복 실행되면 상한을 넘거나 서로의 결과를 덮어쓴다
        if (!isCurrentDocument() || isAddingPageRef.current) return;
        isAddingPageRef.current = true;
        try {
          requireDocumentReady();
          if (store.get(pdfStateAtom).totalPage >= MAX_PAGE) {
            alert(t("alert_max_5_page"));
            return;
          }
          const newBase64 = await createOrMergePdf(getPdfData());
          if (!isCurrentDocument()) return;
          // fileAtom만 갱신하고 documentSourceAtom은 그대로 두어 <Document>가
          // 재파싱되지 않게 한다. 추가된 페이지는 Row가 빈 페이지로 렌더한다.
          setFile((prev) => ({ ...prev, base64: newBase64, bytes: null }));
          setPdfState((prev) => ({ ...prev, totalPage: prev.totalPage + 1 }));
          window.AndroidInterface.getPdfData(newBase64);
        } catch (error) {
          if (isCurrentDocument()) {
            reportErrorToNative("new-page", error, { fatal: true });
          }
        } finally {
          isAddingPageRef.current = false;
        }
      },

      newPageSetting: async () => {
        if (!isCurrentDocument()) return;
        try {
          const newBase64 = await createOrMergePdf();
          if (!isCurrentDocument()) return;
          window.AndroidInterface.getPdfData(newBase64);
        } catch (error) {
          if (isCurrentDocument()) {
            reportErrorToNative("new-page", error, { fatal: true });
          }
        }
      },

      getSearchText: (data: string) => {
        try {
          requireDocumentReady();
          setSearchText(data);
          const resultsList = getSearchResult(data);
          return resultsList.map((result) => result.pageNumber);
        } catch (error) {
          if (isCurrentDocument()) {
            reportErrorToNative("text-extract", error, { fatal: true });
          }
          throw error;
        }
      },

      getPageNumber: (data: string) => {
        if (!isCurrentDocument() || !store.get(documentReadyAtom)) return;
        const pageNumber = Number(data);
        if (
          !Number.isInteger(pageNumber) ||
          pageNumber < 1 ||
          pageNumber > store.get(pdfStateAtom).totalPage
        ) return;
        scaleRef.current?.resetTransform(0);
        listRef.current?.scrollToRow({ index: pageNumber - 1, align: "start" });
      },

      endSearch: () => {
        if (!isCurrentDocument()) return;
        setSearchText("");
      },
    };

    // 웹뷰 인터페이스 메서드들을 window 객체에 할당
    Object.assign(window, webviewInterface);

    // 문서 상태가 바뀌거나 뷰어가 내려갈 때 이전 문서를 캡처한 함수가 남지 않게 한다.
    return () => {
      for (const key of Object.keys(
        webviewInterface,
      ) as (keyof WebviewInterface)[]) {
        if (window[key] === webviewInterface[key]) {
          Reflect.deleteProperty(window, key);
        }
      }
    };
  }, [
    documentSession,
    paths,
    setPdfState,
    setFile,
    setSearchText,
    getSearchResult,
    scaleRef,
    listRef,
    store,
    t,
  ]);
};
