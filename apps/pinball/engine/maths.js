// Geometry helpers, ported from maths.cpp. Structures are plain objects:
//   vector_type    { X, Y, Z }
//   rectangle_type { XPosition, YPosition, Width, Height }
//   circle_type    { Center, RadiusSq }
//   ray_type       { Origin, Direction, MaxDistance, MinDistance, TimeNow, TimeDelta, FieldFlag }
//   line_type      { PerpendicularL, Direction, PreComp1, OriginX, OriginY, RayIntersect }

export const NO_HIT = 1000000000.0;

export const vec = (X = 0, Y = 0, Z = 0) => ({ X, Y, Z });
export const copyVec = v => ({ X: v.X, Y: v.Y, Z: v.Z ?? 0 });
export const rect = (x = 0, y = 0, w = 0, h = 0) => ({ XPosition: x, YPosition: y, Width: w, Height: h });
export const copyRect = r => ({ XPosition: r.XPosition, YPosition: r.YPosition, Width: r.Width, Height: r.Height });
export const ray = () => ({
  Origin: vec(), Direction: vec(), MaxDistance: 0, MinDistance: 0, TimeNow: 0, TimeDelta: 0, FieldFlag: 0,
});
export const line = () => ({
  PerpendicularL: vec(), Direction: vec(), PreComp1: 0, OriginX: 0, OriginY: 0, RayIntersect: vec(),
});
export const circle = (center = vec(), radiusSq = 0) => ({ Center: copyVec(center), RadiusSq: radiusSq });

// Reads a vector_type out of a float array, as the original reinterpret_casts do.
export const vecAt = (arr, offset = 0) => vec(arr[offset], arr[offset + 1], arr[offset + 2] ?? 0);

export function enclosing_box(rect1, rect2, dstRect) {
  let xPos1 = rect1.XPosition;
  let yPos1 = rect1.YPosition;
  let width1 = rect1.Width;
  let height1 = rect1.Height;
  const xPos2 = rect2.XPosition;
  const yPos2 = rect2.YPosition;
  const width2 = rect2.Width;
  const height2 = rect2.Height;
  if (xPos2 < xPos1) {
    width1 += xPos1 - xPos2;
    xPos1 = xPos2;
  }
  if (yPos2 < yPos1) {
    height1 += yPos1 - yPos2;
    yPos1 = yPos2;
  }
  if (width2 + xPos2 > xPos1 + width1) width1 = xPos2 + width2 - xPos1;
  let height1b = height1;
  if (height2 + yPos2 > height1 + yPos1) height1b = yPos2 + height2 - yPos1;
  dstRect.YPosition = yPos1;
  dstRect.Height = height1b;
  dstRect.XPosition = xPos1;
  dstRect.Width = width1;
}

export function rectangle_clip(rect1, rect2, dstRect) {
  let xPos1 = rect1.XPosition;
  const yPos1 = rect1.YPosition;
  const height1 = rect1.Height;
  const xRight2 = rect2.XPosition + rect2.Width;
  let width1 = rect1.Width;
  const yRight2 = rect2.YPosition + rect2.Height;
  if (xPos1 + width1 < rect2.XPosition) return 0;
  if (xPos1 >= xRight2) return 0;
  let yPos2 = yPos1;
  if (yPos1 + height1 < rect2.YPosition || yPos1 >= yRight2) return 0;
  if (xPos1 < rect2.XPosition) {
    width1 += xPos1 - rect2.XPosition;
    xPos1 = rect2.XPosition;
  }
  if (xPos1 + width1 > xRight2) width1 = xRight2 - xPos1;
  let height2 = height1;
  if (yPos1 < rect2.YPosition) {
    height2 = yPos1 - rect2.YPosition + height1;
    yPos2 = rect2.YPosition;
  }
  if (height2 + yPos2 > yRight2) height2 = yRight2 - yPos2;
  if (!width1 || !height2) return 0;
  if (dstRect) {
    dstRect.XPosition = xPos1;
    dstRect.YPosition = yPos2;
    dstRect.Width = width1;
    dstRect.Height = height2;
  }
  return 1;
}

export function ray_intersect_circle(r, c) {
  const Lx = c.Center.X - r.Origin.X;
  const Ly = c.Center.Y - r.Origin.Y;
  const Tca = Ly * r.Direction.Y + Lx * r.Direction.X;
  if (Tca < 0) return NO_HIT;
  const LMagSq = Ly * Ly + Lx * Lx;
  if (LMagSq < c.RadiusSq) return Tca - Math.sqrt(c.RadiusSq - LMagSq + Tca * Tca);
  const ThcSq = c.RadiusSq - LMagSq + Tca * Tca;
  if (ThcSq < 0) return NO_HIT;
  const T0 = Tca - Math.sqrt(ThcSq);
  if (T0 < 0 || T0 > r.MaxDistance) return NO_HIT;
  return T0;
}

export function normalize_2d(v) {
  const mag = Math.sqrt(v.X * v.X + v.Y * v.Y);
  if (mag !== 0) {
    v.X = (1 / mag) * v.X;
    v.Y = (1 / mag) * v.Y;
  }
  return mag;
}

export function line_init(l, x0, y0, x1, y1) {
  let v9;
  let lineDirection;
  let v11;
  l.Direction.X = x1 - x0;
  l.Direction.Y = y1 - y0;
  normalize_2d(l.Direction);
  l.PerpendicularL.X = l.Direction.Y;
  l.PerpendicularL.Y = -l.Direction.X;
  l.PreComp1 = -(l.Direction.Y * x0) + l.Direction.X * y0;
  if (l.Direction.X >= 0.000000001 || l.Direction.X <= -0.000000001) {
    v9 = x1;
    lineDirection = x0 >= x1;
    v11 = x0;
  } else {
    l.Direction.X = 0;
    v9 = y1;
    lineDirection = y0 >= y1;
    v11 = y0;
  }
  if (lineDirection) {
    l.OriginX = v9;
    l.OriginY = v11;
  } else {
    l.OriginY = v9;
    l.OriginX = v11;
  }
}

