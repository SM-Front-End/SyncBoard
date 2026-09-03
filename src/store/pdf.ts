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
