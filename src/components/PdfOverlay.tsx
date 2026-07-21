import clsx from "clsx";
import {
  Close,
  Drawing,
  Eraser,
  FullScreen,
  Hightlighter,
  Pen,
  PenMode,
  SmallScreen,
  Stroke,
  Stroke1Step,
  Stroke2Step,
  Stroke3Step,
  Stroke4Step,
  Stroke5Step,
  ThumbnailList,
  TouchMode,
  Trash,
  Zoom,
} from "../assets/icons";
import { Dispatch, SetStateAction, useState } from "react";
import {
  __DEV__,
  colorMap,
  createOrMergePdf,
  getModifiedPDFBase64,
} from "../libs/utils/common";
import { DrawType, PathsType, TouchType } from "../libs/types/common";
import ColorPicker from "./ColorPicker";
import { useAtom } from "jotai";
import { fileAtom, pdfConfigAtom, pdfStateAtom } from "../store/pdf";
import { useTranslation } from "../hooks/useTranslation";

interface Props {
  paths: React.RefObject<{ [pageNumber: number]: PathsType[] }>;
  drawType: DrawType;
  color: (typeof colorMap)[number];
  touchType: TouchType;
  setTouchType: Dispatch<SetStateAction<TouchType>>;
  setCanDraw: Dispatch<SetStateAction<boolean>>;
  setDrawType: Dispatch<SetStateAction<DrawType>>;
  setColor: Dispatch<SetStateAction<(typeof colorMap)[number]>>;
  onEraseAllClick: () => void;
  currentViewingPage: number;
  isWrongTouch: boolean;
  setIsWrongTouch: Dispatch<SetStateAction<boolean>>;
}

const STROKE_STEPS = [
  { step: 28, Icon: Stroke5Step },
  { step: 22, Icon: Stroke4Step },
  { step: 16, Icon: Stroke3Step },
  { step: 10, Icon: Stroke2Step },
  { step: 4, Icon: Stroke1Step },
];

