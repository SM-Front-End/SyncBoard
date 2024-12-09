import { RefObject, useEffect } from "react";
import { PathsType } from "../types/common";
import {
  getModifiedPDFBase64,
  createOrMergePdf,
  __DEV__,
} from "../utils/common";
import { useAtom, useSetAtom } from "jotai";
import { fileAtom, pdfStateAtom, searchTextAtom } from "../store/pdf";
import { ReactZoomPanPinchContentRef } from "react-zoom-pan-pinch";

interface UseWebviewInterfaceProps {
  paths: React.MutableRefObject<{ [pageNumber: number]: PathsType[] }>;
  getSearchResult: (text: string) => any[];
  scaleRef: RefObject<ReactZoomPanPinchContentRef>;
  canvasRefs: RefObject<HTMLCanvasElement[]>;
}

export const useWebviewInterface = ({
  paths,
  getSearchResult,
  scaleRef,
  canvasRefs,
}: UseWebviewInterfaceProps) => {
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
          alert("최대 5페이지까지 추가 가능합니다.");
          return;
        }
        const newBase64 = await createOrMergePdf(file.base64);
        setPdfState((prev) => ({
          ...prev,
          pageNumber: prev.totalPage + 1,
          totalPage: prev.totalPage + 1,
          isDocumentLoading: true,
        }));
        setFile({
          ...file,
          base64: newBase64,
        });
        window.AndroidInterface.getPdfData(newBase64);
      },

      getSearchText: (data: string) => {
        setSearchText(data);
        const resultsList = getSearchResult(data);
        return resultsList.map((result) => result.pageNumber);
      },

      getPageNumber: (data: string) => {
        if (!isNaN(Number(data))) {
          // setPdfState((prev) => ({
          //   ...prev,
          //   pageNumber: Number(data),
          // }));
          scaleRef.current?.resetTransform(0);

          if (canvasRefs.current) {
            canvasRefs.current[Number(data)].scrollIntoView();
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
    canvasRefs,
  ]);
};
