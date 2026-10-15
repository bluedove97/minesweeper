// Table data queries, ported from loader.cpp. Sound is not played; a sound
// id only carries the clip duration, which the game logic uses for timing.

import { FieldTypes } from './dat.js';

let table = null;
let soundList = []; // index 0 unused: { GroupIndex, Duration }
let soundDurations = new Map(); // file name (upper case) -> seconds

export const loader = {
  get loader_table() {
    return table;
  },

  // Durations of the original WAV files, when they are available.
  setSoundDurations(map) {
    soundDurations = map;
  },

  loadfrom(datFile) {
    table = datFile;
    soundList = [null];
    for (let groupIndex = 0; groupIndex < datFile.Groups.length; ++groupIndex) {
      const value = datFile.field(groupIndex, FieldTypes.ShortValue);
      if (value && value[0] === 202 && soundList.length < 65) soundList.push({ GroupIndex: groupIndex, Duration: 0, Loaded: false });
    }
  },

  // Names of the WAV files the table refers to.
  soundFileNames(datFile) {
    const names = [];
    for (let groupIndex = 0; groupIndex < datFile.Groups.length; ++groupIndex) {
      const value = datFile.field(groupIndex, FieldTypes.ShortValue);
      if (value && value[0] === 202) {
        const name = datFile.field(groupIndex, FieldTypes.String);
        if (name) names.push(name.toUpperCase());
      }
    }
    return names;
  },

  unload() {
    soundList = [null];
  },

  get_sound_id(groupIndex) {
    const soundIndex = soundList.findIndex((s, i) => i > 0 && s.GroupIndex === groupIndex);
    if (soundIndex < 0) return -1;
    const sound = soundList[soundIndex];
    if (!sound.Loaded) {
      sound.Loaded = true;
      const name = table.field(groupIndex, FieldTypes.String);
      sound.Duration = (name && soundDurations.get(name.toUpperCase())) || 0;
    }
    return soundIndex;
  },

  // loader::play_sound: plays nothing, returns the clip length in seconds.
  play_sound(soundIndex) {
    if (soundIndex <= 0) return 0;
    return soundList[soundIndex]?.Duration ?? 0;
  },

  query_handle(name) {
    return table.record_labeled(name);
  },

  query_visual_states(groupIndex) {
    if (groupIndex < 0) return -1;
    const shortArr = table.field(groupIndex, FieldTypes.ShortArray);
    return shortArr && shortArr[0] === 100 ? shortArr[1] : 1;
  },

  query_name(groupIndex) {
    if (groupIndex < 0) return null;
    return table.field(groupIndex, FieldTypes.GroupName);
  },

  // Returns the array after its leading tag, and its size as the original
  // reports it (taken from the first short array of the group).
  query_iattribute(groupIndex, firstValue) {
    if (groupIndex < 0) return { arr: null, size: 0 };
    for (let skipIndex = 0; ; ++skipIndex) {
      const shortArr = table.field_nth(groupIndex, FieldTypes.ShortArray, skipIndex);
      if (!shortArr) break;
      if (shortArr[0] === firstValue) {
        return { arr: shortArr.subarray(1), size: table.field_size(groupIndex, FieldTypes.ShortArray) / 2 - 1 };
      }
    }
    return { arr: null, size: 0 };
  },

  // query_float_attribute without a default returns the array after its tag
  // (or null); with a default it returns the first value.
  query_float_attribute(groupIndex, groupIndexOffset, firstValue, defVal) {
    const withDefault = arguments.length > 3;
    if (groupIndex < 0) return withDefault ? NaN : null;
    const stateId = this.state_id(groupIndex, groupIndexOffset);
    if (stateId < 0) return withDefault ? NaN : null;
    for (let skipIndex = 0; ; ++skipIndex) {
      const floatArr = table.field_nth(stateId, FieldTypes.FloatArray, skipIndex);
      if (!floatArr) break;
      if (((Math.floor(floatArr[0]) << 16) >> 16) === firstValue) return withDefault ? floatArr[1] : floatArr.subarray(1);
    }
    if (withDefault && !Number.isNaN(defVal)) return defVal;
    return withDefault ? NaN : null;
  },

  material(groupIndex, visual) {
    if (groupIndex < 0) return -1;
    const shortArr = table.field(groupIndex, FieldTypes.ShortValue);
    if (!shortArr || shortArr[0] !== 300) return -1;
    const floatArr = table.field(groupIndex, FieldTypes.FloatArray);
    if (!floatArr) return -1;
    const length = table.field_size(groupIndex, FieldTypes.FloatArray) / 4;
    for (let index = 0; index < length; index += 2) {
      switch (Math.floor(floatArr[index])) {
        case 301: visual.Smoothness = floatArr[index + 1]; break;
        case 302: visual.Elasticity = floatArr[index + 1]; break;
        case 304: visual.SoftHitSoundId = this.get_sound_id(Math.floor(floatArr[index + 1])); break;
        default: return -1;
      }
    }
    return 0;
  },

  state_id(groupIndex, groupIndexOffset) {
    const visualState = this.query_visual_states(groupIndex);
    if (visualState <= 0) return -1;
    let shortArr = table.field(groupIndex, FieldTypes.ShortValue);
    if (!shortArr || shortArr[0] !== 200) return -1;
    if (groupIndexOffset > visualState) return -1;
    if (!groupIndexOffset) return groupIndex;
    groupIndex += groupIndexOffset;
    shortArr = table.field(groupIndex, FieldTypes.ShortValue);
    if (!shortArr || shortArr[0] !== 201) return -1;
    return groupIndex;
  },

  kicker(groupIndex, kicker) {
    if (groupIndex < 0) return -1;
    const shortArr = table.field(groupIndex, FieldTypes.ShortValue);
    if (!shortArr || shortArr[0] !== 400) return -1;
    const floatArr = table.field(groupIndex, FieldTypes.FloatArray);
    if (!floatArr) return -1;
    const length = table.field_size(groupIndex, FieldTypes.FloatArray) / 4;
    let p = 0;
    for (let index = 0; index < length;) {
      const floorVal = Math.floor(floatArr[p++]);
      switch (floorVal) {
        case 401: kicker.Threshold = floatArr[p]; break;
        case 402: kicker.Boost = floatArr[p]; break;
        case 403: kicker.ThrowBallMult = floatArr[p]; break;
        case 404:
          kicker.ThrowBallAcceleration = { X: floatArr[p], Y: floatArr[p + 1], Z: floatArr[p + 2] };
          p += 3;
          index += 4;
          break;
        case 405: kicker.ThrowBallAngleMult = floatArr[p]; break;
        case 406: kicker.HardHitSoundId = this.get_sound_id(Math.floor(floatArr[p])); break;
        default: return -1;
      }
      if (floorVal !== 404) {
        p++;
        index += 2;
      }
    }
    return 0;
  },

  query_visual(groupIndex, groupIndexOffset, visual) {
    default_vsi(visual);
    if (groupIndex < 0) return -1;
    const stateId = this.state_id(groupIndex, groupIndexOffset);
    if (stateId < 0) return -1;

    visual.Bitmap = table.GetBitmap(stateId);
    visual.ZMap = table.GetZMap(stateId);

    const shortArr = table.field(stateId, FieldTypes.ShortArray);
    if (shortArr) {
      const count = table.field_size(stateId, FieldTypes.ShortArray) / 2;
      for (let p = 0; p < count;) {
        switch (shortArr[p]) {
          case 100:
            if (groupIndexOffset) return -1;
            break;
          case 300:
            if (this.material(shortArr[p + 1], visual)) return -1;
            break;
          case 304:
            visual.SoftHitSoundId = this.get_sound_id(shortArr[p + 1]);
            break;
          case 400:
            if (this.kicker(shortArr[p + 1], visual.Kicker)) return -1;
            break;
          case 406:
            visual.Kicker.HardHitSoundId = this.get_sound_id(shortArr[p + 1]);
            break;
          case 602:
            visual.CollisionGroup |= 1 << shortArr[p + 1];
            break;
          case 1100:
            visual.SoundIndex4 = this.get_sound_id(shortArr[p + 1]);
            break;
          case 1101:
            visual.SoundIndex3 = this.get_sound_id(shortArr[p + 1]);
            break;
          case 1500:
            p += 7;
            break;
          default:
            return -1;
        }
        p += 2;
      }
    }

    if (!visual.CollisionGroup) visual.CollisionGroup = 1;
    const floatArr = table.field(stateId, FieldTypes.FloatArray);
    if (!floatArr || floatArr[0] !== 600) return 0;

    visual.FloatArrCount = Math.trunc(table.field_size(stateId, FieldTypes.FloatArray) / 4 / 2) - 2;
    const floatVal = Math.trunc(Math.floor(floatArr[1]) - 1);
    if (floatVal === 0) visual.FloatArrCount = 1;
    else if (floatVal === 1) visual.FloatArrCount = 2;
    else if (floatVal !== visual.FloatArrCount) return -1;
    visual.FloatArr = floatArr.subarray(2);
    return 0;
  },
};

export function newVisual() {
  const visual = {};
  default_vsi(visual);
  return visual;
}

export function default_vsi(visual) {
  visual.CollisionGroup = 0;
  visual.Kicker = {
    Threshold: 8.9999999e10,
    Boost: 0,
    ThrowBallMult: 0,
    ThrowBallAcceleration: { X: 0, Y: 0, Z: 0 },
    ThrowBallAngleMult: 0,
    HardHitSoundId: 0,
  };
  visual.Smoothness = 0.94999999;
  visual.Elasticity = 0.60000002;
  visual.FloatArrCount = 0;
  visual.FloatArr = null;
  visual.SoftHitSoundId = 0;
  visual.Bitmap = null;
  visual.ZMap = null;
  visual.SoundIndex3 = 0;
  visual.SoundIndex4 = 0;
}
