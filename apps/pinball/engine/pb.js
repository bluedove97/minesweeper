// Game state and frame loop, ported from pb.cpp, score.cpp, nudge.cpp and
// high_score.cpp. The host page (app.js) supplies input, dialogs and storage
// through pb.host.

import { FieldTypes, displayPalette, resolution_array, RESOLUTION } from './dat.js';
import { vec, normalize_2d, vector_add, ray as newRay, RandFloat } from './maths.js';
import { render, proj, copy_bitmap, copy_bitmap_w_transparency, fill_bitmap } from './render.js';
import { timer } from './timer.js';
import { loader } from './loader.js';
import { edges } from './edges.js';
import { get_rc_string } from './strings.js';
import { TPinballTable, TBall } from './components.js';
import { control } from './control.js';

// ---------- pb ----------

export const pb = {
  MainTable: null,
  record_table: null,
  time_ticks: 0,
  time_now: 0,
  time_next: 0,
  ball_speed_limit: 0,
  time_ticks_remainder: 0,
  game_mode: 2,
  demo_mode: 0,
  mode_countdown_: 0,
  cheat_mode: false,
  FullTiltMode: false,
  highscore_table: [],

  // winmain flags that drive the menu.
  LaunchBallEnabled: true,
  HighScoresEnabled: true,
  DemoActive: false,
  single_step: false,

  // Set by the host: { players(), showHighScoreEntry(table, score, pos, name, done),
  // showHighScores(table), loadHighScores(), saveHighScores(table) }.
  host: null,

  init(datFile) {
    this.record_table = datFile;
    this.time_ticks = 0;
    this.time_now = 0;
    this.time_next = 0;
    this.time_ticks_remainder = 0;
    this.demo_mode = 0;
    this.single_step = false;
    this.cheat_mode = false;
    score.load_msg_font('pbmsg_ft');

    displayPalette(datFile, datFile.field_labeled('background', FieldTypes.Palette));
    const backgroundBmp = datFile.GetBitmap(datFile.record_labeled('background'));
    const cameraInfoId = datFile.record_labeled('camera_info') + RESOLUTION;
    const cameraInfo = datFile.field(cameraInfoId, FieldTypes.FloatArray);
    const resInfo = resolution_array[RESOLUTION];
    let zMin = 0;
    let zScaler = 0;
    if (cameraInfo) {
      proj.init(Array.from(cameraInfo.subarray(0, 12)), cameraInfo[12], resInfo.TableWidth * 0.5, resInfo.TableHeight * 0.5);
      zMin = cameraInfo[13];
      zScaler = cameraInfo[14];
    }

    render.init(null, zMin, zScaler, resInfo.TableWidth, resInfo.TableHeight);
    copy_bitmap(render.vscreen, backgroundBmp.Width, backgroundBmp.Height, backgroundBmp.XPosition, backgroundBmp.YPosition, backgroundBmp, 0, 0);

    loader.loadfrom(datFile);
    this.mode_change(3);
    timer.init();
    nudge.reset();
    this.MainTable = new TPinballTable();
    high_score.read(this.highscore_table);
    this.ball_speed_limit = this.MainTable.BallList[0].Offset * 200;
  },

  uninit() {
    if (this.highscore_table.length) high_score.write(this.highscore_table);
    control.ClearLinks();
    loader.unload();
    timer.init();
    this.MainTable = null;
    this.record_table = null;
  },

  reset_table() {
    if (this.MainTable) this.MainTable.Message(1024, 0);
  },

  firsttime_setup() {
    render.update();
  },

  mode_change(mode) {
    switch (mode) {
      case 1:
        if (this.demo_mode) {
          this.LaunchBallEnabled = false;
          this.HighScoresEnabled = false;
          this.DemoActive = true;
          if (this.MainTable?.Demo) this.MainTable.Demo.ActiveFlag = 1;
        } else {
          this.LaunchBallEnabled = true;
          this.HighScoresEnabled = true;
          this.DemoActive = false;
          if (this.MainTable?.Demo) this.MainTable.Demo.ActiveFlag = 0;
        }
        break;
      case 2:
        this.LaunchBallEnabled = false;
        if (!this.demo_mode) {
          this.HighScoresEnabled = true;
          this.DemoActive = false;
        }
        if (this.MainTable?.LightGroup) this.MainTable.LightGroup.Message(29, 1.4);
        break;
      case 3:
      case 4:
        this.LaunchBallEnabled = false;
        this.HighScoresEnabled = false;
        this.mode_countdown_ = 5000;
        break;
      default:
        break;
    }
    this.game_mode = mode;
  },

  toggle_demo() {
    if (this.demo_mode) {
      this.demo_mode = 0;
      this.MainTable.Message(1024, 0);
      this.mode_change(2);
      pinball.MissTextBox.Clear();
      pinball.InfoTextBox.Display(get_rc_string(24), -1);
    } else {
      this.replay_level(1);
    }
  },

  replay_level(demoMode) {
    this.demo_mode = demoMode;
    this.mode_change(1);
    this.MainTable.Message(1014, this.host.players());
  },

  frame(dtMilliSec) {
    if (dtMilliSec > 100) dtMilliSec = 100;
    if (dtMilliSec <= 0) return;
    const dtSec = dtMilliSec * 0.001;
    if (this.mode_countdown(dtMilliSec)) return;

    this.time_next = this.time_now + dtSec;
    this.timed_frame(this.time_now, dtSec, true);
    this.time_now = this.time_next;

    dtMilliSec += this.time_ticks_remainder;
    const dtWhole = Math.trunc(dtMilliSec);
    this.time_ticks_remainder = dtMilliSec - dtWhole;
    this.time_ticks += dtWhole;

    if (nudge.nudged_left || nudge.nudged_right || nudge.nudged_up) {
      nudge.nudge_count = dtSec * 4 + nudge.nudge_count;
    } else {
      nudge.nudge_count = Math.max(nudge.nudge_count - dtSec, 0);
    }
    timer.check();
    render.update();
    score.update(this.MainTable.CurScoreStruct);
    if (!this.MainTable.TiltLockFlag) {
      if (nudge.nudge_count > 0.5) pinball.InfoTextBox.Display(get_rc_string(25), 2);
      if (nudge.nudge_count > 1) this.MainTable.tilt(this.time_now);
    }
  },

  timed_frame(timeNow, timeDelta, drawBalls) {
    const vec1 = vec();
    const vec2 = vec();
    for (const ball of this.MainTable.BallList) {
      if (!ball.ActiveFlag) continue;
      const collComp = ball.CollisionComp;
      if (collComp) {
        ball.TimeDelta = timeDelta;
        collComp.FieldEffect(ball, vec1);
      } else {
        if (this.MainTable.ActiveFlag) {
          vec2.X = 0;
          vec2.Y = 0;
          vec2.Z = 0;
          edges.edge_manager.FieldEffects(ball, vec2);
          vec2.X *= timeDelta;
          vec2.Y *= timeDelta;
          ball.Acceleration.X = ball.Speed * ball.Acceleration.X;
          ball.Acceleration.Y = ball.Speed * ball.Acceleration.Y;
          vector_add(ball.Acceleration, vec2);
          ball.Speed = normalize_2d(ball.Acceleration);
          ball.InvAcceleration.X = ball.Acceleration.X === 0 ? 1.0e9 : 1 / ball.Acceleration.X;
          ball.InvAcceleration.Y = ball.Acceleration.Y === 0 ? 1.0e9 : 1 / ball.Acceleration.Y;
        }
        let timeDelta2 = timeDelta;
        let timeNow2 = timeNow;
        for (let index = 10; timeDelta2 > 0.000001 && index; --index) {
          const time = this.collide(timeNow2, timeDelta2, ball);
          timeDelta2 -= time;
          timeNow2 += time;
        }
      }
    }
    if (drawBalls) {
      for (const ball of this.MainTable.BallList) {
        if (ball.ActiveFlag) ball.Repaint();
      }
    }
  },

  pause_continue() {
    this.single_step = !this.single_step;
    pinball.InfoTextBox.Clear();
    pinball.MissTextBox.Clear();
    if (this.single_step) {
      if (this.MainTable) this.MainTable.Message(1008, this.time_now);
      pinball.InfoTextBox.Display(get_rc_string(22), -1);
    } else {
      if (this.MainTable) this.MainTable.Message(1009, 0);
      if (!this.demo_mode) {
        if (this.game_mode === 2) pinball.InfoTextBox.Display(get_rc_string(24), -1);
        else pinball.InfoTextBox.Display(get_rc_string(23), 5);
      }
    }
  },

  loose_focus() {
    if (this.MainTable) this.MainTable.Message(1010, this.time_now);
  },

  // input: { LeftFlipper, RightFlipper, Plunger, LeftTableBump, RightTableBump, BottomTableBump }
  InputUp(input) {
    if (this.game_mode !== 1 || this.single_step || this.demo_mode) return;
    if (input.LeftFlipper) this.MainTable.Message(1001, this.time_now);
    if (input.RightFlipper) this.MainTable.Message(1003, this.time_now);
    if (input.Plunger) this.MainTable.Message(1005, this.time_now);
    if (input.LeftTableBump) nudge.un_nudge_right();
    if (input.RightTableBump) nudge.un_nudge_left();
    if (input.BottomTableBump) nudge.un_nudge_up();
  },

  // key: the typed character for the cheat buffer, or ''.
  InputDown(input, key) {
    if (this.single_step || this.demo_mode) return;
    if (this.game_mode !== 1) {
      this.mode_countdown(-1);
      return;
    }
    if (key) control.pbctrl_bdoor_controller(key);
    if (input.LeftFlipper) this.MainTable.Message(1000, this.time_now);
    if (input.RightFlipper) this.MainTable.Message(1002, this.time_now);
    if (input.Plunger) this.MainTable.Message(1004, this.time_now);
    if (input.LeftTableBump && !this.MainTable.TiltLockFlag) nudge.nudge_right();
    if (input.RightTableBump && !this.MainTable.TiltLockFlag) nudge.nudge_left();
    if (input.BottomTableBump && !this.MainTable.TiltLockFlag) nudge.nudge_up();

    if (this.cheat_mode && key) {
      switch (key) {
        case 'b': {
          let ball = this.MainTable.BallList.find(b => !b.ActiveFlag);
          if (!ball) ball = new TBall(this.MainTable);
          ball.Position.X = 1;
          ball.ActiveFlag = 1;
          ball.Position.Z = ball.Offset;
          ball.Position.Y = 1;
          ball.Acceleration.Z = 0;
          ball.Acceleration.Y = 0;
          ball.Acceleration.X = 0;
          break;
        }
        case 'h':
          high_score.show_and_set_high_score_dialog(this.highscore_table, 1000000000, 1, get_rc_string(26));
          break;
        case 'r':
          control.cheat_bump_rank();
          break;
        case 's':
          this.MainTable.AddScore(Math.trunc(RandFloat() * 1000000));
          break;
        default:
          break;
      }
    }
  },

  mode_countdown(time) {
    if (!this.game_mode || this.game_mode <= 0) return 1;
    if (this.game_mode > 2) {
      this.mode_countdown_ -= time;
      if (this.mode_countdown_ < 0 || time < 0) this.mode_change(this.game_mode === 3 ? 4 : 1);
      return 1;
    }
    return 0;
  },

  launch_ball() {
    this.MainTable.Plunger.Message(1017, 0);
  },

  end_game() {
    this.mode_change(2);
    const playerCount = this.MainTable.PlayerCount;
    const scores = [];
    const scoreIndex = [];
    for (let index = 0; index < playerCount; ++index) {
      scores[index] = this.MainTable.PlayerScores[index].ScoreStruct.Score;
      scoreIndex[index] = index;
    }
    for (let i = 0; i < playerCount; ++i) {
      for (let j = i + 1; j < playerCount; ++j) {
        if (scores[j] > scores[i]) {
          [scores[i], scores[j]] = [scores[j], scores[i]];
          [scoreIndex[i], scoreIndex[j]] = [scoreIndex[j], scoreIndex[i]];
        }
      }
    }
    if (!this.demo_mode && !this.MainTable.CheatsUsed) {
      // The original shows one modal dialog per player in turn.
      const entries = [];
      for (let i = 0; i < playerCount; ++i) entries.push({ score: scores[i], name: get_rc_string(scoreIndex[i] + 26) });
      high_score.queueEntries(this.highscore_table, entries);
    }
  },

  high_scores() {
    high_score.show_high_score_dialog(this.highscore_table);
  },

  tilt_no_more() {
    if (this.MainTable.TiltLockFlag) pinball.InfoTextBox.Clear();
    this.MainTable.TiltLockFlag = 0;
    nudge.nudge_count = -2;
  },

  chk_highscore() {
    if (this.demo_mode) return false;
    let playerIndex = this.MainTable.PlayerCount - 1;
    if (playerIndex < 0) return false;
    for (let i = playerIndex; high_score.get_score_position(this.highscore_table, this.MainTable.PlayerScores[i].ScoreStruct.Score) < 0; --i) {
      if (--playerIndex < 0) return false;
    }
    return true;
  },

  collide(timeNow, timeDelta, ball) {
    if (ball.ActiveFlag && !ball.CollisionComp) {
      if (this.ball_speed_limit < ball.Speed) ball.Speed = this.ball_speed_limit;
      let maxDistance = timeDelta * ball.Speed;
      ball.TimeDelta = timeDelta;
      ball.RayMaxDistance = maxDistance;
      ball.TimeNow = timeNow;

      const r = newRay();
      r.Origin = vec(ball.Position.X, ball.Position.Y, ball.Position.Z);
      r.Direction = vec(ball.Acceleration.X, ball.Acceleration.Y, ball.Acceleration.Z);
      r.MaxDistance = maxDistance;
      r.FieldFlag = ball.FieldFlag;
      r.TimeNow = timeNow;
      r.TimeDelta = timeDelta;
      r.MinDistance = 0.0020000001;

      const { distance, edge } = edges.edge_manager.FindCollisionDistance(r, ball);
      ball.EdgeCollisionCount = 0;
      if (distance >= 1000000000.0) {
        maxDistance = timeDelta * ball.Speed;
        ball.RayMaxDistance = maxDistance;
        ball.Position.X += maxDistance * ball.Acceleration.X;
        ball.Position.Y += maxDistance * ball.Acceleration.Y;
      } else {
        edge.EdgeCollision(ball, distance);
        if (ball.Speed > 0.000000001) return Math.abs(distance / ball.Speed);
      }
    }
    return timeDelta;
  },

  PushCheat(cheat) {
    for (const ch of cheat) control.pbctrl_bdoor_controller(ch);
  },
};

