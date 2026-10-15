// Collision edges and the spatial grid, ported from TEdgeManager.cpp,
// TEdgeSegment.cpp, TLine.cpp, TCircle.cpp, TFlipperEdge.cpp and the edge
// insertion helpers of TTableLayer.cpp.
//
// An edge's "active flag" is a reference to a field of its owner (the
// original stores a char pointer): { obj, key }.

import {
  NO_HIT, vec, copyVec, ray as newRay, line as newLine, circle as newCircle,
  ray_intersect_circle, ray_intersect_line, line_init, normalize_2d, cross,
  Distance_Squared, DotProduct, Distance, RotatePt, basic_collision,
} from './maths.js';

export const flagRef = (obj, key = 'ActiveFlag') => ({ obj, key });

// ---------- TEdgeManager ----------

export class TEdgeManager {
  constructor(posX, posY, width, height) {
    this.X = posX;
    this.Y = posY;
    this.MaxBoxX = 10;
    this.MaxBoxY = 15;
    this.AdvanceX = width / 10;
    this.AdvanceY = height / 15;
    this.AdvanceXInv = 1 / this.AdvanceX;
    this.AdvanceYInv = 1 / this.AdvanceY;
    this.BoxArray = Array.from({ length: 150 }, () => ({ EdgeList: [], FieldList: [] }));
    this.EdgeArray = [];
  }

  box_x(x) {
    return Math.max(0, Math.min(Math.floor((x - this.X) * this.AdvanceXInv), this.MaxBoxX - 1));
  }

  box_y(y) {
    return Math.max(0, Math.min(Math.floor((y - this.Y) * this.AdvanceYInv), this.MaxBoxY - 1));
  }

  increment_box_x(x) {
    return Math.min(x + 1, this.MaxBoxX - 1);
  }

  increment_box_y(y) {
    return Math.min(y + 1, this.MaxBoxY - 1);
  }

  add_edge_to_box(x, y, edge) {
    if (x < 0 || x >= this.MaxBoxX || y < 0 || y >= this.MaxBoxY) return;
    this.BoxArray[x + y * this.MaxBoxX].EdgeList.push(edge);
  }

  add_field_to_box(x, y, field) {
    this.BoxArray[x + y * this.MaxBoxX].FieldList.push(field);
  }

  TestGridBox(x, y, state, rayArg, ball) {
    if (x >= 0 && x < 10 && y >= 0 && y < 15) {
      const list = this.BoxArray[x + y * this.MaxBoxX].EdgeList;
      for (let i = list.length - 1; i >= 0; i--) {
        const edge = list[i];
        if (!edge.ProcessedFlag && edge.isActive() && (edge.CollisionGroup & rayArg.FieldFlag) && !ball.already_hit(edge)) {
          this.EdgeArray.push(edge);
          edge.ProcessedFlag = 1;
          const dist = edge.FindCollisionDistance(rayArg);
          if (dist < state.distance) {
            state.distance = dist;
            state.edge = edge;
          }
        }
      }
    }
  }

  FieldEffects(ball, dstVec) {
    const v = vec();
    const box = this.BoxArray[this.box_x(ball.Position.X) + this.box_y(ball.Position.Y) * this.MaxBoxX];
    for (let i = box.FieldList.length - 1; i >= 0; i--) {
      const field = box.FieldList[i];
      if (field.Flag2Ptr.obj[field.Flag2Ptr.key] && (ball.FieldFlag & field.Mask)) {
        if (field.CollisionComp.FieldEffect(ball, v)) {
          dstVec.X += v.X;
          dstVec.Y += v.Y;
        }
      }
    }
  }

