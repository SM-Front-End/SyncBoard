import { RefObject, useEffect, useRef } from "react";
import { PathsType } from "../libs/types/common";
import {
  getModifiedPDFBase64,
  createOrMergePdf,
  __DEV__,
} from "../libs/utils/common";
import { useAtom, useSetAtom } from "jotai";
import { fileAtom, pdfStateAtom, searchTextAtom } from "../store/pdf";
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
  const [file, setFile] = useAtom(fileAtom);
  const [pdfState, setPdfState] = useAtom(pdfStateAtom);
  const setSearchText = useSetAtom(searchTextAtom);
  const isAddingPageRef = useRef(false);

  useEffect(() => {
    if (__DEV__) return;

    // 타입을 명시해야 Object.assign이 검사를 우회하지 않는다.
    // (이게 없어서 미선언 메서드 newPageSetting이 그동안 그냥 통과했다)
    const webviewInterface: WebviewInterface = {
      getBase64: async () => {
        // 실패하면 네이티브는 오지 않을 getBase64 콜백을 계속 기다리게 된다.
        // 반드시 실패를 알려 대기를 끊어 준다.
        try {
          const data = await getModifiedPDFBase64(paths.current, file.base64);
          window.AndroidInterface.getBase64(data);
        } catch (error) {
          reportErrorToNative("save", error, { fatal: true });
        }
      },

      getPathData: () => {
        return JSON.stringify(paths.current);
      },

      newPage: async () => {
        // 연타 시 중복 실행되면 상한을 넘거나 서로의 결과를 덮어쓴다
        if (isAddingPageRef.current) return;
        if (pdfState.totalPage >= MAX_PAGE) {
          alert(t("alert_max_5_page"));
          return;
        }
        isAddingPageRef.current = true;
        try {
          const newBase64 = await createOrMergePdf(file.base64);
          // fileAtom만 갱신하고 documentBase64Atom은 그대로 두어 <Document>가
          // 재파싱되지 않게 한다. 추가된 페이지는 Row가 빈 페이지로 렌더한다.
          setFile((prev) => ({ ...prev, base64: newBase64 }));
          setPdfState((prev) => ({ ...prev, totalPage: prev.totalPage + 1 }));
          window.AndroidInterface.getPdfData(newBase64);
        } catch (error) {
          reportErrorToNative("new-page", error, { fatal: true });
        } finally {
          isAddingPageRef.current = false;
        }
      },

      newPageSetting: async () => {
        try {
          const newBase64 = await createOrMergePdf();
          window.AndroidInterface.getPdfData(newBase64);
        } catch (error) {
          reportErrorToNative("new-page", error, { fatal: true });
        }
      },

      getSearchText: (data: string) => {
        setSearchText(data);
        const resultsList = getSearchResult(data);
        return resultsList.map((result) => result.pageNumber);
      },

      getPageNumber: (data: string) => {
        if (!isNaN(Number(data))) {
          scaleRef.current?.resetTransform(0);
          if (listRef.current) {
            listRef.current.scrollToRow({ index: Number(data) - 1, align: "start" });
          }
        }
      },

      endSearch: () => {
        setSearchText("");
      },
    };

    // 웹뷰 인터페이스 메서드들을 window 객체에 할당
    Object.assign(window, webviewInterface);
  }, [
    file,
    paths,
    pdfState.totalPage,
    setPdfState,
    setFile,
    setSearchText,
    getSearchResult,
    scaleRef,
    listRef,
    t,
  ]);
};
