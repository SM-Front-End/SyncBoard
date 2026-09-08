import { atom } from "jotai";
import { DRAWING_DPR } from "../libs/utils/common";

export const fileAtom = atom({
  base64: "",
  bytes: null as Uint8Array | null,
  paths: "",
  isNew: false,
  type: "",
});
export type DocumentSource =
  | { kind: "base64"; base64: string }
  | { kind: "url"; url: string };
// <Document>에 넘길 최초 원본. 편집용 fileAtom 데이터가 페이지 추가로 바뀌어도
// 이 값은 유지해 문서 전체가 다시 파싱·렌더되지 않게 한다.
export const documentSourceAtom = atom<DocumentSource | null>(null);
// 같은 파일을 다시 전달받아도 새 세션으로 취급해 이전 필기와 비동기 작업을 분리한다.
export const documentSessionAtom = atom(0);
export const documentReadyAtom = atom(false);
export const searchTextAtom = atom("");
export const pdfStateAtom = atom({
  isToolBarOpen: false,
  isListOpen: false,
  isFullScreen: false,
  isStrokeOpen: false,
  totalPage: 1,
});
export const pdfConfigAtom = atom({
  size: { width: 0, height: 0 },
  strokeStep: 16,
  devicePixelRatio: DRAWING_DPR,
});

export const loadDocumentAtom = atom(
  null,
  (
    get,
    set,
    document: {
      file: typeof fileAtom.init;
      source: DocumentSource;
    },
  ) => {
    set(documentReadyAtom, false);
    set(fileAtom, document.file);
    set(documentSourceAtom, document.source);
    set(searchTextAtom, "");
    set(pdfStateAtom, {
      ...pdfStateAtom.init,
      // 전체 화면은 네이티브 창 상태이므로 문서가 바뀌어도 유지한다.
      isFullScreen: get(pdfStateAtom).isFullScreen,
    });
    set(pdfConfigAtom, {
      ...get(pdfConfigAtom),
      size: { width: 0, height: 0 },
    });
    set(documentSessionAtom, get(documentSessionAtom) + 1);
  },
);