  // Returns { distance, edge } for the nearest edge along the ray.
  FindCollisionDistance(rayArg, ball) {
    const state = { distance: NO_HIT, edge: null };
    this.EdgeArray.length = 0;

    const rayX = rayArg.Origin.X;
    const rayY = rayArg.Origin.Y;
    const rayBoxX = this.box_x(rayX);
    const rayBoxY = this.box_y(rayY);
    const rayEndX = rayArg.Direction.X * rayArg.MaxDistance + rayArg.Origin.X;
    const rayEndY = rayArg.Direction.Y * rayArg.MaxDistance + rayArg.Origin.Y;
    const rayEndBoxX = this.box_x(rayEndX);
    const rayEndBoxY = this.box_y(rayEndY);
    const rayDirX = rayX >= rayEndX ? -1 : 1;
    const rayDirY = rayY >= rayEndY ? -1 : 1;
    const test = (x, y) => this.TestGridBox(x, y, state, rayArg, ball);

    if (rayBoxY === rayEndBoxY) {
      if (rayDirX === 1) for (let x = rayBoxX; x <= rayEndBoxX; x++) test(x, rayBoxY);
      else for (let x = rayBoxX; x >= rayEndBoxX; x--) test(x, rayBoxY);
    } else if (rayBoxX === rayEndBoxX) {
      if (rayDirY === 1) for (let y = rayBoxY; y <= rayEndBoxY; y++) test(rayBoxX, y);
      else for (let y = rayBoxY; y >= rayEndBoxY; y--) test(rayBoxX, y);
    } else {
      const { AdvanceX, AdvanceY, X, Y } = this;
      const rayDyDX = (rayY - rayEndY) / (rayX - rayEndX);
      let indexX = rayBoxX;
      let indexY = rayBoxY;
      let bresIndexX = rayBoxX + 1;
      let bresIndexY = rayBoxY + 1;
      const bresXAdd = rayY - rayDyDX * rayX;
      test(rayBoxX, rayBoxY);
      if (rayDirX === 1) {
        if (rayDirY === 1) {
          do {
            const yCoord = bresIndexY * AdvanceY + Y;
            const xCoord = (bresIndexX * AdvanceX + X) * rayDyDX + bresXAdd;
            if (xCoord >= yCoord) {
              if (xCoord === yCoord) {
                ++indexX;
                ++bresIndexX;
              }
              ++indexY;
              ++bresIndexY;
            } else {
              ++indexX;
              ++bresIndexX;
            }
            test(indexX, indexY);
          } while (indexX < rayEndBoxX || indexY < rayEndBoxY);
        } else {
          do {
            const yCoord = indexY * AdvanceY + Y;
            const xCoord = (bresIndexX * AdvanceX + X) * rayDyDX + bresXAdd;
            if (xCoord <= yCoord) {
              if (xCoord === yCoord) {
                ++indexX;
                ++bresIndexX;
              }
              --indexY;
            } else {
              ++indexX;
              ++bresIndexX;
            }
            test(indexX, indexY);
          } while (indexX < rayEndBoxX || indexY > rayEndBoxY);
        }
      } else if (rayDirY === 1) {
        do {
          const yCoord = bresIndexY * AdvanceY + Y;
          const xCoord = (indexX * AdvanceX + X) * rayDyDX + bresXAdd;
          if (xCoord >= yCoord) {
            if (xCoord === yCoord) --indexX;
            ++indexY;
            ++bresIndexY;
          } else {
            --indexX;
          }
          test(indexX, indexY);
        } while (indexX > rayEndBoxX || indexY < rayEndBoxY);
      } else {
        do {
          const yCoord = indexY * AdvanceY + Y;
          const xCoord = (indexX * AdvanceX + X) * rayDyDX + bresXAdd;
          if (xCoord <= yCoord) {
            if (xCoord === yCoord) --indexX;
            --indexY;
          } else {
            --indexX;
          }
          test(indexX, indexY);
        } while (indexX > rayEndBoxX || indexY > rayEndBoxY);
      }
    }

    for (const edge of this.EdgeArray) edge.ProcessedFlag = 0;
    return state;
  }
}

// The grid shared by every edge (TTableLayer::edge_manager).
export const edges = { edge_manager: null };

// ---------- TTableLayer::edges_insert_square / edges_insert_circle ----------

export function edges_insert_square(y0, x0, y1, x1, edge, field) {
  const em = edges.edge_manager;
  const widthM = Math.trunc(em.AdvanceX * 0.001); // Sic
  const heightM = Math.trunc(em.AdvanceY * 0.001);
  const xMin = x0 - widthM;
  const xMax = x1 + widthM;
  const yMin = y0 - heightM;
  const yMax = y1 + heightM;

  const xMinBox = em.box_x(xMin);
  const yMinBox = em.box_y(yMin);
  const xMaxBox = em.box_x(xMax);
  const yMaxBox = em.box_y(yMax);

  let boxX = xMinBox * em.AdvanceX + em.X;
  for (let indexX = xMinBox; indexX <= xMaxBox; ++indexX) {
    let boxY = yMinBox * em.AdvanceY + em.Y;
    for (let indexY = yMinBox; indexY <= yMaxBox; ++indexY) {
      if (xMax >= boxX && xMin <= boxX + em.AdvanceX && yMax >= boxY && yMin <= boxY + em.AdvanceY) {
        if (edge) em.add_edge_to_box(indexX, indexY, edge);
        if (field) em.add_field_to_box(indexX, indexY, field);
      }
      boxY += em.AdvanceY;
    }
    boxX += em.AdvanceX;
  }
}

