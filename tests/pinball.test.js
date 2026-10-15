import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRecords, displayPalette, FieldTypes, rgba } from '../apps/pinball/engine/dat.js';
import { vec, ray, line, line_init, ray_intersect_line, ray_intersect_circle, basic_collision, NO_HIT } from '../apps/pinball/engine/maths.js';
import { timer } from '../apps/pinball/engine/timer.js';
import { pb, score } from '../apps/pinball/engine/pb.js';
import { edges, TEdgeManager, TLine, flagRef } from '../apps/pinball/engine/edges.js';
import { sprintf, get_rc_string } from '../apps/pinball/engine/strings.js';

// ---------- a synthetic PARTOUT(4.0)RESOURCE file ----------

class Writer {
  constructor() {
    this.bytes = [];
  }

  u8(v) { this.bytes.push(v & 0xff); }
  i16(v) { this.u8(v); this.u8(v >> 8); }
  i32(v) { this.i16(v); this.i16(v >> 16); }
  f32(v) {
    const b = new Uint8Array(new Float32Array([v]).buffer);
    this.bytes.push(...b);
  }
  str(text, len) {
    for (let i = 0; i < len; i++) this.u8(i < text.length ? text.charCodeAt(i) : 0);
  }
}

function entry(w, type, payload) {
  w.u8(type);
  if (type !== FieldTypes.ShortValue) w.i32(payload.length);
  w.bytes.push(...payload);
}

const bytesOf = fill => {
  const w = new Writer();
  fill(w);
  return w.bytes;
};

function buildDat() {
  const groups = [];
  // 0: "background" with a palette and a 2x2 raw bitmap (rows stored bottom-up, stride 4).
  groups.push([
    [FieldTypes.Bitmap8bit, bytesOf(w => {
      w.u8(0); w.i16(2); w.i16(2); w.i16(5); w.i16(6); w.i32(8); w.u8(1);
      w.u8(10); w.u8(11); w.u8(0); w.u8(0); // bottom row
      w.u8(12); w.u8(13); w.u8(0); w.u8(0); // top row
    })],
    [FieldTypes.GroupName, bytesOf(w => w.str('background', 11))],
    [FieldTypes.Palette, bytesOf(w => {
      for (let i = 0; i < 256; i++) { w.u8(i); w.u8(i + 1); w.u8(i + 2); w.u8(0); } // B, G, R, -
    })],
  ]);
  // 1: a spliced 3x2 bitmap: skip 1, two pixels; then skip to the next row's first pixel.
  groups.push([
    [FieldTypes.ShortValue, bytesOf(w => w.i16(200))],
    [FieldTypes.Bitmap8bit, bytesOf(w => {
      const body = bytesOf(b => {
        b.i16(1); b.i16(2); // skip 1, 2 pixels
        b.i16(0x1111); b.u8(20);
        b.i16(0x2222); b.u8(21);
        b.i16(0); b.i16(1); // no skip, 1 pixel (index 3: second row)
        b.i16(0x3333); b.u8(22);
        b.i16(-1);
      });
      w.u8(0); w.i16(3); w.i16(2); w.i16(0); w.i16(0); w.i32(body.length); w.u8(4);
      w.bytes.push(...body);
    })],
    [FieldTypes.GroupName, bytesOf(w => w.str('spliced', 8))],
    [FieldTypes.FloatArray, bytesOf(w => { w.f32(600); w.f32(1.5); })],
  ]);

  const body = bytesOf(w => {
    for (const g of groups) {
      w.u8(g.length);
      for (const [type, payload] of g) entry(w, type, payload);
    }
  });
  const file = bytesOf(w => {
    w.str('PARTOUT(4.0)RESOURCE', 21);
    w.str('3D-Pinball', 50);
    w.str('test', 100);
    w.i32(183 + body.length);
    w.i16(groups.length);
    w.i32(body.length);
    w.i16(0);
  });
  return new Uint8Array([...file, ...body]).buffer;
}

test('dat: groups, names and typed fields', () => {
  const dat = loadRecords(buildDat(), null);
  assert.equal(dat.Groups.length, 2);
  assert.equal(dat.AppName, '3D-Pinball');
  assert.equal(dat.record_labeled('background'), 0);
  assert.equal(dat.record_labeled('spliced'), 1);
  assert.equal(dat.record_labeled('missing'), -1);
  assert.equal(dat.field(1, FieldTypes.ShortValue)[0], 200);
  assert.deepEqual([...dat.field(1, FieldTypes.FloatArray)], [600, 1.5]);
  assert.equal(dat.field_size(1, FieldTypes.FloatArray), 8);
});

test('dat: palette is applied and DIB rows are flipped', () => {
  const dat = loadRecords(buildDat(), null);
  displayPalette(dat, dat.field_labeled('background', FieldTypes.Palette));
  const bmp = dat.GetBitmap(0);
  assert.equal(bmp.IndexedStride, 4);
  // Top row comes from the last stored row; colour i is (R=i+2, G=i+1, B=i).
  assert.deepEqual([...bmp.BmpBufPtr1], [rgba(14, 13, 12), rgba(15, 14, 13), rgba(12, 11, 10), rgba(13, 12, 11)]);
});