// The two text boxes (pinball::InfoTextBox / MissTextBox).
export const pinball = { InfoTextBox: null, MissTextBox: null };

// ---------- score ----------

export const score = {
  msg_fontp: null,

  init() {
    return 1;
  },

  create(fieldName, renderBgBmp) {
    const table = pb.record_table;
    const dimensionsId = table.record_labeled(fieldName) + RESOLUTION;
    const dimensions = table.field(dimensionsId, FieldTypes.ShortArray);
    if (!dimensions) return null;
    let groupIndex = dimensions[0];
    const s = {
      Score: -9999,
      DirtyFlag: false,
      BackgroundBmp: renderBgBmp,
      OffsetX: dimensions[1],
      OffsetY: dimensions[2],
      Width: dimensions[3],
      Height: dimensions[4],
      CharBmp: [],
    };
    for (let index = 0; index < 10; index++) s.CharBmp[index] = table.GetBitmap(groupIndex++);
    return s;
  },

  dup(s) {
    return { ...s, CharBmp: [...s.CharBmp] };
  },

  load_msg_font(name) {
    this.msg_fontp = null;
    const table = pb.record_table;
    let groupIndex = table.record_labeled(name);
    if (groupIndex < 0) return;
    const font = { GapWidth: 0, Height: 0, Chars: new Array(128).fill(null) };
    const gapArray = table.field(groupIndex, FieldTypes.ShortArray);
    font.GapWidth = gapArray ? gapArray[RESOLUTION] : 0;
    for (let charIndex = 32; charIndex < 128; charIndex++, ++groupIndex) {
      const bmp = groupIndex < table.Groups.length ? table.GetBitmap(groupIndex) : null;
      if (!bmp) break;
      if (!font.Height) font.Height = bmp.Height;
      font.Chars[charIndex] = bmp;
    }
    this.msg_fontp = font;
  },

  erase(s) {
    if (!s) return;
    if (s.BackgroundBmp) copy_bitmap(render.vscreen, s.Width, s.Height, s.OffsetX, s.OffsetY, s.BackgroundBmp, s.OffsetX, s.OffsetY);
    else fill_bitmap(render.vscreen, s.Width, s.Height, s.OffsetX, s.OffsetY, 0);
  },

  set(s, value) {
    if (s) {
      s.Score = value;
      s.DirtyFlag = true;
    }
  },

  update(s) {
    if (s && s.DirtyFlag && s.Score <= 1000000000) {
      s.DirtyFlag = false;
      let x = s.Width + s.OffsetX;
      const y = s.OffsetY;
      this.erase(s);
      if (s.Score >= 0) {
        const text = String(s.Score);
        for (let index = text.length - 1; index >= 0; index--) {
          const bmp = s.CharBmp[(text.charCodeAt(index) - 48) % 10];
          x -= bmp.Width;
          if (render.background_bitmap) copy_bitmap_w_transparency(render.vscreen, bmp.Width, bmp.Height, x, y, bmp, 0, 0);
          else copy_bitmap(render.vscreen, bmp.Width, bmp.Height, x, y, bmp, 0, 0);
        }
      }
    }
  },

  string_format(value) {
    if (value === -999) return '';
    const pad = n => String(n).padStart(3, '0');
    const millions = Math.trunc((value % 1000000000) / 1000000);
    if (Math.trunc(value / 1000000000) <= 0) {
      if (millions <= 0) {
        if (Math.trunc((value % 1000000) / 1000) <= 0) return String(value);
        return `${Math.trunc((value % 1000000) / 1000)},${pad(value % 1000)}`;
      }
      return `${millions},${pad(Math.trunc((value % 1000000) / 1000))},${pad(value % 1000)}`;
    }
    return `${Math.trunc(value / 1000000000)},${pad(millions)},${pad(Math.trunc((value % 1000000) / 1000))},${pad(value % 1000)}`;
  },
};

