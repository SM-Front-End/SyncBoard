import "react-pdf/dist/Page/TextLayer.css";
import { pdfjs } from "react-pdf";
import PdfEngine from "./PdfEngine";
import { useEffect, useState, useRef } from "react";
import {
  __DEV__,
  createOrMergePdf,
  createPDFFromImgBase64,
} from "./libs/utils/common";
import { useSetAtom } from "jotai";
import { fileAtom } from "./store/pdf";
import { isTablet } from "react-device-detect";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?worker&url";
import { useTranslation } from "./hooks/useTranslation";
import Loading from "./components/Loading";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

function App() {
  const attemptsRef = useRef(0);
  const { changeLanguage, t } = useTranslation();
  const setFile = useSetAtom(fileAtom);
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
        changeLanguage("ko");
        setIsLoading(false);
        return;
      }

      window.webviewApi = async (appData: string) => {
        const param = JSON.parse(appData);
        console.log(param);
        setFile({
          base64: param?.data?.isNew
            ? await createOrMergePdf()
            : param?.data?.type === "pdf"
              ? param?.data?.base64
              : await createPDFFromImgBase64(
                  param?.data?.base64,
                  param?.data?.type,
                ),
          paths: param?.data?.paths,
          isNew: param?.data?.isNew,
          type: param?.data?.type,
        });
        changeLanguage(param?.data?.lang ?? "ko");
        setIsLoading(false);
      };
    };

    initializeFile();
  }, [changeLanguage, setFile]);

  useEffect(() => {
    const interval = 3000;

    const checkLoading = setInterval(() => {
      if (isLoading) {
        if (attemptsRef.current === 3) {
          clearInterval(checkLoading);
          alert(t("alert_max_set_data"));
          return;
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
