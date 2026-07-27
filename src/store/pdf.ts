import { atom } from "jotai";
import { DRAWING_DPR } from "../libs/utils/common";

export const fileAtom = atom({
  base64: "",
  paths: "",
  isNew: false,
  type: "",
});
// <Document>에 넘길 원본 바이트. fileAtom.base64는 페이지 추가/저장의 정본이라
// 계속 갱신되지만, 그 값을 그대로 Document에 다시 넣으면 문서 전체가 재파싱되고
// 모든 페이지가 다시 렌더된다. 그래서 파일이 실제로 교체될 때만 이 값을 바꾼다.
export const documentBase64Atom = atom("");
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
