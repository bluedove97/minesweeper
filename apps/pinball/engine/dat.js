// PINBALL.DAT ("PARTOUT(4.0)RESOURCE") reader, ported from partman.cpp,
// GroupData.cpp, gdrv.cpp (bitmaps, palette) and zdrv.cpp (depth maps).
//
// Pixels are stored as Uint32 in canvas byte order (RGBA in memory, so
// 0xAABBGGRR as a little-endian number). 0 is transparent, like the
// original's ColorRgba{0}.

export const FieldTypes = {
  ShortValue: 0,
  Bitmap8bit: 1,
  GroupName: 3,
  Palette: 5,
  String: 9,
  ShortArray: 10,
  FloatArray: 11,
  Bitmap16bit: 12,
};

export const BitmapTypes = { None: 0, RawBitmap: 1, DibBitmap: 2, Spliced: 3 };

// fullscrn::resolution_array; 3D Pinball data only has resolution 0.
export const resolution_array = [
  { ScreenWidth: 640, ScreenHeight: 480, TableWidth: 600, TableHeight: 416 },
  { ScreenWidth: 800, ScreenHeight: 600, TableWidth: 752, TableHeight: 520 },
  { ScreenWidth: 1024, ScreenHeight: 768, TableWidth: 960, TableHeight: 666 },
];
export const RESOLUTION = 0;

const FIELD_SIZE = [2, -1, 2, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 0];

export const rgba = (r, g, b, a = 255) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;

export class Bitmap8 {
  constructor(width, height, indexed = true) {
    this.Width = width;
    this.Height = height;
    this.Stride = width;
    this.IndexedStride = width;
    this.BitmapType = BitmapTypes.DibBitmap;
    this.XPosition = 0;
    this.YPosition = 0;
    this.Resolution = 0;
    this.IndexedBmpPtr = indexed ? new Uint8Array(height * width) : null;
    this.BmpBufPtr1 = new Uint32Array(height * width);
  }
}

export class ZMap {
  constructor(width, height, stride) {
    this.Resolution = 0;
    this.Width = width;
    this.Height = height;
    this.Stride = stride >= 0 ? stride : (width & 3 ? width - (width & 3) + 4 : width);
    this.ZPtr1 = new Uint16Array(this.Stride * height);
  }
}

export function zmapFill(zMap, width, height, xOff, yOff, value) {
  let ptr = zMap.Stride * yOff + xOff;
  for (let y = height; y > 0; --y) {
    zMap.ZPtr1.fill(value, ptr, ptr + width);
    ptr += zMap.Stride;
  }
}

// Bottom-up storage: swap rows so that row 0 is the top.
function flipZMap(zMap) {
  const { Stride, Width, Height, ZPtr1 } = zMap;
  for (let top = 0, bottom = Height - 1; top < bottom; top++, bottom--) {
    for (let x = 0; x < Width; x++) {
      const a = top * Stride + x;
      const b = bottom * Stride + x;
      const tmp = ZPtr1[a];
      ZPtr1[a] = ZPtr1[b];
      ZPtr1[b] = tmp;
    }
  }
}

class Entry {
  constructor(type, bytes, fieldSize) {
    this.EntryType = type;
    this.FieldSize = fieldSize;
    this.bytes = bytes; // Uint8Array copy, or a Bitmap8 / ZMap
  }

  // Typed view of the data, as the original reinterpret_casts the buffer.
  value() {
    if (this.cached !== undefined) return this.cached;
    const b = this.bytes;
    switch (this.EntryType) {
      case FieldTypes.Bitmap8bit:
      case FieldTypes.Bitmap16bit:
        this.cached = b;
        break;
      case FieldTypes.GroupName:
      case FieldTypes.String: {
        let end = b.indexOf(0);
        if (end < 0) end = b.length;
        this.cached = String.fromCharCode(...b.subarray(0, end));
        break;
      }
      case FieldTypes.FloatArray:
        this.cached = new Float32Array(b.buffer, b.byteOffset, b.length >> 2);
        break;
      case FieldTypes.Palette:
        this.cached = b;
        break;
      default:
        this.cached = new Int16Array(b.buffer, b.byteOffset, b.length >> 1);
    }
    return this.cached;
  }
}

