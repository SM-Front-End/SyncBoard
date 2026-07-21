import { RefObject, useEffect } from "react";
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

interface UseWebviewInterfaceProps {
  paths: React.RefObject<{ [pageNumber: number]: PathsType[] }>;
  getSearchResult: (text: string) => any[];
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

  useEffect(() => {
    if (__DEV__) return;

    const webviewInterface = {
      getBase64: async () => {
        const data = await getModifiedPDFBase64(paths.current, file.base64);
        window.AndroidInterface.getBase64(data);
      },

      getPathData: () => {
        return JSON.stringify(paths.current);
      },

      newPage: async () => {
        if (pdfState.totalPage === 5) {
          alert(t("alert_max_5_page"));
          return;
        }
        const newBase64 = await createOrMergePdf(file.base64);
        setPdfState((prev) => ({
          ...prev,
          pageNumber: prev.totalPage + 1,
          totalPage: prev.totalPage + 1,
        }));
        setFile({
          ...file,
          base64: newBase64,
        });
        window.AndroidInterface.getPdfData(newBase64);
      },

      newPageSetting: async () => {
        const newBase64 = await createOrMergePdf();
        window.AndroidInterface.getPdfData(newBase64);
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
