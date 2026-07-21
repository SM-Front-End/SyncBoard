/* eslint-disable @typescript-eslint/ban-ts-comment */
import { useState, useEffect, useCallback } from "react";
import { pdfjs } from "react-pdf";
import { escapeRegExp } from "../libs/utils/common";

interface SearchResult {
  pageNumber: number;
}

export const usePdfTextSearch = (file: string) => {
  const [pages, setPages] = useState<string[]>([]);
  const [cachedSearchResults, setCachedSearchResults] = useState<
    Map<string, SearchResult[]>
  >(new Map());

  const loadPdfPages = useCallback(async () => {
    try {
      const docData = await pdfjs.getDocument(file).promise;
      const pageCount = docData._pdfInfo.numPages;

      const pagePromises = Array.from({ length: pageCount }, async (_, i) => {
        const pageNum = i + 1;
        const page = await docData.getPage(pageNum);
        const textContent = await page.getTextContent();
        //@ts-ignore
        return textContent.items.map(({ str }) => str).join(" ");
      });

      const loadedPages = await Promise.all(pagePromises);
      setPages(loadedPages);
    } catch (error) {
      console.error("PDF 로딩 에러:", error);
    }
  }, [file]);

  useEffect(() => {
    if (file) {
      loadPdfPages();
    }
  }, [file, loadPdfPages]);

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
