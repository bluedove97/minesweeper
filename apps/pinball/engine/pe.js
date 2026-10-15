// Reads one named resource out of a PE (pinball.exe), e.g. the RCDATA
// "PBMSG_FT" message font the original loads with FindResource.

const RT_RCDATA = 10;

export function findResource(bytes, typeId, name) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(0, true) !== 0x5a4d) return null; // "MZ"
  const pe = view.getUint32(0x3c, true);
  if (view.getUint32(pe, true) !== 0x4550) return null; // "PE\0\0"
  const sectionCount = view.getUint16(pe + 6, true);
  const optSize = view.getUint16(pe + 20, true);
  const opt = pe + 24;
  const magic = view.getUint16(opt, true);
  const dataDirs = opt + (magic === 0x20b ? 112 : 96);
  const resourceRva = view.getUint32(dataDirs + 2 * 8, true);
  if (!resourceRva) return null;

  const sections = [];
  for (let i = 0, s = opt + optSize; i < sectionCount; i++, s += 40) {
    sections.push({
      va: view.getUint32(s + 12, true),
      size: Math.max(view.getUint32(s + 8, true), view.getUint32(s + 16, true)),
      raw: view.getUint32(s + 20, true),
    });
  }
  const toOffset = rva => {
    const s = sections.find(sec => rva >= sec.va && rva < sec.va + sec.size);
    return s ? rva - s.va + s.raw : -1;
  };
  const base = toOffset(resourceRva);
  if (base < 0) return null;

  const readName = offset => {
    const len = view.getUint16(base + offset, true);
    let text = '';
    for (let i = 0; i < len; i++) text += String.fromCharCode(view.getUint16(base + offset + 2 + i * 2, true));
    return text;
  };
  // Finds the entry in a resource directory by numeric id or (upper-case) name.
  const findEntry = (dir, key) => {
    const named = view.getUint16(base + dir + 12, true);
    const ids = view.getUint16(base + dir + 14, true);
    for (let i = 0; i < named + ids; i++) {
      const e = base + dir + 16 + i * 8;
      const nameField = view.getUint32(e, true);
      const target = view.getUint32(e + 4, true);
      const matches = nameField & 0x80000000
        ? typeof key === 'string' && readName(nameField & 0x7fffffff).toUpperCase() === key
        : key === undefined || nameField === key;
      if (matches) return target;
    }
    return null;
  };

  const typeDir = findEntry(0, typeId);
  if (typeDir === null || !(typeDir & 0x80000000)) return null;
  const nameDir = findEntry(typeDir & 0x7fffffff, name.toUpperCase());
  if (nameDir === null || !(nameDir & 0x80000000)) return null;
  const langEntry = findEntry(nameDir & 0x7fffffff, undefined); // first language
  if (langEntry === null || langEntry & 0x80000000) return null;
  const dataRva = view.getUint32(base + langEntry, true);
  const dataSize = view.getUint32(base + langEntry + 4, true);
  const offset = toOffset(dataRva);
  return offset < 0 ? null : bytes.slice(offset, offset + dataSize);
}

export const findMessageFont = exeBytes => findResource(exeBytes, RT_RCDATA, 'PBMSG_FT');
