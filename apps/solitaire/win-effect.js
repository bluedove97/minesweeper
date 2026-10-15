// Bouncing-cards win effect, ported from Win() and WinAlgorithm() in GameForm.vb.
// Kings leave the four foundations first, then queens, and so on down to the
// aces. Each card follows a parabola, bounces on the bottom edge, and is never
// erased, which leaves the trail.

import { CARD_W, CARD_H } from './layout.js';

// VB CInt: round half to even.
function cint(v) {
  const f = Math.floor(v);
  const d = v - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

// .NET Random.Next(min, max): max is exclusive.
const nextInt = (random, min, max) => min + Math.floor(random() * (max - min));

// `foundations` gives each pile's position and suit: [{ x, y, suit }] x4.
export function createWinEffect({ width, height, foundations, random = Math.random }) {
  const w = {
    stack: 0,
    card: 12,
    x: foundations[0].x,
    y: foundations[0].y,
    newStack: true,
    bounce: false,
    xVertex: 0,
    yVertex: 0,
    xMovement: 0,
    yMultiplier: 0,
    parabola: 0,
    done: false,
  };

  function algorithm() {
    let z;
    if (w.newStack) {
      w.newStack = false;
      w.xVertex = nextInt(random, 0, 2) === 0 ? w.x + 24 : w.x - 24;
      w.yVertex = nextInt(random, -CARD_W, w.y);
      let i = nextInt(random, 0, 4);
      if (i === 0) {
        w.xMovement = nextInt(random, -3, -1);
      } else if (i === 1) {
        w.xMovement = nextInt(random, 2, 4);
      } else if (i === 2) {
        i = nextInt(random, 0, 2);
        w.xMovement = i === 0 ? nextInt(random, -4, 0) : nextInt(random, -4, -1);
      } else {
        i = nextInt(random, 0, 2);
        w.xMovement = i === 0 ? nextInt(random, 1, 5) : nextInt(random, 2, 5);
      }
      const r = nextInt(random, 3, 7);
      w.yMultiplier = (r + 1) / r;
      z = w.x - w.xVertex;
      w.parabola = (w.y - w.yVertex) / (z * z);
    } else if (w.bounce) {
      // VB: Ceiling(H - CInt(H - yVertex) \ CInt(yMultiplier)).
      let newY = Math.ceil(height - Math.trunc(cint(height - w.yVertex) / cint(w.yMultiplier)));
      const dx = w.x - w.xVertex;
      z = (w.parabola * dx * dx + w.yVertex - newY) / w.parabola;
      if (z < 0 || height - newY - CARD_H < 6) {
        newY = w.yVertex + 4;
        z = (w.parabola * dx * dx + w.yVertex - newY) / w.parabola;
      }
      // A negative root would overflow CInt in VB; treat it as a single root.
      const root = z > 0 ? Math.sqrt(z) : 0;
      const x1 = cint(-root + w.x);
      const x2 = cint(root + w.x);
      let newX;
      if (w.xMovement > 0 && x1 > x2) newX = x1;
      else if (w.xMovement > 0 && x2 > x1) newX = x2;
      else if (w.xMovement < 0 && x1 < x2) newX = x1;
      else if (w.xMovement < 0 && x2 < x1) newX = x2;
      else if (w.xMovement < 0 && x1 === x2 && x1 < w.xVertex) newX = x1;
      else if (w.xMovement > 0 && x1 === x2 && x1 > w.xVertex) newX = x1;
      else newX = w.xVertex - 1;
      w.xVertex = newX;
      w.yVertex = newY;
    }
    w.x += w.xMovement;
    z = w.x - w.xVertex;
    const y = w.parabola * z * z + w.yVertex;
    if (!(y > w.y && w.bounce)) w.y = cint(y);
    w.bounce = false;
  }

  // One paint of the original: draw the current card, then advance it.
  // Returns false once the last ace has left the screen.
  function step(ctx, imageFor) {
    if (w.done) return false;
    ctx.fillStyle = '#fff';
    ctx.fillRect(w.x, w.y, CARD_W, CARD_H);
    ctx.drawImage(imageFor(foundations[w.stack].suit, w.card), w.x, w.y);
    algorithm();

    if (w.y + CARD_H >= height) w.bounce = true;
    if (w.x + CARD_W <= 0 || w.x >= width) {
      if (w.stack === 3) {
        if (w.card === 0) {
          w.done = true;
          return false;
        }
        w.card -= 1;
        w.stack = 0;
      } else {
        w.stack += 1;
      }
      w.newStack = true;
      w.x = foundations[w.stack].x;
      w.y = foundations[w.stack].y;
    }
    return true;
  }

  return { step };
}
