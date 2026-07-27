import { useEffect, useCallback, useRef } from "react";
import { escapeRegExp } from "../libs/utils/common";
import { reportErrorToNative } from "../libs/utils/errorReporter";
import { PdfDocumentType } from "../libs/types/common";

export interface SearchResult {
  pageNumber: number;
}

// 한 번에 처리할 페이지 수. 너무 크면 청크 하나가 프레임을 잡아먹는다.
const CHUNK_SIZE = 10;
// idle이 오래 오지 않아도 추출이 끝나도록 하는 상한
const IDLE_TIMEOUT_MS = 500;

const waitForIdle = () =>
  new Promise<void>((resolve) => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => resolve(), { timeout: IDLE_TIMEOUT_MS });
    } else {
      setTimeout(resolve, 0);
    }
  });

export const usePdfTextSearch = (pdf: PdfDocumentType | null) => {
  // pages를 state로 두면 추출이 끝날 때마다 리렌더가 나고 getSearchResult의
  // identity가 바뀌어, 이를 의존하는 useWebviewInterface가 window 인터페이스를
  // 다시 등록한다. 검색에만 쓰는 값이므로 ref로 충분하다.
  const pagesRef = useRef<string[]>([]);
  const cachedSearchResults = useRef<Map<string, SearchResult[]>>(new Map());

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;

    // 문서가 바뀌면 이전 문서 기준의 텍스트/검색 캐시 무효화
    pagesRef.current = new Array(pdf.numPages).fill("");
    cachedSearchResults.current.clear();

    // 텍스트 추출은 검색에만 필요하므로 첫 페이지 렌더와 경쟁시키지 않는다.
    // idle 시간에 청크 단위로 나눠 처리해 렌더/스크롤을 막지 않으면서,
    // 사용자가 검색을 시작하기 전에 백그라운드로 미리 끝내둔다.
    const extractPageTexts = async () => {
      for (let start = 0; start < pdf.numPages; start += CHUNK_SIZE) {
        await waitForIdle();
        if (cancelled) return;

        const end = Math.min(start + CHUNK_SIZE, pdf.numPages);
        const chunk = await Promise.all(
          Array.from({ length: end - start }, async (_, offset) => {
            const page = await pdf.getPage(start + offset + 1);
            const textContent = await page.getTextContent();
            return textContent.items
              .map((item) => ("str" in item ? item.str : ""))
              .join(" ");
          })
        );
        if (cancelled) return;

        for (let i = 0; i < chunk.length; i++) {
          pagesRef.current[start + i] = chunk[i];
        }
        // 앞쪽 페이지가 추가되면 이전 검색 결과가 불완전해지므로 캐시를 비운다
        cachedSearchResults.current.clear();
      }
    };

    extractPageTexts().catch((error) => {
      // 검색만 못 쓰게 될 뿐 문서 열람은 정상이므로 fatal이 아니다
      if (!cancelled) reportErrorToNative("text-extract", error);
    });

    return () => {
      cancelled = true;
    };
  }, [pdf]);

  const getSearchResult = useCallback((searchText: string) => {
    try {
      const cached = cachedSearchResults.current.get(searchText);
      if (cached) return cached;

      const regex = new RegExp(escapeRegExp(searchText), "gi");
      const results = pagesRef.current.reduce<SearchResult[]>(
        (results, text, pageIndex) => {
          if (text.match(regex)) {
            results.push({
              pageNumber: pageIndex + 1,
            });
          }
          return results;
        },
        []
      );

      cachedSearchResults.current.set(searchText, results);
      return results;
    } catch (error) {
      console.error("검색 에러:", error);
      return [];
    }
  }, []);

  return {
    getSearchResult,
  };
};
