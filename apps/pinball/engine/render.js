// Software renderer, ported from gdrv.cpp, zdrv.cpp, render.cpp and proj.cpp.
// Sprites are painted into the 600x416 vScreen with per-pixel depth (zMap)
// testing; only dirty rectangles are repainted each frame.

import { Bitmap8, ZMap, zmapFill } from './dat.js';
import { rect, copyRect, enclosing_box, rectangle_clip, magnitude, vec } from './maths.js';

// ---------- gdrv ----------

export function fill_bitmap(bmp, width, height, xOff, yOff, color) {
  let ptr = bmp.Width * yOff + xOff;
  for (; height > 0; --height) {
    bmp.BmpBufPtr1.fill(color, ptr, ptr + width);
    ptr += bmp.Stride;
  }
}

export function copy_bitmap(dstBmp, width, height, xOff, yOff, srcBmp, srcXOff, srcYOff) {
  let src = srcBmp.Stride * srcYOff + srcXOff;
  let dst = dstBmp.Stride * yOff + xOff;
  for (let y = height; y > 0; --y) {
    dstBmp.BmpBufPtr1.set(srcBmp.BmpBufPtr1.subarray(src, src + width), dst);
    src += srcBmp.Stride;
    dst += dstBmp.Stride;
  }
}

export function copy_bitmap_w_transparency(dstBmp, width, height, xOff, yOff, srcBmp, srcXOff, srcYOff) {
  const s = srcBmp.BmpBufPtr1;
  const d = dstBmp.BmpBufPtr1;
  let src = srcBmp.Stride * srcYOff + srcXOff;
  let dst = dstBmp.Stride * yOff + xOff;
  for (let y = height; y > 0; --y) {
    for (let x = width; x > 0; --x) {
      if (s[src]) d[dst] = s[src];
      ++src;
      ++dst;
    }
    src += srcBmp.Stride - width;
    dst += dstBmp.Stride - width;
  }
}

// ---------- zdrv ----------

function zpaint(width, height, dstBmp, dstX, dstY, dstZMap, dstZX, dstZY, srcBmp, srcX, srcY, srcZMap, srcZX, srcZY) {
  const sb = srcBmp.BmpBufPtr1;
  const db = dstBmp.BmpBufPtr1;
  const sz = srcZMap.ZPtr1;
  const dz = dstZMap.ZPtr1;
  let src = srcBmp.Stride * srcY + srcX;
  let dst = dstBmp.Stride * dstY + dstX;
  let srcZ = srcZMap.Stride * srcZY + srcZX;
  let dstZ = dstZMap.Stride * dstZY + dstZX;
  for (let y = height; y > 0; y--) {
    for (let x = width; x > 0; --x) {
      if (dz[dstZ] >= sz[srcZ]) {
        db[dst] = sb[src];
        dz[dstZ] = sz[srcZ];
      }
      ++src;
      ++dst;
      ++srcZ;
      ++dstZ;
    }
    src += srcBmp.Stride - width;
    dst += dstBmp.Stride - width;
    srcZ += srcZMap.Stride - width;
    dstZ += dstZMap.Stride - width;
  }
}

function zpaint_flat(width, height, dstBmp, dstX, dstY, zMap, zX, zY, srcBmp, srcX, srcY, depth) {
  const sb = srcBmp.BmpBufPtr1;
  const db = dstBmp.BmpBufPtr1;
  const z = zMap.ZPtr1;
  let dst = dstBmp.Stride * dstY + dstX;
  let src = srcBmp.Stride * srcY + srcX;
  let zp = zMap.Stride * zY + zX;
  for (let y = height; y > 0; y--) {
    for (let x = width; x > 0; --x) {
      if (sb[src] && z[zp] > depth) db[dst] = sb[src];
      ++src;
      ++dst;
      ++zp;
    }
    src += srcBmp.Stride - width;
    dst += dstBmp.Stride - width;
    zp += zMap.Stride - width;
  }
}

// ---------- proj ----------

export const proj = {
  matrix: null,
  d: 0,
  centerx: 0,
  centery: 0,

  init(mat4x3, d, centerX, centerY) {
    this.matrix = [...mat4x3.slice(0, 12), 0, 0, 0, 1];
    this.d = d;
    this.centerx = centerX;
    this.centery = centerY;
  },

  multiply(v) {
    const m = this.matrix;
    const { X: x, Y: y, Z: z } = v;
    return vec(
      z * m[2] + y * m[1] + x * m[0] + m[3],
      z * m[6] + y * m[5] + x * m[4] + m[7],
      z * m[10] + y * m[9] + x * m[8] + m[11],
    );
  },

  z_distance(v) {
    return magnitude(this.multiply(v));
  },

  xform_to_2d(v) {
    const dst = this.multiply(v);
    const projCoef = dst.Z === 0 ? 999999.88 : this.d / dst.Z;
    return [Math.trunc(dst.X * projCoef + this.centerx), Math.trunc(dst.Y * projCoef + this.centery)];
  },

  recenter(centerX, centerY) {
    this.centerx = centerX;
    this.centery = centerY;
  },
};

