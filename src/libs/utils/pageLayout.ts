import type { PageSize, PdfDocumentType } from "../types/common";
import { getReducedPdfSize } from "./common";

export async function getPdfPageSizes(pdf: PdfDocumentType): Promise<PageSize[]> {
  const sizes: PageSize[] = [];
  for (let start = 0; start < pdf.numPages; start += 10) {
    const chunk = await Promise.all(
      Array.from({ length: Math.min(10, pdf.numPages - start) }, async (_, offset) => {
        const page = await pdf.getPage(start + offset + 1);
        const { width, height } = page.getViewport({ scale: 1 });
        return { width, height };
      }),
    );
    sizes.push(...chunk);
  }
  return sizes;
}

export function fitPageSize(page: PageSize, width: number, height: number): PageSize {
  const reduced = getReducedPdfSize(page.width, page.height, Math.max(1, width - 128), Math.max(1, height - 84));
  // PDF 캔버스의 CSS 크기와 동일하게 정수로 맞춘다.
  const fittedWidth = Math.max(1, Math.floor(reduced.width));
  return {
    width: fittedWidth,
    height: Math.max(1, Math.floor(page.height * (fittedWidth / page.width))),
  };
}

export function getPageOffsets(pageSizes: PageSize[]): number[] {
  const offsets = [0];
  for (const page of pageSizes) {
    offsets.push(offsets[offsets.length - 1] + page.height + 10);
  }
  return offsets;
}

export function getPageAtOffset(offsets: number[], offset: number): number {
  let low = 0;
  let high = Math.max(0, offsets.length - 2);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (offsets[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}
