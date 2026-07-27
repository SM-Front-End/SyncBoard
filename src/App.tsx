import "react-pdf/dist/Page/TextLayer.css";
import { pdfjs } from "react-pdf";
import PdfEngine from "./PdfEngine";
import { useEffect, useState, useRef } from "react";
import {
  __DEV__,
  createOrMergePdf,
  createPDFFromImgBase64,
} from "./libs/utils/common";
import { reportErrorToNative } from "./libs/utils/errorReporter";
import { useSetAtom } from "jotai";
import { documentBase64Atom, fileAtom } from "./store/pdf";
import { isTablet } from "react-device-detect";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?worker&url";
import { useTranslation } from "./hooks/useTranslation";
import Loading from "./components/Loading";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

function App() {
  const attemptsRef = useRef(0);
  const { changeLanguage, t } = useTranslation();
  const setFile = useSetAtom(fileAtom);
  const setDocumentBase64 = useSetAtom(documentBase64Atom);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const initializeFile = async () => {
      if (__DEV__ || !isTablet) {
        const { base64 } = await import("./libs/mock/base64");
        setFile({
          base64: base64,
          paths: "",
          isNew: false,
          type: "pdf",
        });
        setDocumentBase64(base64);
        changeLanguage("ko");
        setIsLoading(false);
        return;
      }

      window.webviewApi = async (appData: string) => {
        // JSON 파싱 실패, 지원하지 않는 이미지 형식 등으로 던지면 isLoading이
        // 영원히 true로 남는다. 네이티브가 다른 파일을 보내거나 안내할 수 있도록
        // 실패를 알린다.
        try {
          const param = JSON.parse(appData);
          const base64 = param?.data?.isNew
            ? await createOrMergePdf()
            : param?.data?.type === "pdf"
              ? param?.data?.base64
              : await createPDFFromImgBase64(
                  param?.data?.base64,
                  param?.data?.type,
                );
          setFile({
            base64,
            paths: param?.data?.paths,
            isNew: param?.data?.isNew,
            type: param?.data?.type,
          });
          setDocumentBase64(base64);
          changeLanguage(param?.data?.lang ?? "ko");
          setIsLoading(false);
        } catch (error) {
          reportErrorToNative("init", error, { fatal: true });
        }
      };
    };

    initializeFile();
  }, [changeLanguage, setDocumentBase64, setFile]);

  useEffect(() => {
    const interval = 3000;

    const checkLoading = setInterval(() => {
      if (isLoading) {
        if (attemptsRef.current === 3) {
          clearInterval(checkLoading);
          reportErrorToNative(
            "init",
            new Error("setPdfData 3회 요청 후에도 파일을 받지 못함"),
            { fatal: true },
          );
          alert(t("alert_max_set_data"));
        }
        if (window.AndroidInterface && window.AndroidInterface.setPdfData) {
          window.AndroidInterface.setPdfData(true);
          attemptsRef.current += 1;
        }
      } else {
        clearInterval(checkLoading);
      }
    }, interval);

    return () => clearInterval(checkLoading);
  }, [isLoading, t]);

  return <>{isLoading ? <Loading /> : <PdfEngine />}</>;
}

export default App;