test('dat: spliced bitmaps split into colour and depth, bottom-up', () => {
  const dat = loadRecords(buildDat(), null);
  const bmp = dat.GetBitmap(1);
  const zMap = dat.GetZMap(1);
  assert.equal(bmp.Width, 3);
  // Stored order: [_, 20, 21 | 22, _, _]; the depth map is flipped right away.
  assert.deepEqual([...bmp.IndexedBmpPtr], [0xff, 20, 21, 22, 0xff, 0xff]);
  assert.deepEqual([...zMap.ZPtr1], [0x3333, 0xffff, 0xffff, 0xffff, 0x1111, 0x2222]);
  // Entries were re-sorted by type after the split.
  const types = dat.Groups[1].Entries.map(e => e.EntryType);
  assert.deepEqual(types, [...types].sort((a, b) => a - b));
});

test('dat: rejects other files', () => {
  assert.equal(loadRecords(new ArrayBuffer(200), null), null);
});

// ---------- maths ----------

test('ray hits a line from its normal side only', () => {
  const l = line();
  line_init(l, 0, 0, 10, 0); // PerpendicularL = (Dir.Y, -Dir.X) = (0, -1)
  const r = ray();
  r.Origin = vec(5, -5);
  r.Direction = vec(0, 1);
  r.MaxDistance = 10;
  assert.equal(ray_intersect_line(r, l), 5);
  assert.deepEqual([l.RayIntersect.X, l.RayIntersect.Y], [5, 0]);
  r.Origin = vec(5, 5);
  r.Direction = vec(0, -1);
  assert.equal(ray_intersect_line(r, l), NO_HIT);
});

test('ray against circle', () => {
  const r = ray();
  r.Origin = vec(0, 0);
  r.Direction = vec(1, 0);
  r.MaxDistance = 10;
  assert.equal(ray_intersect_circle(r, { Center: vec(5, 0), RadiusSq: 1 }), 4);
  assert.equal(ray_intersect_circle(r, { Center: vec(5, 3), RadiusSq: 1 }), NO_HIT);
  r.MaxDistance = 3;
  assert.equal(ray_intersect_circle(r, { Center: vec(5, 0), RadiusSq: 1 }), NO_HIT);
});

test('basic_collision reflects and loses speed by elasticity', () => {
  const ball = { Position: vec(), Acceleration: vec(0, 1), Speed: 10 };
  const projSpeed = basic_collision(ball, vec(1, 2), vec(0, -1), 0.5, 1, 1e9, 0);
  assert.equal(projSpeed, 10);
  assert.deepEqual([ball.Position.X, ball.Position.Y], [1, 2]);
  assert.equal(ball.Speed, 5);
  assert.ok(ball.Acceleration.Y < 0);
});

// ---------- timer ----------

test('timers fire in target order, two per check unless overdue', () => {
  timer.init();
  pb.time_ticks = 0;
  const fired = [];
  const cb = (id, caller) => fired.push(caller);
  timer.set(0.03, 'c', cb);
  timer.set(0.01, 'a', cb);
  const b = timer.set(0.02, 'b', cb);
  timer.set(0.02, 'b2', cb);
  assert.equal(timer.kill(b), b);
  pb.time_ticks = 40;
  timer.check();
  assert.deepEqual(fired, ['a', 'b2']);
  timer.check();
  assert.deepEqual(fired, ['a', 'b2', 'c']);

  // 100 ms or more overdue timers all fire at once.
  fired.length = 0;
  pb.time_ticks = 0;
  for (const name of ['x', 'y', 'z', 'w']) timer.set(0.001, name, cb);
  pb.time_ticks = 500;
  timer.check();
  assert.deepEqual(fired, ['x', 'y', 'z', 'w']);
});

// ---------- edge grid ----------

test('lines are placed in every grid box they cross', () => {
  edges.edge_manager = new TEdgeManager(0, 0, 100, 150); // 10x15 boxes of 10x10
  const owner = { ActiveFlag: 1 };
  const l = new TLine(owner, flagRef(owner), 1, 5, 5, 35, 25);
  l.place_in_grid();
  const boxes = edges.edge_manager.BoxArray
    .map((box, i) => (box.EdgeList.includes(l) ? [i % 10, Math.floor(i / 10)] : null))
    .filter(Boolean);
  assert.deepEqual(boxes[0], [0, 0]);
  assert.deepEqual(boxes[boxes.length - 1], [3, 2]);
  assert.ok(boxes.length >= 4 && boxes.length <= 6);
});

// ---------- text ----------

test('sprintf and score formatting', () => {
  assert.equal(sprintf(64, get_rc_string(78), 750000), 'Mission Completed\n750000');
  assert.equal(sprintf(64, get_rc_string(79), 'Science'), 'Science Mission Selected');
  assert.equal(sprintf(8, '%d %d', 12345, 678), '12345 6');
  assert.equal(score.string_format(-999), '');
  assert.equal(score.string_format(999), '999');
  assert.equal(score.string_format(1234567), '1,234,567');
  assert.equal(score.string_format(1000000005), '1,000,000,005');
});