// ---------- render ----------

export const VisualTypes = { None: 0, Sprite: 1, Ball: 2 };

export const render = {
  vscreen: null,
  zscreen: null,
  background_bitmap: null,
  background_zmap: null,
  zmap_offset: 0,
  zmap_offsetY: 0,
  offset_x: 0,
  offset_y: 0,
  zscaler: 0,
  zmin: 0,
  zmax: 0,
  vscreen_rect: rect(),
  ball_bitmap: [],
  dirty_list: [],
  sprite_list: [],
  ball_list: [],

  init(bmp, zMin, zScaler, width, height) {
    this.zscaler = zScaler;
    this.zmin = zMin;
    this.zmax = 4294967300.0 / zScaler + zMin;
    this.vscreen = new Bitmap8(width, height, false);
    this.zscreen = new ZMap(width, height, width);
    zmapFill(this.zscreen, width, height, 0, 0, 0xffff);
    this.vscreen_rect = rect(0, 0, width, height);
    this.ball_bitmap = Array.from({ length: 20 }, () => new Bitmap8(64, 64, false));
    this.background_bitmap = bmp;
    this.background_zmap = null;
    this.zmap_offset = 0;
    this.zmap_offsetY = 0;
    this.offset_x = 0;
    this.offset_y = 0;
    this.dirty_list = [];
    this.sprite_list = [];
    this.ball_list = [];
    if (bmp) copy_bitmap(this.vscreen, width, height, 0, 0, bmp, 0, 0);
    else fill_bitmap(this.vscreen, width, height, 0, 0, 0);
  },

  update() {
    this.unpaint_balls();

    // Clip dirty sprites with the vScreen and clear their dirty rectangles.
    for (const sprite of this.dirty_list) {
      let clearSprite = false;
      if (sprite.VisualType === VisualTypes.Sprite) {
        if (sprite.DirtyRectPrev.Width > 0) enclosing_box(sprite.DirtyRectPrev, sprite.BmpRect, sprite.DirtyRect);
        if (rectangle_clip(sprite.DirtyRect, this.vscreen_rect, sprite.DirtyRect)) clearSprite = true;
        else sprite.DirtyRect.Width = -1;
      } else if (sprite.VisualType === VisualTypes.None) {
        if (rectangle_clip(sprite.BmpRect, this.vscreen_rect, sprite.DirtyRect)) clearSprite = !sprite.Bmp;
        else sprite.DirtyRect.Width = -1;
      }
      if (clearSprite) {
        const { XPosition: x, YPosition: y, Width: w, Height: h } = sprite.DirtyRect;
        zmapFill(this.zscreen, w, h, x, y, 0xffff);
        if (this.background_bitmap) copy_bitmap(this.vscreen, w, h, x, y, this.background_bitmap, x, y);
        else fill_bitmap(this.vscreen, w, h, x, y, 0);
      }
    }

    for (const sprite of this.dirty_list) {
      if (sprite.DirtyRect.Width > 0 && (sprite.VisualType === VisualTypes.None || sprite.VisualType === VisualTypes.Sprite)) {
        this.repaint(sprite);
      }
    }

    this.paint_balls();

    for (const sprite of this.dirty_list) sprite.DirtyRectPrev = copyRect(sprite.DirtyRect);
    this.dirty_list = [];
  },

  sprite_modified(sprite) {
    if (sprite.VisualType !== VisualTypes.Ball && this.dirty_list.length < 999) this.dirty_list.push(sprite);
  },

  create_sprite(visualType, bmp, zMap, xPosition, yPosition, boundingRect) {
    const sprite = {
      BmpRect: rect(xPosition, yPosition, bmp ? bmp.Width : 0, bmp ? bmp.Height : 0),
      Bmp: bmp,
      ZMap: zMap,
      UnknownFlag: 0,
      VisualType: visualType,
      Depth: 0,
      DirtyRectPrev: rect(),
      ZMapOffestY: 0,
      ZMapOffestX: 0,
      DirtyRect: rect(),
      SpriteArray: null,
      BoundingRect: boundingRect ? copyRect(boundingRect) : rect(0, 0, -1, -1),
    };
    if (!zMap && visualType !== VisualTypes.Ball) {
      sprite.ZMap = this.background_zmap;
      sprite.ZMapOffestY = xPosition - this.zmap_offset;
      sprite.ZMapOffestX = yPosition - this.zmap_offsetY;
    }
    sprite.DirtyRectPrev = copyRect(sprite.BmpRect);
    if (visualType === VisualTypes.Ball) {
      this.ball_list.push(sprite);
    } else {
      this.sprite_list.push(sprite);
      this.sprite_modified(sprite);
    }
    return sprite;
  },

  sprite_set(sprite, bmp, zMap, xPos, yPos) {
    if (!sprite) return;
    sprite.BmpRect.XPosition = xPos;
    sprite.BmpRect.YPosition = yPos;
    sprite.Bmp = bmp;
    if (bmp) {
      sprite.BmpRect.Width = bmp.Width;
      sprite.BmpRect.Height = bmp.Height;
    }
    sprite.ZMap = zMap;
    this.sprite_modified(sprite);
  },

  sprite_set_bitmap(sprite, bmp) {
    if (sprite && sprite.Bmp !== bmp) {
      sprite.Bmp = bmp;
      if (bmp) {
        sprite.BmpRect.Width = bmp.Width;
        sprite.BmpRect.Height = bmp.Height;
      }
      this.sprite_modified(sprite);
    }
  },

  set_background_zmap(zMap, offsetX, offsetY) {
    this.background_zmap = zMap;
    this.zmap_offset = offsetX;
    this.zmap_offsetY = offsetY;
  },

  ball_set(sprite, bmp, depth, xPos, yPos) {
    if (!sprite) return;
    sprite.Bmp = bmp;
    if (bmp) {
      sprite.BmpRect.XPosition = xPos;
      sprite.BmpRect.YPosition = yPos;
      sprite.BmpRect.Width = bmp.Width;
      sprite.BmpRect.Height = bmp.Height;
    }
    if (depth >= this.zmin) {
      const depth2 = (depth - this.zmin) * this.zscaler;
      // static_cast<short>, then compared as uint16 in paint_flat.
      sprite.Depth = depth2 <= this.zmax ? (Math.trunc(depth2) << 16) >> 16 : -1;
    } else {
      sprite.Depth = 0;
    }
  },

  repaint(sprite) {
    if (!sprite.SpriteArray) return;
    const clipRect = rect();
    for (const ref of sprite.SpriteArray) {
      if (!ref.UnknownFlag && ref.Bmp && rectangle_clip(ref.BmpRect, sprite.DirtyRect, clipRect)) {
        zpaint(
          clipRect.Width, clipRect.Height,
          this.vscreen, clipRect.XPosition, clipRect.YPosition,
          this.zscreen, clipRect.XPosition, clipRect.YPosition,
          ref.Bmp, clipRect.XPosition - ref.BmpRect.XPosition, clipRect.YPosition - ref.BmpRect.YPosition,
          ref.ZMap,
          clipRect.XPosition + ref.ZMapOffestY - ref.BmpRect.XPosition,
          clipRect.YPosition + ref.ZMapOffestX - ref.BmpRect.YPosition,
        );
      }
    }
  },

  paint_balls() {
    const list = this.ball_list;
    // Sort ball sprites by depth (the original's partial sort).
    for (let i = 0; i < list.length; i++) {
      for (let j = i; j < Math.floor(list.length / 2); ++j) {
        const ballA = list[j];
        const ballB = list[i];
        if (ballB.Depth > ballA.Depth) {
          list[i] = ballA;
          list[j] = ballB;
        }
      }
    }
    // Save what is under each ball, then paint the ball.
    for (let index = 0; index < list.length; ++index) {
      const ball = list[index];
      const dirty = ball.DirtyRect;
      if (ball.Bmp && rectangle_clip(ball.BmpRect, this.vscreen_rect, ball.DirtyRect)) {
        const x = dirty.XPosition;
        const y = dirty.YPosition;
        copy_bitmap(this.ball_bitmap[index], dirty.Width, dirty.Height, 0, 0, this.vscreen, x, y);
        zpaint_flat(dirty.Width, dirty.Height, this.vscreen, x, y, this.zscreen, x, y,
          ball.Bmp, x - ball.BmpRect.XPosition, y - ball.BmpRect.YPosition, ball.Depth & 0xffff);
      } else {
        dirty.Width = -1;
      }
    }
  },

  unpaint_balls() {
    for (let index = this.ball_list.length - 1; index >= 0; index--) {
      const ball = this.ball_list[index];
      const d = ball.DirtyRect;
      if (d.Width > 0) copy_bitmap(this.vscreen, d.Width, d.Height, d.XPosition, d.YPosition, this.ball_bitmap[index], 0, 0);
      ball.DirtyRectPrev = copyRect(d);
    }
  },

  shift(offsetX, offsetY) {
    this.offset_x += offsetX;
    this.offset_y += offsetY;
  },

  // Each sprite gets the list of sprites whose bounds overlap its own.
  build_occlude_list() {
    let spriteArr = null;
    for (const main of this.sprite_list) {
      main.SpriteArray = null;
      if (!main.UnknownFlag && main.BoundingRect.Width !== -1) {
        if (!spriteArr) spriteArr = [];
        for (const ref of this.sprite_list) {
          if (!ref.UnknownFlag && ref.BoundingRect.Width !== -1 && rectangle_clip(main.BoundingRect, ref.BoundingRect, null)) {
            spriteArr.push(ref);
          }
        }
        if (main.Bmp && spriteArr.length < 2) spriteArr.length = 0;
        if (spriteArr.length) {
          main.SpriteArray = spriteArr;
          spriteArr = null;
        }
      }
    }
  },
};