export function edges_insert_circle(c, edge, field) {
  const em = edges.edge_manager;
  const r = newRay();
  const radiusM = Math.sqrt(c.RadiusSq) + em.AdvanceX * 0.001;
  const radiusMSq = radiusM * radiusM;

  const xMin = c.Center.X - radiusM;
  const yMin = c.Center.Y - radiusM;
  const xMax = radiusM + c.Center.X;
  const yMax = radiusM + c.Center.Y;

  const xMinBox = em.box_x(xMin);
  const yMinBox = em.box_y(yMin);
  let xMaxBox = em.box_x(xMax);
  let yMaxBox = em.box_y(yMax);

  const dirX = xMinBox - 1 <= 0 ? 0 : xMinBox - 1;
  const dirY = yMinBox - 1 <= 0 ? 0 : yMinBox - 1;
  xMaxBox = em.increment_box_x(xMaxBox);
  yMaxBox = em.increment_box_y(yMaxBox);

  const hits = () => ray_intersect_circle(r, c) < NO_HIT;
  const v1 = vec(dirX * em.AdvanceX + em.X, 0);
  for (let indexX = dirX; indexX <= xMaxBox; ++indexX) {
    v1.Y = dirY * em.AdvanceY + em.Y;
    for (let indexY = dirY; indexY <= yMaxBox; ++indexY) {
      const v1XAdv = v1.X + em.AdvanceX;
      const v1YAdv = v1.Y + em.AdvanceY;
      if (xMax >= v1.X && xMin <= v1XAdv && yMax >= v1.Y && yMin <= v1YAdv) {
        let collision = true;
        do {
          if (c.Center.X <= v1XAdv && c.Center.X >= v1.X && c.Center.Y <= v1YAdv && c.Center.Y >= v1.Y) break;
          const v2 = copyVec(v1);
          if (Distance_Squared(v1, c.Center) <= radiusMSq) break;
          v2.X += em.AdvanceX;
          if (Distance_Squared(v2, c.Center) <= radiusMSq) break;
          v2.Y += em.AdvanceY;
          if (Distance_Squared(v2, c.Center) <= radiusMSq) break;
          v2.X -= em.AdvanceX;
          if (Distance_Squared(v2, c.Center) <= radiusMSq) break;

          r.Origin = copyVec(v1);
          r.Direction.X = 1;
          r.Direction.Y = 0;
          r.MaxDistance = em.AdvanceX;
          if (hits()) break;
          r.Direction.X = -1;
          r.Origin.X += em.AdvanceX;
          if (hits()) break;
          r.Direction.X = 0;
          r.Direction.Y = 1;
          r.MaxDistance = em.AdvanceY;
          if (hits()) break;
          r.Direction.Y = -1;
          r.Origin.Y += em.AdvanceY;
          if (hits()) break;
          r.Direction.Y = 0;
          r.Direction.X = -1;
          r.MaxDistance = em.AdvanceX;
          if (hits()) break;
          r.Direction.X = 1;
          r.Origin.X -= em.AdvanceX;
          if (hits()) break;
          r.Direction.X = 0;
          r.Direction.Y = -1;
          r.MaxDistance = em.AdvanceY;
          if (hits()) break;
          r.Direction.Y = 1;
          r.Origin.Y -= em.AdvanceY;
          if (hits()) break;
          collision = false;
        } while (false);
        if (collision) {
          if (edge) em.add_edge_to_box(indexX, indexY, edge);
          if (field) em.add_field_to_box(indexX, indexY, field);
        }
      }
      v1.Y += em.AdvanceY;
    }
    v1.X += em.AdvanceX;
  }
}

// ---------- TEdgeSegment ----------

export class TEdgeSegment {
  constructor(collComp, activeFlag, collisionGroup) {
    this.CollisionComponent = collComp;
    this.ActiveFlag = activeFlag;
    this.CollisionGroup = collisionGroup >>> 0;
    this.ProcessedFlag = 0;
    this.WallValue = null;
  }

  isActive() {
    return this.ActiveFlag.obj[this.ActiveFlag.key];
  }

  port_draw() {}

  // Builds a circle, a line or a closed polygon of lines (with corner
  // circles when offset) from a wall description: [type+1, points...].
  static install_wall(floatArr, collComp, activeFlag, collisionGroup, offset, wallValue) {
    let edge = null;
    const wallType = Math.trunc(Math.floor(floatArr[0]) - 1);
    if (wallType === 0) {
      const center = vec(floatArr[1], floatArr[2]);
      const c = new TCircle(collComp, activeFlag, collisionGroup, center, offset + floatArr[3]);
      c.WallValue = wallValue;
      c.place_in_grid();
      collComp.EdgeList.push(c);
      edge = c;
    } else if (wallType === 1) {
      const l = new TLine(collComp, activeFlag, collisionGroup, floatArr[1], floatArr[2], floatArr[3], floatArr[4]);
      l.WallValue = wallValue;
      l.Offset(offset);
      l.place_in_grid();
      collComp.EdgeList.push(l);
      edge = l;
    } else {
      const prevCenter = vec(floatArr[2 * wallType - 1], floatArr[2 * wallType]);
      const center = vec();
      const v1 = vec();
      const v2 = vec();
      const dst = vec();
      let ptr = 1;
      for (let index = 0; index < wallType; index++, ptr += 2) {
        let centerX2;
        let centerY2;
        if (index >= wallType - 1) {
          centerX2 = floatArr[1];
          centerY2 = floatArr[2];
        } else {
          centerX2 = floatArr[ptr + 2];
          centerY2 = floatArr[ptr + 3];
        }
        const centerX1 = floatArr[ptr];
        const centerY1 = floatArr[ptr + 1];
        center.X = centerX1;
        center.Y = centerY1;
        if (offset !== 0) {
          v1.X = centerX1 - prevCenter.X;
          v1.Y = center.Y - prevCenter.Y;
          v2.X = centerX2 - centerX1;
          v2.Y = centerY2 - center.Y;
          cross(v1, v2, dst);
          if ((dst.Z > 0 && offset > 0) || (dst.Z < 0 && offset < 0)) {
            const c = new TCircle(collComp, activeFlag, collisionGroup, center, offset * 1.001);
            c.WallValue = wallValue;
            c.place_in_grid();
            collComp.EdgeList.push(c);
          }
        }
        const l = new TLine(collComp, activeFlag, collisionGroup, floatArr[ptr], floatArr[ptr + 1], floatArr[ptr + 2], floatArr[ptr + 3]);
        l.WallValue = wallValue;
        l.Offset(offset);
        l.place_in_grid();
        collComp.EdgeList.push(l);
        edge = l;
        prevCenter.X = center.X;
        prevCenter.Y = center.Y;
      }
    }
    return edge;
  }
}