class GroupData {
  constructor(groupId) {
    this.GroupId = groupId;
    this.GroupName = '';
    this.Entries = [];
    this.Bitmaps = [null, null, null];
    this.ZMaps = [null, null, null];
    this.NeedsSort = false;
  }

  AddEntry(entry) {
    let addEntry = true;
    switch (entry.EntryType) {
      case FieldTypes.GroupName:
        this.GroupName = entry.value();
        break;
      case FieldTypes.Bitmap8bit: {
        const src = entry.bytes;
        if (src.BitmapType === BitmapTypes.Spliced) {
          // Split the spliced bitmap into a plain bitmap and a depth map early.
          const bmp = new Bitmap8(src.Width, src.Height, true);
          const zMap = new ZMap(src.Width, src.Height, src.Width);
          splitSplicedBitmap(src, bmp, zMap);
          this.NeedsSort = true;
          addEntry = false;
          this.AddEntry(new Entry(FieldTypes.Bitmap8bit, bmp, -1));
          this.AddEntry(new Entry(FieldTypes.Bitmap16bit, zMap, -1));
        } else {
          this.Bitmaps[src.Resolution] = src;
        }
        break;
      }
      case FieldTypes.Bitmap16bit:
        flipZMap(entry.bytes);
        this.ZMaps[entry.bytes.Resolution] = entry.bytes;
        break;
      default:
        break;
    }
    if (addEntry) this.Entries.push(entry);
  }

  FinalizeGroup() {
    if (this.NeedsSort) {
      this.NeedsSort = false;
      // Entries are ordered by type; Array.prototype.sort is stable.
      this.Entries.sort((a, b) => a.EntryType - b.EntryType);
    }
  }
}

function splitSplicedBitmap(srcBmp, bmp, zMap) {
  bmp.IndexedBmpPtr.fill(0xff);
  bmp.XPosition = srcBmp.XPosition;
  bmp.YPosition = srcBmp.YPosition;
  bmp.Resolution = srcBmp.Resolution;
  zmapFill(zMap, zMap.Width, zMap.Height, 0, 0, 0xffff);
  zMap.Resolution = srcBmp.Resolution;

  const tableWidth = resolution_array[srcBmp.Resolution].TableWidth;
  const src = srcBmp.IndexedBmpPtr;
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  // Records: int16 skip, uint16 count, then per pixel a uint16 depth followed by
  // one colour byte (the original walks a uint16 pointer one byte at a time).
  let p = 0;
  for (let dstInd = 0; ;) {
    let stride = view.getInt16(p, true);
    p += 2;
    if (stride < 0) break;
    if (stride > bmp.Width) stride += bmp.Width - tableWidth;
    dstInd += stride;
    const count = view.getUint16(p, true);
    p += 2;
    for (let i = 0; i < count; i++) {
      const depth = view.getUint16(p, true);
      p += 2;
      bmp.IndexedBmpPtr[dstInd] = src[p];
      zMap.ZPtr1[dstInd] = depth;
      p += 1;
      dstInd++;
    }
  }
}

export class DatFile {
  constructor() {
    this.AppName = '';
    this.Description = '';
    this.Groups = [];
  }

  field(groupIndex, type) {
    for (const entry of this.Groups[groupIndex].Entries) {
      if (entry.EntryType === type) return entry.value();
      if (entry.EntryType > type) break;
    }
    return null;
  }

  field_nth(groupIndex, type, skipFirstN) {
    let skipCount = 0;
    for (const entry of this.Groups[groupIndex].Entries) {
      if (entry.EntryType > type) break;
      if (entry.EntryType === type && skipCount++ === skipFirstN) return entry.value();
    }
    return null;
  }

