import { useEffect, useCallback, useRef } from "react";
import { escapeRegExp } from "../libs/utils/common";
import { PdfDocumentType } from "../libs/types/common";

export interface SearchResult {
  pageNumber: number;
}

const CHUNK_SIZE = 10;

export const usePdfTextSearch = () => {
  const pagesRef = useRef<string[] | null>(null);
  const extractionError = useRef<Error | null>(null);
  const cachedSearchResults = useRef<Map<string, SearchResult[]>>(new Map());
  const generation = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    const cache = cachedSearchResults.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      pagesRef.current = null;
      extractionError.current = null;
      cache.clear();
    };
  }, []);

  const prepareSearch = useCallback(async (pdf: PdfDocumentType) => {
    const request = ++generation.current;
    pagesRef.current = null;
    extractionError.current = null;
    cachedSearchResults.current.clear();

    const isCurrent = () => mounted.current && generation.current === request;
    const assertCurrent = () => {
      if (!isCurrent()) {
        throw new DOMException("문서 검색 준비가 취소되었습니다.", "AbortError");
      }
    };

    try {
      // 완성된 색인만 공개해야 동기 검색이 준비 중인 페이지를 '결과 없음'으로 반환하지 않는다.
      const pages = new Array<string>(pdf.numPages);
      for (let start = 0; start < pdf.numPages; start += CHUNK_SIZE) {
        assertCurrent();
        if (start > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          assertCurrent();
        }

        const end = Math.min(start + CHUNK_SIZE, pdf.numPages);
        const chunk = await Promise.all(
          Array.from({ length: end - start }, async (_, offset) => {
            const page = await pdf.getPage(start + offset + 1);
            const textContent = await page.getTextContent();
            return textContent.items
              .map((item) => ("str" in item ? item.str : ""))
              .join(" ");
          }),
        );
        assertCurrent();
        for (let index = 0; index < chunk.length; index++) {
          pages[start + index] = chunk[index];
        }
      }

      assertCurrent();
      pagesRef.current = pages;
    } catch (error) {
      if (isCurrent()) {
        extractionError.current =
          error instanceof Error ? error : new Error(String(error));
      }
      throw error;
    }
  }, []);

  const getSearchResult = useCallback((searchText: string) => {
    if (extractionError.current) throw extractionError.current;
    if (!pagesRef.current) {
      throw new Error("문서 검색 준비가 완료되지 않았습니다.");
    }

    const query = searchText.trim();
    if (!query) return [];
    const cached = cachedSearchResults.current.get(query);
    if (cached) return cached;

    const regex = new RegExp(escapeRegExp(query), "i");
    const results = pagesRef.current.reduce<SearchResult[]>(
      (matches, text, index) => {
        if (regex.test(text)) matches.push({ pageNumber: index + 1 });
        return matches;
      },
      [],
    );

    cachedSearchResults.current.set(query, results);
    return results;
  }, []);

  return { prepareSearch, getSearchResult };
};
