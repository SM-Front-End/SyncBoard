import type { Languages } from "../../components/TranslationContext";
import { colorMap } from "./common";

const DOCUMENT_ORIGIN = "https://appassets.androidplatform.net";
const DOCUMENT_PATH_PATTERN = /^\/doc\/[A-Za-z0-9_-]+(?:\.pdf)?$/;

type JsonRecord = Record<string, unknown>;

export type WebviewFileSource =
  | { kind: "base64"; base64: string }
  | { kind: "url"; url: string };

export interface WebviewFileData {
  type: string;
  source: WebviewFileSource | null;
  paths: string;
  lang: Languages;
  isNew: boolean;
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseLanguage = (value: unknown): Languages => {
  if (value === "en" || value === "zh") return value;
  return "ko";
};

const requireNonEmptyString = (value: unknown, fieldName: string) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${fieldName} 값이 필요합니다.`);
  }
  return value;
};

const parsePaths = (value: unknown) => {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new Error("data.paths 형식이 올바르지 않습니다.");
  }
  if (value.trim() === "") return "";

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("data.paths JSON이 올바르지 않습니다.");
  }
  if (!isRecord(parsed)) {
    throw new Error("data.paths는 페이지별 필기 목록이어야 합니다.");
  }
  for (const [pageNumber, paths] of Object.entries(parsed)) {
    if (
      !/^[1-9]\d*$/.test(pageNumber) ||
      !Number.isSafeInteger(Number(pageNumber)) ||
      !Array.isArray(paths)
    ) {
      throw new Error("data.paths 페이지 형식이 올바르지 않습니다.");
    }
    for (const path of paths) {
      if (
        !isRecord(path) ||
        !["x", "y", "lastX", "lastY", "lineWidth", "alpha"].every(
          (key) => typeof path[key] === "number" && Number.isFinite(path[key]),
        ) ||
        Number(path.lineWidth) < 0 ||
        Number(path.alpha) < 0 ||
        Number(path.alpha) > 1 ||
        typeof path.drawOrder !== "string" ||
        path.drawOrder.length === 0 ||
        typeof path.color !== "string" ||
        !colorMap.some((color) => color === path.color)
      ) {
        throw new Error("data.paths 필기 좌표 또는 스타일이 올바르지 않습니다.");
      }
    }
  }
  return value;
};

export const validateDocumentUrl = (value: unknown) => {
  const input = requireNonEmptyString(value, "data.source.url");
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    throw new Error("유효하지 않은 문서 URL입니다.");
  }

  const isAllowedOrigin =
    url.origin === DOCUMENT_ORIGIN &&
    url.protocol === "https:" &&
    url.hostname === "appassets.androidplatform.net" &&
    url.port === "" &&
    url.username === "" &&
    url.password === "";
  const isAllowedPath = DOCUMENT_PATH_PATTERN.test(url.pathname);

  if (url.search || url.hash || !isAllowedOrigin || !isAllowedPath) {
    throw new Error("허용되지 않은 문서 URL입니다.");
  }

  return url.toString();
};

const parseSource = (value: unknown): WebviewFileSource => {
  if (!isRecord(value)) {
    throw new Error("data.source 형식이 올바르지 않습니다.");
  }

  if (value.kind === "url") {
    return { kind: "url", url: validateDocumentUrl(value.url) };
  }

  if (value.kind === "base64") {
    return {
      kind: "base64",
      base64: requireNonEmptyString(
        value.base64,
        "data.source.base64",
      ),
    };
  }

  throw new Error("지원하지 않는 data.source.kind입니다.");
};

export const parseWebviewFileData = (appData: string): WebviewFileData => {
  const payload: unknown = JSON.parse(appData);
  if (!isRecord(payload) || !isRecord(payload.data)) {
    throw new Error("data 객체가 필요합니다.");
  }

  const data = payload.data;
  const isNew = data.isNew === true;
  const type = isNew
    ? typeof data.type === "string" && data.type.length > 0
      ? data.type.toLowerCase()
      : "pdf"
    : requireNonEmptyString(data.type, "data.type").toLowerCase();
  const paths = parsePaths(data.paths);

  if (isNew) {
    return {
      type: "pdf",
      source: null,
      paths,
      lang: parseLanguage(data.lang),
      isNew: true,
    };
  }

  const hasSource = data.source !== undefined && data.source !== null;
  // source가 있으면 새 계약을 우선한다. 전환 중인 네이티브가 기존 base64 필드를
  // 함께 남겨 보내더라도 URL 로드를 막지 않되, 잘못된 source를 base64로 숨기지는 않는다.
  const source = hasSource
    ? parseSource(data.source)
    : {
        kind: "base64" as const,
        base64: requireNonEmptyString(data.base64, "data.base64"),
      };

  if (source.kind === "url" && type !== "pdf") {
    throw new Error("URL 입력은 PDF 형식만 지원합니다.");
  }

  return {
    type,
    source,
    paths,
    lang: parseLanguage(data.lang),
    isNew: false,
  };
};