// ---------- TLine ----------

export class TLine extends TEdgeSegment {
  constructor(collComp, activeFlag, collisionGroup, x0, y0, x1, y1) {
    super(collComp, activeFlag, collisionGroup);
    this.X0 = x0;
    this.Y0 = y0;
    this.X1 = x1;
    this.Y1 = y1;
    this.Line = newLine();
    line_init(this.Line, x0, y0, x1, y1);
  }

  Offset(offset) {
    const offX = offset * this.Line.PerpendicularL.X;
    const offY = offset * this.Line.PerpendicularL.Y;
    this.X0 += offX;
    this.Y0 += offY;
    this.X1 += offX;
    this.Y1 += offY;
    line_init(this.Line, this.X0, this.Y0, this.X1, this.Y1);
  }

  FindCollisionDistance(r) {
    return ray_intersect_line(r, this.Line);
  }

  EdgeCollision(ball, coef) {
    this.CollisionComponent.Collision(ball, this.Line.RayIntersect, this.Line.PerpendicularL, coef, this);
  }

  // Walks the grid boxes along the line (Bresenham style). A guard stops the
  // walk if double precision ever steps past the end box.
  place_in_grid() {
    const em = edges.edge_manager;
    const { X0, Y0, X1, Y1 } = this;
    let xBox0 = em.box_x(X0);
    let yBox0 = em.box_y(Y0);
    const xBox1 = em.box_x(X1);
    const yBox1 = em.box_y(Y1);
    const dirX = X0 >= X1 ? -1 : 1;
    const dirY = Y0 >= Y1 ? -1 : 1;

    if (yBox0 === yBox1) {
      if (dirX === 1) while (xBox0 <= xBox1) em.add_edge_to_box(xBox0++, yBox0, this);
      else while (xBox0 >= xBox1) em.add_edge_to_box(xBox0--, yBox0, this);
      return;
    }
    if (xBox0 === xBox1) {
      if (dirY === 1) {
        while (yBox0 <= yBox1) em.add_edge_to_box(xBox0, yBox0++, this);
      } else {
        while (yBox0 >= yBox1) em.add_edge_to_box(xBox0, yBox0--, this);
      }
      return;
    }

    let indexX = xBox0;
    let indexY = yBox0;
    let bresIndexX = xBox0 + 1;
    let bresIndexY = yBox0 + 1;
    const bresDyDx = (Y0 - Y1) / (X0 - X1);
    const bresXAdd = Y0 - bresDyDx * X0;
    em.add_edge_to_box(xBox0, yBox0, this);
    let guard = 0;
    const done = () => (indexX === xBox1 && indexY === yBox1) || ++guard > 64;
    if (dirX === 1) {
      if (dirY === 1) {
        do {
          const yCoord = bresIndexY * em.AdvanceY + em.Y;
          const xCoord = (bresIndexX * em.AdvanceX + em.X) * bresDyDx + bresXAdd;
          if (xCoord >= yCoord) {
            if (xCoord === yCoord) {
              ++indexX;
              ++bresIndexX;
            }
            ++indexY;
            ++bresIndexY;
          } else {
            ++indexX;
            ++bresIndexX;
          }
          em.add_edge_to_box(indexX, indexY, this);
        } while (!done());
      } else {
        do {
          const yCoord = indexY * em.AdvanceY + em.Y;
          const xCoord = (bresIndexX * em.AdvanceX + em.X) * bresDyDx + bresXAdd;
          if (xCoord <= yCoord) {
            if (xCoord === yCoord) {
              ++indexX;
              ++bresIndexX;
            }
            --indexY;
          } else {
            ++indexX;
            ++bresIndexX;
          }
          em.add_edge_to_box(indexX, indexY, this);
        } while (!done());
      }
    } else if (dirY === 1) {
      do {
        const xCoord = bresIndexY * em.AdvanceY + em.Y;
        const yCoord = (indexX * em.AdvanceX + em.X) * bresDyDx + bresXAdd;
        if (yCoord >= xCoord) {
          if (yCoord === xCoord) --indexX;
          ++indexY;
          ++bresIndexY;
        } else {
          --indexX;
        }
        em.add_edge_to_box(indexX, indexY, this);
      } while (!done());
    } else {
      do {
        const yCoord = indexY * em.AdvanceY + em.Y;
        const xCoord = (indexX * em.AdvanceX + em.X) * bresDyDx + bresXAdd;
        if (xCoord <= yCoord) {
          if (xCoord === yCoord) --indexX;
          --indexY;
        } else {
          --indexX;
        }
        em.add_edge_to_box(indexX, indexY, this);
      } while (!done());
    }
  }
}

// ---------- TCircle ----------

export class TCircle extends TEdgeSegment {
  constructor(collComp, activeFlag, collisionGroup, center, radius) {
    super(collComp, activeFlag, collisionGroup);
    this.Circle = newCircle(center, radius * radius);
  }

  FindCollisionDistance(r) {
    return ray_intersect_circle(r, this.Circle);
  }