const PdfOverlay = ({
  paths,
  drawType,
  color,
  touchType,
  setTouchType,
  setCanDraw,
  setDrawType,
  setColor,
  onEraseAllClick,
  currentViewingPage,
  isWrongTouch,
  setIsWrongTouch,
}: Props) => {
  const { t } = useTranslation();
  const [zoomEnabled, setZoomEnabled] = useState(false);
  const [file, setFile] = useAtom(fileAtom);
  const [pdfState, setPdfState] = useAtom(pdfStateAtom);
  const [pdfConfig, setPdfConfig] = useAtom(pdfConfigAtom);

  return (
    <div className="fixed left-0 right-0 top-0 bottom-0 flex flex-col justify-between px-[20px] py-[20px] pointer-events-none">
      <div className="flex h-[40px] justify-between items-center">
        <button
          onClick={() => {
            setPdfState((prev) => ({
              ...prev,
              isListOpen: true,
            }));
          }}
          className="pointer-events-auto h-[40px] rounded-[10px] bg-[#202325]/70 flex items-center pl-[2px] pr-3 gap-2"
        >
          <div className="size-[36px] bg-white rounded-lg flex-center">
            <ThumbnailList />
          </div>
          <span className="text-white text-lg">{`${currentViewingPage}/${pdfState.totalPage}`}</span>
        </button>
        <button
          onClick={() => {
            setPdfState((prev) => ({
              ...prev,
              isFullScreen: !prev.isFullScreen,
            }));
            if (window.AndroidInterface) {
              window.AndroidInterface.setFullMode(!pdfState.isFullScreen);
            }
          }}
          className="pointer-events-auto size-[40px] rounded-lg bg-white shadow-black shadow-sm flex-center"
        >
          {pdfState.isFullScreen ? <SmallScreen /> : <FullScreen />}
        </button>
      </div>

      {file.type === "pdf" && (
        <div className="flex h-[56px] justify-center">
          {!pdfState.isToolBarOpen && (
            <>
              <button
                onClick={() => {
                  setCanDraw((prev) => !prev);
                  setPdfState((prev) => ({
                    ...prev,
                    isToolBarOpen: true,
                  }));
                }}
                className="pointer-events-auto w-[106px] h-[52px] rounded-xl bg-white shadow-black shadow-sm flex-center gap-[9px]"
              >
                <Drawing />
                {t("draw")}
              </button>

              {__DEV__ && (
                <>
                  <button
                    onClick={async () => {
                      if (pdfState.totalPage === 5) {
                        alert("최대 5페이지까지 추가 가능합니다.");
                        return;
                      }
                      const newBase64 = await createOrMergePdf(file.base64);
                      setPdfState((prev) => ({
                        ...prev,
                        pageNumber: prev.totalPage + 1,
                        totalPage: prev.totalPage + 1,
                      }));
                      setFile((prev) => ({
                        ...prev,
                        base64: newBase64,
                      }));
                    }}
                    className="pointer-events-auto w-[106px] h-[52px] rounded-xl bg-white shadow-black shadow-sm flex-center gap-[9px]"
                  >
                    페이지 추가
                  </button>
                  <button
                    onClick={async () => {
                      await getModifiedPDFBase64(paths.current, file.base64);
                    }}
                    className="pointer-events-auto w-[106px] h-[52px] rounded-xl bg-white shadow-black shadow-sm flex-center gap-[9px]"
                  >
                    저장
                  </button>
                </>
              )}
            </>
          )}

          {pdfState.isToolBarOpen && (
            <div className="h-[56px] bg-white rounded-xl flex items-center px-[8px] shadow-black shadow-sm">
              <div className="w-[140px] flex justify-between">
                <button
                  onClick={() => {
                    setCanDraw(true);
                    setDrawType("pen");
                    setZoomEnabled(false);
                  }}
                  className={clsx(
                    "pointer-events-auto size-[44px] rounded-lg flex-center",
                    drawType === "pen" && !zoomEnabled
                      ? "bg-[#5865FA]"
                      : "#ffffff"
                  )}
                >
                  <Pen
                    color={
                      drawType === "pen" && !zoomEnabled ? "#ffffff" : "#353B45"
                    }
                  />
                </button>
                <button
                  onClick={() => {
                    setCanDraw(true);
                    setDrawType("highlight");
                    setZoomEnabled(false);
                  }}
                  className={clsx(
                    "pointer-events-auto size-[44px] rounded-lg flex-center",
                    drawType === "highlight" && !zoomEnabled
                      ? "bg-[#5865FA]"
                      : "#ffffff"
                  )}
                >
                  <Hightlighter
                    color={
                      drawType === "highlight" && !zoomEnabled
                        ? "#ffffff"
                        : "#353B45"
                    }
                  />
                </button>
                <button
                  onClick={() => {
                    setCanDraw(true);
                    setDrawType("eraser");
                    setZoomEnabled(false);
                  }}
                  className={clsx(
                    "pointer-events-auto size-[44px] rounded-lg flex-center",
                    drawType === "eraser" && !zoomEnabled
                      ? "bg-[#5865FA]"
                      : "#ffffff"
                  )}
                >
                  <Eraser
                    color={
                      drawType === "eraser" && !zoomEnabled
                        ? "#ffffff"
                        : "#353B45"
                    }
                  />
                </button>
              </div>
              <div className="w-[1px] h-[40px] bg-[#EEEFF3] mx-[8px]" />
              {drawType !== "eraser" ? (
                <>
                  <ColorPicker onColorSelect={setColor} selectedColor={color} />
                  <div className="w-[1px] h-[40px] bg-[#EEEFF3] mx-[8px]" />
                  <div className="relative flex-center">
                    <button
                      onClick={() => {
                        setPdfState((prev) => ({
                          ...prev,
                          isStrokeOpen: !prev.isStrokeOpen,
                        }));
                      }}
                      className={clsx(
                        "pointer-events-auto size-[44px] rounded-lg flex-center",
                        pdfState.isStrokeOpen ? "bg-[#EEEFF3]" : "#ffffff"
                      )}
                    >
                      <Stroke />
                    </button>
                    {pdfState.isStrokeOpen && (
                      <div className="bg-white w-[60px] h-[236px] absolute bottom-[64px] left-1/2 -translate-x-1/2 rounded-lg shadow-black shadow-sm flex flex-col justify-center items-center">
                        {STROKE_STEPS.map(({ step, Icon }) => (
                          <button
                            key={step}
                            onClick={() => {
                              setPdfConfig((prev) => ({
                                ...prev,
                                strokeStep: step,
                              }));
                              setPdfState((prev) => ({
                                ...prev,
                                isStrokeOpen: false,
                              }));
                            }}
                            className="pointer-events-auto size-[44px] flex-center"
                          >
                            <Icon
                              color={
                                pdfConfig.strokeStep === step
                                  ? color
                                  : "#BCC2CB"
                              }
                            />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <button
                  onClick={onEraseAllClick}
                  className="pointer-events-auto flex gap-x-2 px-[10px]"
                >
                  <Trash />
                  <span className="text-[#353B45]">{t("delete_all")}</span>
                </button>
              )}
              <div className="w-[1px] h-[40px] bg-[#EEEFF3] mx-[8px]" />
              <button
                onClick={() => {
                  setCanDraw(true);
                  setZoomEnabled(false);
                  setTouchType((prev) => {
                    const newTouchType = prev === "pen" ? "touch" : "pen";
                    localStorage.setItem("TOUCH_TYPE", newTouchType);
                    return newTouchType;
                  });
                }}
                className={clsx(
                  "pointer-events-auto w-[78px] h-[44px] rounded-lg bg-[#EEEFF3] flex items-center px-[4px]",
                  isWrongTouch ? "animate-[blink_0.4s_1]" : "bg-[#EEEFF3]"
                )}
                onAnimationEnd={() => setIsWrongTouch(false)}
              >
                <div
                  className={clsx(
                    "size-[36px] bg-white rounded-md shadow flex-center transition-transform duration-300",
                    touchType === "pen" ? "translate-x-0" : "translate-x-[34px]"
                  )}
                >
                  {touchType === "pen" ? <PenMode /> : <TouchMode />}
                </div>
              </button>
              <button
                onClick={() => {
                  setCanDraw(zoomEnabled ? true : false);
                  setZoomEnabled((prev) => !prev);
                }}
                className={clsx(
                  "pointer-events-auto size-[44px] rounded-lg flex-center ml-[8px]",
                  zoomEnabled ? "bg-[#5865FA]" : "#ffffff"
                )}
              >
                <Zoom color={zoomEnabled ? "#ffffff" : "#353B45"} />
              </button>
              <div className="w-[1px] h-[40px] bg-[#EEEFF3] mx-[8px]" />
              <button
                onClick={() => {
                  setCanDraw(false);
                  setPdfState((prev) => ({
                    ...prev,
                    isToolBarOpen: false,
                  }));
                  setDrawType("pen");
                }}
                className="pointer-events-auto size-[44px] flex-center"
              >
                <Close />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PdfOverlay;