// ---------- nudge ----------

export const nudge = {
  nudged_left: 0,
  nudged_right: 0,
  nudged_up: 0,
  timer: 0,
  nudge_count: 0,

  reset() {
    this.nudged_left = 0;
    this.nudged_right = 0;
    this.nudged_up = 0;
    this.timer = 0;
    this.nudge_count = 0;
  },

  un_nudge_right() {
    if (nudge.nudged_right) nudge._nudge(-2, -1);
    nudge.nudged_right = 0;
  },

  un_nudge_left() {
    if (nudge.nudged_left) nudge._nudge(2, -1);
    nudge.nudged_left = 0;
  },

  un_nudge_up() {
    if (nudge.nudged_up) nudge._nudge(0, -1);
    nudge.nudged_up = 0;
  },

  nudge_right() {
    this._nudge(2, 1);
    if (this.timer) timer.kill(this.timer);
    this.timer = timer.set(0.4, null, this.un_nudge_right);
    this.nudged_right = 1;
  },

  nudge_left() {
    this._nudge(-2, 1);
    if (this.timer) timer.kill(this.timer);
    this.timer = timer.set(0.4, null, this.un_nudge_left);
    this.nudged_left = 1;
  },

  nudge_up() {
    this._nudge(0, 1);
    if (this.timer) timer.kill(this.timer);
    this.timer = timer.set(0.4, null, this.un_nudge_up);
    this.nudged_up = 1;
  },

  _nudge(xDiff, yDiff) {
    const accelMod = vec(xDiff * 0.5, yDiff * 0.5);
    for (const ball of pb.MainTable.BallList) {
      if (ball.ActiveFlag && !ball.CollisionComp) {
        ball.Acceleration.X *= ball.Speed;
        ball.Acceleration.Y *= ball.Speed;
        vector_add(ball.Acceleration, accelMod);
        ball.Speed = normalize_2d(ball.Acceleration);
        ball.InvAcceleration.X = ball.Acceleration.X === 0 ? 1000000000.0 : 1 / ball.Acceleration.X;
        ball.InvAcceleration.Y = ball.Acceleration.Y === 0 ? 1000000000.0 : 1 / ball.Acceleration.Y;
      }
    }
    render.shift(Math.floor(xDiff + 0.5), Math.floor(0.5 - yDiff));
  },
};