export function ray_intersect_line(r, l) {
  const perpDot = l.PerpendicularL.Y * r.Direction.Y + r.Direction.X * l.PerpendicularL.X;
  if (perpDot < 0) {
    const result = -((r.Origin.X * l.PerpendicularL.X + r.Origin.Y * l.PerpendicularL.Y + l.PreComp1) / perpDot);
    if (result >= -r.MinDistance && result <= r.MaxDistance) {
      l.RayIntersect.X = result * r.Direction.X + r.Origin.X;
      const v4 = result * r.Direction.Y + r.Origin.Y;
      l.RayIntersect.Y = v4;
      if (l.Direction.X === 0) {
        if (v4 >= l.OriginX) {
          return v4 <= l.OriginY ? result : NO_HIT;
        }
      } else if (l.OriginX <= l.RayIntersect.X) {
        return l.RayIntersect.X <= l.OriginY ? result : NO_HIT;
      }
    }
  }
  return NO_HIT;
}

export function cross(v1, v2, dst) {
  dst.X = v2.Z * v1.Y - v2.Y * v1.Z;
  dst.Y = v2.X * v1.Z - v1.X * v2.Z;
  dst.Z = v1.X * v2.Y - v2.X * v1.Y;
}

export function magnitude(v) {
  const magSq = v.X * v.X + v.Y * v.Y + v.Z * v.Z;
  return magSq === 0 ? 0 : Math.sqrt(magSq);
}

export function vector_add(v1Dst, v2) {
  v1Dst.X += v2.X;
  v1Dst.Y += v2.Y;
}

export function basic_collision(ball, nextPosition, direction, elasticity, smoothness, threshold, boost) {
  ball.Position.X = nextPosition.X;
  ball.Position.Y = nextPosition.Y;
  let proj = -(direction.Y * ball.Acceleration.Y + direction.X * ball.Acceleration.X);
  if (proj < 0) {
    proj = -proj;
  } else {
    const dx1 = proj * direction.X;
    const dy1 = proj * direction.Y;
    ball.Acceleration.X = (dx1 + ball.Acceleration.X) * smoothness + dx1 * elasticity;
    ball.Acceleration.Y = (dy1 + ball.Acceleration.Y) * smoothness + dy1 * elasticity;
    normalize_2d(ball.Acceleration);
  }
  const projSpeed = proj * ball.Speed;
  const newSpeed = ball.Speed - (1 - elasticity) * projSpeed;
  ball.Speed = newSpeed;
  if (projSpeed >= threshold) {
    ball.Acceleration.X = newSpeed * ball.Acceleration.X + direction.X * boost;
    ball.Acceleration.Y = newSpeed * ball.Acceleration.Y + direction.Y * boost;
    ball.Speed = normalize_2d(ball.Acceleration);
  }
  return projSpeed;
}

export const Distance_Squared = (v1, v2) => (v1.Y - v2.Y) * (v1.Y - v2.Y) + (v1.X - v2.X) * (v1.X - v2.X);
export const DotProduct = (v1, v2) => v1.Y * v2.Y + v1.X * v2.X;

export function Distance(v1, v2) {
  const dx = v1.X - v2.X;
  const dy = v1.Y - v2.Y;
  return Math.sqrt(dy * dy + dx * dx);
}

export function RotatePt(point, sin, cos, origin) {
  const dirX = point.X - origin.X;
  const dirY = point.Y - origin.Y;
  point.X = dirX * cos - dirY * sin + origin.X;
  point.Y = dirX * sin + dirY * cos + origin.Y;
}

// Kept as in the original, which reuses the already rotated X when computing Y.
export function RotateVector(v, angle) {
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  v.X = c * v.X - s * v.Y;
  v.Y = s * v.X + c * v.Y;
}

// plane: { V1, V2, V3 } of {X, Y}; wall: [X0, Y0, X1, Y1]. Returns [lineEnd, lineStart].
export function find_closest_edge(planes, wall) {
  const wallStart = { X: wall[0], Y: wall[1] };
  const wallEnd = { X: wall[2], Y: wall[3] };
  let maxDistance = NO_HIT;
  let lineEnd = null;
  let lineStart = null;
  for (const plane of planes) {
    const v1 = plane.V1;
    const v2 = plane.V2;
    const v3 = plane.V3;
    let distance = Distance(wallStart, v1) + Distance(wallEnd, v2);
    if (distance < maxDistance) {
      maxDistance = distance;
      lineEnd = v1;
      lineStart = v2;
    }
    distance = Distance(wallStart, v2) + Distance(wallEnd, v3);
    if (distance < maxDistance) {
      maxDistance = distance;
      lineEnd = v2;
      lineStart = v3;
    }
    distance = Distance(wallStart, v3) + Distance(wallEnd, v1);
    if (distance < maxDistance) {
      maxDistance = distance;
      lineEnd = v3;
      lineStart = v1;
    }
  }
  return [lineEnd, lineStart];
}

// C rand() with MSVC's RAND_MAX, and the port's RandFloat().
export const RAND_MAX = 32767;
export const crand = () => Math.floor(Math.random() * (RAND_MAX + 1));
export const RandFloat = () => crand() / RAND_MAX;
