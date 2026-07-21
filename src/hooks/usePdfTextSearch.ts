import { useState, useEffect, useCallback } from "react";
import { escapeRegExp } from "../libs/utils/common";
import { PdfDocumentType } from "../libs/types/common";

interface SearchResult {
  pageNumber: number;
}

export const usePdfTextSearch = (pdf: PdfDocumentType | null) => {
  const [pages, setPages] = useState<string[]>([]);
  const [cachedSearchResults, setCachedSearchResults] = useState<
    Map<string, SearchResult[]>
  >(new Map());

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;

    const loadPdfPages = async () => {
      try {
        const pagePromises = Array.from({ length: pdf.numPages }, async (_, i) => {
          const page = await pdf.getPage(i + 1);
          const textContent = await page.getTextContent();
          return textContent.items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" ");
        });

        const loadedPages = await Promise.all(pagePromises);
        if (cancelled) return;
        setPages(loadedPages);
        // 문서가 바뀌면 이전 문서 기준의 검색 결과 캐시 무효화
        setCachedSearchResults(new Map());
      } catch (error) {
        if (!cancelled) {
          console.error("PDF 로딩 에러:", error);
        }
      }
    };
    loadPdfPages();

    return () => {
      cancelled = true;
    };
  }, [pdf]);

  const getSearchResult = useCallback(
    (searchText: string) => {
      try {
        if (cachedSearchResults.has(searchText)) {
          return cachedSearchResults.get(searchText) ?? [];
        }

        const regex = new RegExp(escapeRegExp(searchText), "gi");
        const results = pages.reduce<SearchResult[]>(
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

        setCachedSearchResults((prev) =>
          new Map(prev).set(searchText, results)
        );
        return results;
      } catch (error) {
        console.error("검색 에러:", error);
        return [];
      }
    },
    [cachedSearchResults, pages]
  );

  return {
    getSearchResult,
  };
};