  field_size_nth(groupIndex, type, skipFirstN) {
    let skipCount = 0;
    for (const entry of this.Groups[groupIndex].Entries) {
      if (entry.EntryType > type) return 0;
      if (entry.EntryType === type && skipCount++ === skipFirstN) return entry.FieldSize;
    }
    return 0;
  }

  field_size(groupIndex, type) {
    return this.field_size_nth(groupIndex, type, 0);
  }

  record_labeled(name) {
    for (let groupIndex = this.Groups.length - 1; groupIndex >= 0; --groupIndex) {
      if (this.field(groupIndex, FieldTypes.GroupName) === name) return groupIndex;
    }
    return -1;
  }

  field_labeled(name, type) {
    const groupIndex = this.record_labeled(name);
    return groupIndex < 0 ? null : this.field(groupIndex, type);
  }

  GetBitmap(groupIndex) {
    return this.Groups[groupIndex].Bitmaps[RESOLUTION];
  }

  GetZMap(groupIndex) {
    return this.Groups[groupIndex].ZMaps[RESOLUTION];
  }

  // Adds the message font (PB_MSGFT) as groups "pbmsg_ft", "char 33='!'", ...
  AddMsgFont(fontBytes, fontName) {
    const view = new DataView(fontBytes.buffer, fontBytes.byteOffset, fontBytes.byteLength);
    const gapWidth = view.getInt16(0, true);
    const height = view.getInt16(4, true);
    let groupId = this.Groups[this.Groups.length - 1].GroupId + 1;
    let ptr = 134;
    for (let charInd = 32; charInd < 128; charInd++, groupId++) {
      const width = fontBytes[ptr];
      const data = fontBytes.subarray(ptr + 1, ptr + 1 + width * height);
      ptr += width * height + 1;

      const bmp = new Bitmap8(width, height, true);
      // Store bottom-up, like the other DIB bitmaps.
      for (let y = 0; y < height; ++y) {
        bmp.IndexedBmpPtr.set(data.subarray(y * width, (y + 1) * width), (height - 1 - y) * width);
      }
      const group = new GroupData(groupId);
      group.AddEntry(new Entry(FieldTypes.Bitmap8bit, bmp, -1));
      if (charInd === 32) {
        group.AddEntry(new Entry(FieldTypes.GroupName, asciiBytes(fontName), -1));
        const gaps = new Uint8Array(2);
        new DataView(gaps.buffer).setInt16(0, gapWidth, true);
        group.AddEntry(new Entry(FieldTypes.ShortArray, gaps, 2));
      } else {
        group.AddEntry(new Entry(FieldTypes.GroupName, asciiBytes(`char ${charInd}='${String.fromCharCode(charInd)}'`), -1));
      }
      this.Groups.push(group);
    }
  }

  Finalize(msgFont) {
    if (msgFont && this.record_labeled('pbmsg_ft') < 0) this.AddMsgFont(msgFont, 'pbmsg_ft');
    for (const group of this.Groups) group.FinalizeGroup();
  }
}

