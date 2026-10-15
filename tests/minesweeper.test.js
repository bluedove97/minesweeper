import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getInitState,
  getNearIndexes,
  insertMines,
  openCeil,
  openCeils,
  changeCeilState,
  remainMines,
  digitString,
} from '../apps/minesweeper/game.js';

// Build a started Beginner board with mines at exact indexes.
function boardWithMines(mineIndexes, difficulty = 'Beginner') {
  const state = getInitState(difficulty);
  const ceils = state.ceils.map(c => ({ ...c }));
  for (const m of mineIndexes) {
    ceils[m].minesAround = -10;
    getNearIndexes(m, state.rows, state.columns).forEach(n => (ceils[n].minesAround += 1));
  }
  return { ...state, ceils, status: 'started' };
}

test('config sizes', () => {
  for (const [d, n, m] of [['Beginner', 81, 10], ['Intermediate', 256, 40], ['Expert', 480, 99]]) {
    const s = getInitState(d);
    assert.equal(s.ceils.length, n);
    assert.equal(s.mines, m);
    assert.equal(s.status, 'new');
  }
});

test('neighbours respect edges', () => {
  assert.deepEqual(getNearIndexes(0, 9, 9).sort((a, b) => a - b), [1, 9, 10]);
  assert.deepEqual(getNearIndexes(8, 9, 9).sort((a, b) => a - b), [7, 16, 17]);
  assert.equal(getNearIndexes(40, 9, 9).length, 8);
  assert.equal(getNearIndexes(80, 9, 9).length, 3);
  assert.deepEqual(getNearIndexes(-1, 9, 9), []);
});

test('first click is never a mine and places the exact mine count', () => {
  for (let k = 0; k < 200; k++) {
    const first = k % 81;
    const s = insertMines(getInitState(), first);
    assert.equal(s.ceils.filter(c => c.minesAround < 0).length, 10);
    assert.ok(s.ceils[first].minesAround >= 0);
  }
});

test('mine counts are consistent', () => {
  const s = insertMines(getInitState('Expert'), 0);
  s.ceils.forEach((c, i) => {
    if (c.minesAround < 0) return;
    const n = getNearIndexes(i, s.rows, s.columns).filter(j => s.ceils[j].minesAround < 0).length;
    assert.equal(c.minesAround, n);
  });
});

test('flood fill opens zero region and its border, stops at flags', () => {
  let s = boardWithMines([80]);
  s = changeCeilState(s, 1); // flag a safe cell in the zero region
  s = openCeil(s, 0);
  assert.equal(s.ceils[1].state, 'flag');
  assert.equal(s.ceils[0].state, 'open');
  assert.equal(s.ceils[79].state, 'open'); // number next to mine
  assert.equal(s.ceils[80].state, 'cover');
});

test('number cell opens only itself', () => {
  let s = boardWithMines([0]);
  s = openCeil(s, 1);
  assert.deepEqual(s.ceils.filter(c => c.state === 'open').length, 1);
});

test('right click cycles cover -> flag -> ? -> cover', () => {
  let s = boardWithMines([0]);
  s = changeCeilState(s, 5);
  assert.equal(s.ceils[5].state, 'flag');
  s = changeCeilState(s, 5);
  assert.equal(s.ceils[5].state, 'unknown');
  s = changeCeilState(s, 5);
  assert.equal(s.ceils[5].state, 'cover');
});

test('clicking a flagged cell does nothing; ? cell can be opened', () => {
  let s = boardWithMines([0]);
  s = changeCeilState(s, 0);
  assert.equal(openCeil(s, 0), s);
  s = changeCeilState(s, 0); // '?'
  assert.equal(openCeil(s, 0).status, 'died');
});

test('game over reveals mines, marks misflags and the death cell', () => {
  let s = boardWithMines([0, 2, 40]);
  s = changeCeilState(s, 2); // correct flag
  s = changeCeilState(s, 50); // wrong flag
  s = openCeil(s, 0);
  assert.equal(s.status, 'died');
  assert.equal(s.ceils[0].state, 'die');
  assert.equal(s.ceils[2].state, 'flag');
  assert.equal(s.ceils[40].state, 'mine');
  assert.equal(s.ceils[50].state, 'misflagged');
  assert.equal(remainMines({ ...s, mines: 3 }), 1); // misflagged still counts
  assert.equal(openCeil(s, 5), s); // input ignored after death
  assert.equal(changeCeilState(s, 5), s);
});

test('win when every safe cell is open; mines get flagged', () => {
  let s = boardWithMines([80]);
  s = openCeil(s, 0);
  assert.equal(s.status, 'won');
  assert.equal(s.ceils[80].state, 'flag');
  assert.equal(remainMines({ ...s, mines: 1 }), 0);
});

test('chord opens neighbours when flags match', () => {
  let s = boardWithMines([0, 80]);
  s = openCeil(s, 10); // shows 1
  assert.equal(s.ceils[10].minesAround, 1);
  assert.equal(openCeils(s, 10), s); // no flags yet: nothing
  s = changeCeilState(s, 0);
  s = openCeils(s, 10);
  assert.equal(s.ceils[1].state, 'open');
  assert.equal(s.ceils[20].state, 'open');
});

test('chord with a wrong flag hits the unflagged mine, including index 0', () => {
  let s = boardWithMines([0, 80]);
  s = openCeil(s, 10);
  s = changeCeilState(s, 1); // wrong flag; mine is at 0
  s = openCeils(s, 10);
  assert.equal(s.status, 'died');
  assert.equal(s.ceils[0].state, 'die');
});

test('first click on new board starts the game', () => {
  const s = openCeil(getInitState(), 40, () => 0.5);
  assert.ok(['started', 'won'].includes(s.status));
  assert.equal(s.ceils[40].state, 'open');
});

test('LED digits', () => {
  assert.equal(digitString(0), '000');
  assert.equal(digitString(7), '007');
  assert.equal(digitString(42), '042');
  assert.equal(digitString(1234), '999');
  assert.equal(digitString(-3), '-03');
  assert.equal(digitString(-100), '-00');
});
