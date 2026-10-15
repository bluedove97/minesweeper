// Game-time timers, ported from timer.cpp. Times are in pb.time_ticks (ms).
// Callbacks receive (timerId, caller) like the original.

import { pb } from './pb.js';

const MAX_COUNT = 150;
let active = []; // sorted by TargetTime, ties in insertion order
let setCount = 1;

export const timer = {
  init() {
    active = [];
    setCount = 1;
  },

  kill(timerId) {
    const index = active.findIndex(t => t.TimerId === timerId);
    if (index < 0) return 0;
    active.splice(index, 1);
    return timerId;
  },

  set(time, caller, callback) {
    if (active.length >= MAX_COUNT) return 0;
    const targetTime = pb.time_ticks + Math.trunc(time * 1000);
    let index = 0;
    while (index < active.length && targetTime >= active[index].TargetTime) index++;
    const entry = { TimerId: setCount, TargetTime: targetTime, caller, callback };
    active.splice(index, 0, entry);
    setCount++;
    if (setCount > 0x7fffffff) setCount = 1;
    return entry.TimerId;
  },

  // Fires at most two due timers, plus any that are 100 ms or more overdue.
  check() {
    let index = 0;
    while (active.length && pb.time_ticks >= active[0].TargetTime) {
      const current = active.shift();
      if (current.callback) current.callback(current.TimerId, current.caller);
      ++index;
      if (index > 1) break;
      if (!active.length) return index;
    }
    while (active.length && pb.time_ticks >= active[0].TargetTime + 100) {
      const current = active.shift();
      if (current.callback) current.callback(current.TimerId, current.caller);
      ++index;
    }
    return index;
  },
};