  EdgeCollision(ball, coef) {
    const nextPosition = vec(coef * ball.Acceleration.X + ball.Position.X, coef * ball.Acceleration.Y + ball.Position.Y);
    const direction = vec(nextPosition.X - this.Circle.Center.X, nextPosition.Y - this.Circle.Center.Y);
    normalize_2d(direction);
    this.CollisionComponent.Collision(ball, nextPosition, direction, coef, this);
  }

  place_in_grid() {
    edges_insert_circle(this.Circle, this, null);
  }
}

// ---------- TFlipperEdge ----------

// Shared scratch geometry of the flipper being tested (statics in the original).
const F = {
  sin: 0,
  cos: 0,
  A1: vec(), A2: vec(), B1: vec(), B2: vec(), T1: vec(),
  lineA: newLine(),
  lineB: newLine(),
  circlebase: newCircle(),
  circleT1: newCircle(),
};

export function distance_to_flipper(ray1, ray2) {
  let distance = NO_HIT;
  let distanceType = -1;
  let newDistance = ray_intersect_line(ray1, F.lineA);
  if (newDistance < NO_HIT) {
    distance = newDistance;
    distanceType = 0;
  }
  newDistance = ray_intersect_circle(ray1, F.circlebase);
  if (newDistance < distance) {
    distance = newDistance;
    distanceType = 2;
  }
  newDistance = ray_intersect_circle(ray1, F.circleT1);
  if (newDistance < distance) {
    distance = newDistance;
    distanceType = 3;
  }
  newDistance = ray_intersect_line(ray1, F.lineB);
  if (newDistance < distance) {
    distance = newDistance;
    distanceType = 1;
  }
  if (!ray2 || distance >= NO_HIT) return distance;

  if (distanceType !== -1) {
    if (distanceType === 2 || distanceType === 3) {
      ray2.Origin.X = distance * ray1.Direction.X + ray1.Origin.X;
      ray2.Origin.Y = distance * ray1.Direction.Y + ray1.Origin.Y;
      const center = distanceType === 2 ? F.circlebase.Center : F.circleT1.Center;
      ray2.Direction.X = ray2.Origin.X - center.X;
      ray2.Direction.Y = ray2.Origin.Y - center.Y;
      normalize_2d(ray2.Direction);
      return distance;
    }
    const l = distanceType === 1 ? F.lineB : F.lineA;
    ray2.Direction = copyVec(l.PerpendicularL);
    ray2.Origin = copyVec(l.RayIntersect);
    return distance;
  }
  return NO_HIT;
}

export class TFlipperEdge extends TEdgeSegment {
  constructor(collComp, activeFlag, collisionGroup, table, origin, vecT1, vecT2, extendTime, retractTime, collMult, elasticity, smoothness) {
    super(collComp, activeFlag, collisionGroup);
    this.Elasticity = elasticity;
    this.Smoothness = smoothness;
    this.ExtendTime = extendTime;
    this.RetractTime = retractTime;
    this.CollisionMult = collMult;
    this.T1Src = copyVec(vecT1);
    this.T2Src = copyVec(vecT2);
    this.RotOrigin = vec(origin.X, origin.Y);

    this.CirclebaseRadius = origin.Z + table.CollisionCompOffset;
    this.CirclebaseRadiusMSq = this.CirclebaseRadius * 1.01 * (this.CirclebaseRadius * 1.01);
    this.CirclebaseRadiusSq = this.CirclebaseRadius * this.CirclebaseRadius;
    this.CircleT1Radius = vecT1.Z + table.CollisionCompOffset;
    this.CircleT1RadiusMSq = this.CircleT1Radius * 1.01 * (this.CircleT1Radius * 1.01);
    this.CircleT1RadiusSq = this.CircleT1Radius * this.CircleT1Radius;

    const vecDir1 = vec(vecT1.X - origin.X, vecT1.Y - origin.Y, 0);
    normalize_2d(vecDir1);
    const vecDir2 = vec(vecT2.X - origin.X, vecT2.Y - origin.Y, 0);
    normalize_2d(vecDir2);

    this.AngleMax = Math.acos(DotProduct(vecDir1, vecDir2));
    const crossProd = vec();
    cross(vecDir1, vecDir2, crossProd);
    if (crossProd.Z < 0) this.AngleMax = -this.AngleMax;
    this.FlipperFlag = 0;
    this.Angle1 = 0;
    this.Angle2 = 0;

    let dirX1 = vecDir1.X;
    let dirY1 = -vecDir1.Y;
    this.A2Src = vec(dirY1 * this.CirclebaseRadius + origin.X, dirX1 * this.CirclebaseRadius + origin.Y);
    this.A1Src = vec(dirY1 * this.CircleT1Radius + vecT1.X, dirX1 * this.CircleT1Radius + vecT1.Y);
    dirX1 = -dirX1;
    dirY1 = -dirY1;
    this.B1Src = vec(dirY1 * this.CirclebaseRadius + origin.X, dirX1 * this.CirclebaseRadius + origin.Y);
    this.B2Src = vec(dirY1 * this.CircleT1Radius + vecT1.X, dirX1 * this.CircleT1Radius + vecT1.Y);
    if (this.AngleMax < 0) {
      [this.A1Src, this.B1Src] = [this.B1Src, this.A1Src];
      [this.A2Src, this.B2Src] = [this.B2Src, this.A2Src];
    }

    const dx = vecT1.X - this.RotOrigin.X;
    const dy = vecT1.Y - this.RotOrigin.Y;
    const distance1 = Math.sqrt(dy * dy + dx * dx) + table.CollisionCompOffset + vecT1.Z;
    this.DistanceDivSq = distance1 * distance1;

    const minMoveTime = Math.min(this.ExtendTime, this.RetractTime);
    const distance = Distance(vecT1, vecT2);
    this.CollisionTimeAdvance = minMoveTime / (distance / this.CircleT1Radius + distance / this.CircleT1Radius);

    this.CollisionFlag1 = 0;
    this.CollisionFlag2 = 0;
    this.CollisionLinePerp = vec();
    this.CollisionDirection = vec();
    this.NextBallPosition = vec();
    this.place_in_grid();
    this.EdgeCollisionFlag = 0;
    this.InputTime = 0;
    this.AngleStopTime = 0;
    this.AngleMult = 0;
  }