function asciiBytes(text) {
  const bytes = new Uint8Array(text.length + 1);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

// partman::load_records for 3D Pinball (non Full Tilt) data.
export function loadRecords(arrayBuffer, msgFont) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const signature = String.fromCharCode(...bytes.subarray(0, 20));
  if (signature !== 'PARTOUT(4.0)RESOURCE' || bytes[20] !== 0) return null;

  const datFile = new DatFile();
  const text = (from, len) => {
    const sub = bytes.subarray(from, from + len);
    const end = sub.indexOf(0);
    return String.fromCharCode(...sub.subarray(0, end < 0 ? len : end));
  };
  datFile.AppName = text(21, 50);
  datFile.Description = text(71, 100);
  const numberOfGroups = view.getUint16(175, true);
  const unknown = view.getUint16(181, true);

  let p = 183 + unknown;
  for (let groupIndex = 0; groupIndex < numberOfGroups; ++groupIndex) {
    const entryCount = bytes[p++];
    const group = new GroupData(groupIndex);
    for (let entryIndex = 0; entryIndex < entryCount; ++entryIndex) {
      const entryType = bytes[p++];
      const fixedSize = FIELD_SIZE[entryType];
      let fieldSize;
      if (fixedSize >= 0) {
        fieldSize = fixedSize;
      } else {
        fieldSize = view.getUint32(p, true);
        p += 4;
      }

      let data;
      if (entryType === FieldTypes.Bitmap8bit) {
        const resolution = bytes[p];
        const width = view.getInt16(p + 1, true);
        const height = view.getInt16(p + 3, true);
        const xPos = view.getInt16(p + 5, true);
        const yPos = view.getInt16(p + 7, true);
        const size = view.getInt32(p + 9, true);
        const flags = bytes[p + 13];
        p += 14;
        const bmp = new Bitmap8(width, height, false);
        bmp.BitmapType = flags & 4 ? BitmapTypes.Spliced : flags & 2 ? BitmapTypes.DibBitmap : BitmapTypes.RawBitmap;
        bmp.XPosition = xPos;
        bmp.YPosition = yPos;
        bmp.Resolution = resolution;
        if (bmp.BitmapType !== BitmapTypes.Spliced && width % 4) bmp.IndexedStride = width - (width % 4) + 4;
        bmp.IndexedBmpPtr = bytes.slice(p, p + size);
        p += size;
        data = bmp;
      } else if (entryType === FieldTypes.Bitmap16bit) {
        const width = view.getInt16(p, true);
        const height = view.getInt16(p + 2, true);
        const stride = view.getInt16(p + 4, true);
        const length = fieldSize - 14;
        p += 14;
        let zMap;
        if (stride * height * 2 === length) {
          zMap = new ZMap(width, height, stride);
          zMap.ZPtr1.set(new Uint16Array(arrayBuffer.slice(p, p + length)));
        } else {
          // 3DPB has zeroed zMap headers in two groups; skip them.
          zMap = new ZMap(0, 0, 0);
        }
        p += length;
        data = zMap;
      } else {
        data = bytes.slice(p, p + fieldSize);
        p += fieldSize;
      }
      group.AddEntry(new Entry(entryType, data, fieldSize));
    }
    datFile.Groups.push(group);
  }

  datFile.Finalize(msgFont);
  return datFile;
}

// gdrv::display_palette: Windows system colours, the table palette, white at 255.
export function displayPalette(datFile, paletteBytes) {
  const palette = new Uint32Array(256);
  const sys = [
    0, rgba(0x80, 0, 0), rgba(0, 0x80, 0), rgba(0x80, 0x80, 0), rgba(0, 0, 0x80),
    rgba(0x80, 0, 0x80), rgba(0, 0x80, 0x80), rgba(0xc0, 0xc0, 0xc0), rgba(0xc0, 0xdc, 0xc0), rgba(0xa6, 0xca, 0xf0),
  ];
  palette.set(sys);
  for (let index = 10; paletteBytes && index < 246; index++) {
    const o = index * 4;
    palette[index] = rgba(paletteBytes[o + 2], paletteBytes[o + 1], paletteBytes[o]);
  }
  palette[255] = rgba(255, 255, 255);

  for (const group of datFile.Groups) {
    for (const bmp of group.Bitmaps) {
      if (bmp) applyPalette(bmp, palette);
    }
  }
  return palette;
}

// Applies the palette and flips the bottom-up DIB rows.
function applyPalette(bmp, palette) {
  if (bmp.BitmapType === BitmapTypes.None) return;
  let dst = 0;
  for (let y = bmp.Height - 1; y >= 0; y--) {
    let src = bmp.IndexedStride * y;
    for (let x = 0; x < bmp.Width; x++) bmp.BmpBufPtr1[dst++] = palette[bmp.IndexedBmpPtr[src++]];
  }
}
