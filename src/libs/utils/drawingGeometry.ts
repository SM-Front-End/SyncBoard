import { distancePointToSegment } from "./common";

// 포인터 이벤트 사이의 이동 전체를 검사한다. 교차하지 않는 두 선분의 최단
// 거리는 끝점에서 반대편 선분까지의 거리 중 하나이며, 길이가 0인 선분도 포함한다.
export const distanceSegmentToSegment = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number
) => {
  const abX = bx - ax;
  const abY = by - ay;
  const cdX = dx - cx;
  const cdY = dy - cy;
  const determinant = abX * cdY - abY * cdX;

  if (determinant !== 0) {
    const acX = cx - ax;
    const acY = cy - ay;
    const t = (acX * cdY - acY * cdX) / determinant;
    const u = (acX * abY - acY * abX) / determinant;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }

  return Math.min(
    distancePointToSegment(ax, ay, cx, cy, dx, dy),
    distancePointToSegment(bx, by, cx, cy, dx, dy),
    distancePointToSegment(cx, cy, ax, ay, bx, by),
    distancePointToSegment(dx, dy, ax, ay, bx, by)
  );
};