  port_draw() {
    this.set_control_points(this.InputTime);
    this.build_edges_in_motion();
  }

  FindCollisionDistance(ogRay) {
    const dstRay = newRay();
    const srcRay = newRay();

    if (ogRay.TimeNow > this.AngleStopTime) this.FlipperFlag = 0;
    if (this.EdgeCollisionFlag !== 0) {
      this.EdgeCollisionFlag = 0;
      return NO_HIT;
    }

    if (this.FlipperFlag === 0) {
      this.CollisionFlag1 = 0;
      this.CollisionFlag2 = 0;
      this.set_control_points(ogRay.TimeNow);
      this.build_edges_in_motion();
      const ballInside = this.is_ball_inside(ogRay.Origin.X, ogRay.Origin.Y);
      srcRay.MinDistance = ogRay.MinDistance;
      if (ballInside === 0) {
        srcRay.Direction = copyVec(ogRay.Direction);
        srcRay.MaxDistance = ogRay.MaxDistance;
        srcRay.Origin = copyVec(ogRay.Origin);
        const distance = distance_to_flipper(srcRay, dstRay);
        this.NextBallPosition = copyVec(dstRay.Origin);
        if (distance === 0) {
          this.NextBallPosition.X -= srcRay.Direction.X * 1e-05;
          this.NextBallPosition.Y -= srcRay.Direction.Y * 1e-05;
        }
        this.CollisionDirection = copyVec(dstRay.Direction);
        return distance;
      }

      if (Distance_Squared(ogRay.Origin, this.RotOrigin) >= this.CirclebaseRadiusMSq) {
        if (Distance_Squared(ogRay.Origin, F.T1) >= this.CircleT1RadiusMSq) {
          const perp = ballInside === 4 ? F.lineA.PerpendicularL : F.lineB.PerpendicularL;
          srcRay.Direction.X = -perp.X;
          srcRay.Direction.Y = -perp.Y;
        } else {
          srcRay.Direction.X = F.T1.X - ogRay.Origin.X;
          srcRay.Direction.Y = F.T1.Y - ogRay.Origin.Y;
          normalize_2d(srcRay.Direction);
        }
      } else {
        srcRay.Direction.X = this.RotOrigin.X - ogRay.Origin.X;
        srcRay.Direction.Y = this.RotOrigin.Y - ogRay.Origin.Y;
        normalize_2d(srcRay.Direction);
      }

      srcRay.Origin.X = ogRay.Origin.X - srcRay.Direction.X * 5;
      srcRay.Origin.Y = ogRay.Origin.Y - srcRay.Direction.Y * 5;
      srcRay.MaxDistance = ogRay.MaxDistance + 10;
      if (distance_to_flipper(srcRay, dstRay) >= 1e9) {
        srcRay.Direction.X = this.RotOrigin.X - ogRay.Origin.X;
        srcRay.Direction.Y = this.RotOrigin.Y - ogRay.Origin.Y;
        normalize_2d(srcRay.Direction);
        srcRay.Origin.X = ogRay.Origin.X - srcRay.Direction.X * 5;
        srcRay.Origin.Y = ogRay.Origin.Y - srcRay.Direction.Y * 5;
        if (distance_to_flipper(srcRay, dstRay) >= 1e9) return NO_HIT;
      }

      this.NextBallPosition = copyVec(dstRay.Origin);
      this.CollisionDirection = copyVec(dstRay.Direction);
      this.NextBallPosition.X -= srcRay.Direction.X * 1e-05;
      this.NextBallPosition.Y -= srcRay.Direction.Y * 1e-05;
      return 0;
    }

    let posX = ogRay.Origin.X;
    let posY = ogRay.Origin.Y;
    const posXAdvance = ogRay.Direction.X * this.CollisionTimeAdvance;
    const posYAdvance = ogRay.Direction.Y * this.CollisionTimeAdvance;
    const rayMaxDistance = ogRay.MaxDistance * this.CollisionTimeAdvance;
    let timeNow = ogRay.TimeNow;
    const stopTime = ogRay.TimeDelta + ogRay.TimeNow;
    while (timeNow < stopTime) {
      this.set_control_points(timeNow);
      this.build_edges_in_motion();
      const ballInside = this.is_ball_inside(posX, posY);
      if (ballInside !== 0) {
        let linePtr;
        if (this.FlipperFlag === 1 && ballInside !== 5) {
          linePtr = F.lineA.PerpendicularL;
        } else {
          if (this.FlipperFlag !== 2 || ballInside === 4) {
            this.CollisionFlag1 = 0;
            this.CollisionFlag2 = 1;
            srcRay.Direction.X = this.RotOrigin.X - posX;
            srcRay.Direction.Y = this.RotOrigin.Y - posY;
            normalize_2d(srcRay.Direction);
            srcRay.Origin.X = posX - srcRay.Direction.X * 5;
            srcRay.Origin.Y = posY - srcRay.Direction.Y * 5;
            srcRay.MaxDistance = ogRay.MaxDistance + 10;
            if (distance_to_flipper(srcRay, dstRay) >= 1e9) {
              this.NextBallPosition.X = posX;
              this.NextBallPosition.Y = posY;
              this.CollisionDirection.X = -srcRay.Direction.X;
              this.CollisionDirection.Y = -srcRay.Direction.Y;
              return 0;
            }
            this.NextBallPosition = copyVec(dstRay.Origin);
            this.CollisionDirection = copyVec(dstRay.Direction);
            this.NextBallPosition.X -= srcRay.Direction.X * 1e-05;
            this.NextBallPosition.Y -= srcRay.Direction.Y * 1e-05;
            return 0;
          }
          linePtr = F.lineB.PerpendicularL;
        }

        this.CollisionLinePerp = copyVec(linePtr);
        this.CollisionFlag2 = 0;
        this.CollisionFlag1 = 1;
        srcRay.Direction.X = -linePtr.X;
        srcRay.Direction.Y = -linePtr.Y;
        srcRay.MinDistance = 0.002;
        srcRay.Origin.X = ogRay.Origin.X - srcRay.Direction.X * 5;
        srcRay.Origin.Y = ogRay.Origin.Y - srcRay.Direction.Y * 5;
        srcRay.MaxDistance = ogRay.MaxDistance + 10;
        const distance = distance_to_flipper(srcRay, dstRay);
        this.CollisionDirection = copyVec(dstRay.Direction);
        if (distance >= 1e9) return NO_HIT;
        this.NextBallPosition = copyVec(dstRay.Origin);
        this.NextBallPosition.X -= srcRay.Direction.X * 1e-05;
        this.NextBallPosition.Y -= srcRay.Direction.Y * 1e-05;
        return 0;
      }

      srcRay.Direction = copyVec(ogRay.Direction);
      srcRay.MinDistance = ogRay.MinDistance;
      srcRay.Origin = copyVec(ogRay.Origin);
      srcRay.MaxDistance = rayMaxDistance;
      const distance = distance_to_flipper(srcRay, dstRay);
      if (distance < 1e9) {
        this.NextBallPosition = copyVec(dstRay.Origin);
        this.NextBallPosition.X -= srcRay.Direction.X * 1e-05;
        this.NextBallPosition.Y -= srcRay.Direction.Y * 1e-05;
        let linePtr;
        if (this.FlipperFlag === 2) {
          linePtr = F.lineB.PerpendicularL;
          this.CollisionFlag1 = this.AngleMax <= 0 ? 1 : 0;
        } else {
          this.CollisionFlag1 = this.AngleMax > 0 ? 1 : 0;
          linePtr = F.lineA.PerpendicularL;
        }
        this.CollisionLinePerp = copyVec(linePtr);
        this.CollisionDirection = copyVec(dstRay.Direction);
        return distance;
      }
      timeNow += this.CollisionTimeAdvance;
      posX += posXAdvance;
      posY += posYAdvance;
    }
    return NO_HIT;
  }