// ---------- high_score ----------

export const high_score = {
  pending: [],

  read(table) {
    this.clear_table(table);
    const saved = pb.host.loadHighScores();
    if (Array.isArray(saved)) {
      saved.slice(0, 5).forEach((entry, i) => {
        table[i] = { Name: String(entry.Name ?? '').slice(0, 31), Score: Number(entry.Score) | 0 };
      });
    }
  },

  write(table) {
    pb.host.saveHighScores(table.map(e => ({ Name: e.Name, Score: e.Score })));
  },

  clear_table(table) {
    for (let i = 0; i < 5; i++) table[i] = { Name: '', Score: -999 };
  },

  get_score_position(table, value) {
    if (value <= 0) return -1;
    for (let position = 0; position < 5; position++) {
      if (table[position].Score < value) return position;
    }
    return -1;
  },

  place_new_score_into(table, value, name, position) {
    if (position >= 0) {
      for (let i = 4; i > position; i--) table[i] = { ...table[i - 1] };
      table[position] = { Name: name.slice(0, 31), Score: value };
    }
    return position;
  },

  show_high_score_dialog(table) {
    pb.host.showHighScores(table);
  },

  show_and_set_high_score_dialog(table, value, pos, defaultName) {
    pb.host.showHighScoreEntry(table, value, pos, defaultName, () => {});
  },

  // Shows the entry dialog for each qualifying player in turn.
  queueEntries(table, entries) {
    const next = () => {
      const entry = entries.shift();
      if (!entry) return;
      const position = this.get_score_position(table, entry.score);
      if (position < 0) {
        next();
        return;
      }
      pb.host.showHighScoreEntry(table, entry.score, position, entry.name, next);
    };
    next();
  },
};
