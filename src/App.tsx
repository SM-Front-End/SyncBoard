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
import { useAtomValue, useSetAtom } from "jotai";
import {
  documentSessionAtom,
  loadDocumentAtom,
  type DocumentSource,
} from "./store/pdf";
import { isTablet } from "react-device-detect";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?worker&url";
import { useTranslation } from "./hooks/useTranslation";
import Loading from "./components/Loading";
import { parseWebviewFileData } from "./libs/utils/webviewFileSource";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

type FileLoadStatus = "waiting" | "loading" | "loaded";

function App() {
  const attemptsRef = useRef(0);
  const loadRequestIdRef = useRef(0);
  const loadStatusRef = useRef<FileLoadStatus>("waiting");
  const { changeLanguage, t } = useTranslation();
  const loadDocument = useSetAtom(loadDocumentAtom);
  const documentSession = useAtomValue(documentSessionAtom);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isDisposed = false;

    const initializeFile = async () => {
      if (__DEV__ || !isTablet) {
        const { base64 } = await import("./libs/mock/base64");
        if (isDisposed) return;
        loadDocument({
          file: {
            base64,
            bytes: null,
            paths: "",
            isNew: false,
            type: "pdf",
          },
          source: { kind: "base64", base64 },
        });
        changeLanguage("ko");
        loadStatusRef.current = "loaded";
        setIsLoading(false);
        return;
      }

      window.webviewApi = async (appData: string) => {
        // 먼저 payload 전체를 검증한다. 잘못된 새 요청 때문에 정상적으로 진행 중인
        // 이전 요청이 무효화되지 않도록 request id 갱신은 검증 뒤에 한다.
        let data;
        try {
          data = parseWebviewFileData(appData);
        } catch (error) {
          reportErrorToNative("init", error, { fatal: true });
          return;
        }

        const requestId = loadRequestIdRef.current + 1;
        loadRequestIdRef.current = requestId;
        loadStatusRef.current = "loading";

        // URL은 react-pdf에 그대로 넘긴다. Base64 입력과 새 문서/이미지만 기존
        // 내부 Base64 경로로 정규화한다.
        try {
          let base64 = "";
          let documentSource: DocumentSource;

          if (data.isNew) {
            base64 = await createOrMergePdf();
            documentSource = { kind: "base64", base64 };
          } else if (data.source?.kind === "url") {
            documentSource = data.source;
          } else {
            if (!data.source || data.source.kind !== "base64") {
              throw new Error("문서 원본 데이터가 없습니다.");
            }
            base64 =
              data.type === "pdf"
                ? data.source.base64
                : await createPDFFromImgBase64(
                    data.source.base64,
                    data.type,
                  );
            documentSource = { kind: "base64", base64 };
          }

          if (
            isDisposed ||
            requestId !== loadRequestIdRef.current
          ) {
            return;
          }

          loadDocument({
            file: {
              base64,
              bytes: null,
              paths: data.paths,
              isNew: data.isNew,
              type: data.type,
            },
            source: documentSource,
          });
          changeLanguage(data.lang);
          loadStatusRef.current = "loaded";
          setIsLoading(false);
        } catch (error) {
          if (isDisposed || requestId !== loadRequestIdRef.current) return;
          loadStatusRef.current = "waiting";
          reportErrorToNative("init", error, { fatal: true });
        }
      };
    };

    void initializeFile();

    return () => {
      isDisposed = true;
      loadRequestIdRef.current += 1;
    };
  }, [changeLanguage, loadDocument]);

  useEffect(() => {
    const interval = 3000;

    const checkLoading = setInterval(() => {
      if (isLoading) {
        if (loadStatusRef.current !== "waiting") return;
        if (attemptsRef.current >= 3) {
          clearInterval(checkLoading);
          reportErrorToNative(
            "init",
            new Error("setPdfData 3회 요청 후에도 파일을 받지 못함"),
            { fatal: true },
          );
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

  return <>{isLoading ? <Loading /> : <PdfEngine key={documentSession} />}</>;
}

export default App;