  EdgeCollision(ball, coef) {
    this.EdgeCollisionFlag = 1;
    if (!this.FlipperFlag || !this.CollisionFlag2 || this.CollisionFlag1) {
      let boost = 0;
      if (this.CollisionFlag1) {
        const dx = this.NextBallPosition.X - this.RotOrigin.X;
        const dy = this.NextBallPosition.Y - this.RotOrigin.Y;
        const distance = dy * dy + dx * dx;
        if (F.circlebase.RadiusSq * 1.01 < distance) {
          const v20 = Math.sqrt(distance / this.DistanceDivSq) * (Math.abs(this.AngleMax) / this.AngleMult);
          const dot1 = DotProduct(this.CollisionLinePerp, this.CollisionDirection);
          const v11 = dot1 >= 0 ? dot1 * v20 : 0;
          boost = v11 * this.CollisionMult;
        }
      }
      const threshold = boost <= 0 ? 1000000000.0 : -1.0;
      basic_collision(ball, this.NextBallPosition, this.CollisionDirection, this.Elasticity, this.Smoothness, threshold, boost);
      return;
    }

    let elasticity;
    const dx = this.NextBallPosition.X - this.RotOrigin.X;
    const dy = this.NextBallPosition.Y - this.RotOrigin.Y;
    const distance = dy * dy + dx * dx;
    if (F.circlebase.RadiusSq * 1.01 < distance) elasticity = (1 - Math.sqrt(distance / this.DistanceDivSq)) * this.Elasticity;
    else elasticity = this.Elasticity;
    basic_collision(ball, this.NextBallPosition, this.CollisionDirection, elasticity, this.Smoothness, 1000000000.0, 0.0);
  }

