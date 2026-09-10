import { type RefObject, type UIEvent, useCallback, useLayoutEffect, useRef } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import type { ReactZoomPanPinchContentRef } from "react-zoom-pan-pinch";
import type { ListImperativeAPI } from "react-window";
import { currentViewingPageAtom, documentSessionAtom } from "../store/pdf";
import { getPageAtOffset } from "../libs/utils/pageLayout";

interface Props {
  listRef: RefObject<ListImperativeAPI | null>;
  scaleRef: RefObject<ReactZoomPanPinchContentRef | null>;
  pageOffsets: number[];
  viewportHeight: number;
}

export function usePdfViewingPage({ listRef, scaleRef, pageOffsets, viewportHeight }: Props) {
  const store = useStore();
  const documentSession = useAtomValue(documentSessionAtom);
  const setCurrentViewingPage = useSetAtom(currentViewingPageAtom);
  const scrollOffset = useRef(0);
  const raf = useRef<number | null>(null);
  const mounted = useRef(false);

  const updateViewingPage = useCallback(() => {
    // 새 문서로 교체된 뒤 이전 컴포넌트의 정리가 지연되어도 번호를 덮어쓰지 않는다.
    if (store.get(documentSessionAtom) !== documentSession) return;
    const transform = scaleRef.current?.state;
    const zoom = transform?.scale ?? 1;
    const top = scrollOffset.current - (transform?.positionY ?? 0) / zoom;
    const bottom = top + viewportHeight / zoom;
    const lastPage = Math.max(1, pageOffsets.length - 1);
    setCurrentViewingPage(
      top > 0 && bottom >= pageOffsets[lastPage] - 5 / zoom
        ? lastPage
        : getPageAtOffset(pageOffsets, top + 5 / zoom),
    );
  }, [documentSession, pageOffsets, scaleRef, setCurrentViewingPage, store, viewportHeight]);

  const scheduleUpdate = useCallback(() => {
    if (!mounted.current || raf.current !== null) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = null;
      // 핀치 중 scrollTop을 읽으면 밀린 스타일 계산이 동기로 실행될 수 있다.
      // 프레임에서는 최신 캐시와 transform만 읽는다.
      updateViewingPage();
    });
  }, [updateViewingPage]);

  const recordScrollOffset = useCallback((offset: number) => {
    scrollOffset.current = offset;
    scheduleUpdate();
  }, [scheduleUpdate]);

  const syncScrollPosition = useCallback(() => {
    const element = listRef.current?.element;
    // ref가 잠시 해제돼도 저장된 위치는 유지한다.
    if (element) recordScrollOffset(element.scrollTop);
  }, [listRef, recordScrollOffset]);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    recordScrollOffset(event.currentTarget.scrollTop);
  }, [recordScrollOffset]);

  const scrollToPage = useCallback((index: number) => {
    scaleRef.current?.resetTransform(0);
    listRef.current?.scrollToRow({ index, align: "start", behavior: "instant" });
    // scroll 이벤트가 오기 전에도 마지막 페이지의 clamp를 포함한 실제 위치를 반영한다.
    syncScrollPosition();
  }, [listRef, scaleRef, syncScrollPosition]);

  useLayoutEffect(() => {
    mounted.current = true;
    // 행 높이/화면 크기가 바뀌어 브라우저가 스크롤 위치를 보정한 경우도 반영한다.
    syncScrollPosition();
    return () => {
      mounted.current = false;
      if (raf.current !== null) {
        cancelAnimationFrame(raf.current);
        raf.current = null;
      }
    };
  }, [syncScrollPosition]);

  return { scheduleUpdate, recordScrollOffset, syncScrollPosition, onScroll, scrollToPage };
}