  place_in_grid() {
    const { RotOrigin, CirclebaseRadius, CircleT1Radius, T1Src, T2Src } = this;
    let x0 = RotOrigin.X - CirclebaseRadius;
    let y0 = RotOrigin.Y - CirclebaseRadius;
    let x1 = RotOrigin.X + CirclebaseRadius;
    let y1 = RotOrigin.Y + CirclebaseRadius;
    x0 = Math.min(x0, T1Src.X - CircleT1Radius);
    y0 = Math.min(y0, T1Src.Y - CircleT1Radius);
    x1 = Math.max(x1, T1Src.X + CircleT1Radius);
    y1 = Math.max(y1, T1Src.Y + CircleT1Radius);
    x0 = Math.min(x0, T2Src.X - CircleT1Radius);
    y0 = Math.min(y0, T2Src.Y - CircleT1Radius);
    x1 = Math.max(x1, T2Src.X + CircleT1Radius);
    y1 = Math.max(y1, T2Src.Y + CircleT1Radius);
    edges_insert_square(y0, x0, y1, x1, this, null);
  }

  set_control_points(timeNow) {
    const angle = this.flipper_angle(timeNow);
    F.sin = Math.sin(angle);
    F.cos = Math.cos(angle);
    F.A1 = copyVec(this.A1Src);
    F.A2 = copyVec(this.A2Src);
    F.B1 = copyVec(this.B1Src);
    F.B2 = copyVec(this.B2Src);
    F.T1 = copyVec(this.T1Src);
    RotatePt(F.A1, F.sin, F.cos, this.RotOrigin);
    RotatePt(F.A2, F.sin, F.cos, this.RotOrigin);
    RotatePt(F.T1, F.sin, F.cos, this.RotOrigin);
    RotatePt(F.B1, F.sin, F.cos, this.RotOrigin);
    RotatePt(F.B2, F.sin, F.cos, this.RotOrigin);
  }

  build_edges_in_motion() {
    line_init(F.lineA, F.A1.X, F.A1.Y, F.A2.X, F.A2.Y);
    line_init(F.lineB, F.B1.X, F.B1.Y, F.B2.X, F.B2.Y);
    F.circlebase.RadiusSq = this.CirclebaseRadiusSq;
    F.circlebase.Center.X = this.RotOrigin.X;
    F.circlebase.Center.Y = this.RotOrigin.Y;
    F.circleT1.RadiusSq = this.CircleT1RadiusSq;
    F.circleT1.Center.X = F.T1.X;
    F.circleT1.Center.Y = F.T1.Y;
  }

  flipper_angle(timeNow) {
    if (!this.FlipperFlag) return this.Angle1;
    let angle = ((this.Angle1 - this.Angle2) / this.AngleMax) * this.AngleMult;
    if (angle < 0) angle = -angle;
    if (angle >= 0.0000001) angle = (timeNow - this.InputTime) / angle;
    else angle = 1;
    angle = Math.min(1, Math.max(angle, 0));
    if (this.FlipperFlag === 2) angle = 1 - angle;
    return angle * this.AngleMax;
  }

  is_ball_inside(x, y) {
    const { A1, A2, B1, B2, T1 } = F;
    const dx = this.RotOrigin.X - x;
    const dy = this.RotOrigin.Y - y;
    if (((A2.X - A1.X) * (y - A1.Y) - (A2.Y - A1.Y) * (x - A1.X) >= 0
        && (B1.X - A2.X) * (y - A2.Y) - (B1.Y - A2.Y) * (x - A2.X) >= 0
        && (B2.X - B1.X) * (y - B1.Y) - (B2.Y - B1.Y) * (x - B1.X) >= 0
        && (A1.X - B2.X) * (y - B2.Y) - (A1.Y - B2.Y) * (x - B2.X) >= 0)
      || dy * dy + dx * dx <= this.CirclebaseRadiusSq
      || (T1.Y - y) * (T1.Y - y) + (T1.X - x) * (T1.X - x) < this.CircleT1RadiusSq) {
      const flipperLR = this.AngleMax < 0 ? -1 : 1;
      let testPoint;
      if (this.FlipperFlag === 1) testPoint = this.AngleMax < 0 ? B1 : B2;
      else if (this.FlipperFlag === 2) testPoint = this.AngleMax < 0 ? A2 : A1;
      else testPoint = T1;
      if (((y - testPoint.Y) * (this.RotOrigin.X - testPoint.X) - (x - testPoint.X) * (this.RotOrigin.Y - testPoint.Y)) * flipperLR < 0) return 4;
      return 5;
    }
    return 0;
  }

  SetMotion(code, value) {
    switch (code) {
      case 1:
        this.Angle2 = this.flipper_angle(value);
        this.Angle1 = this.AngleMax;
        this.AngleMult = this.ExtendTime;
        break;
      case 2:
        this.Angle2 = this.flipper_angle(value);
        this.Angle1 = 0;
        this.AngleMult = this.RetractTime;
        break;
      case 1024:
        this.FlipperFlag = 0;
        this.Angle1 = 0;
        return;
      default:
        break;
    }
    if (!this.FlipperFlag) this.InputTime = value;
    this.FlipperFlag = code;
    this.AngleStopTime = this.AngleMult + this.InputTime;
  }
}
