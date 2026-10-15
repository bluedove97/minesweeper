// Table components, ported one class per original file (TPinballComponent.cpp,
// TCollisionComponent.cpp, TBall.cpp, TTableLayer.cpp, TFlipper.cpp, ...,
// TPinballTable.cpp). Message codes and behaviour follow the decompilation.

import {
  vec, vecAt, copyVec, rect, enclosing_box, basic_collision, normalize_2d, RotateVector,
  find_closest_edge, RandFloat, crand,
} from './maths.js';
import { loader, newVisual, default_vsi } from './loader.js';
import { render, proj, VisualTypes, copy_bitmap, copy_bitmap_w_transparency, fill_bitmap } from './render.js';
import { timer } from './timer.js';
import {
  edges, flagRef, TEdgeManager, TEdgeSegment, TLine, TCircle, TFlipperEdge,
  edges_insert_square, edges_insert_circle,
} from './edges.js';
import { control } from './control.js';
import { pb, pinball, score } from './pb.js';
import { get_rc_string } from './strings.js';

const BIG = 1000000000.0;

// ---------- TPinballComponent ----------

export class TPinballComponent {
  constructor(table, groupIndex, loadVisuals) {
    this.MessageField = 0;
    this.UnusedBaseFlag = 0;
    this.ActiveFlag = 0;
    this.PinballTable = table;
    this.RenderSprite = null;
    this.ListBitmap = null;
    this.ListZMap = null;
    this.GroupName = null;
    this.Control = null;
    if (table) table.ComponentList.push(this);
    if (groupIndex >= 0) this.GroupName = loader.query_name(groupIndex);
    if (loadVisuals && groupIndex >= 0) {
      const visualCount = loader.query_visual_states(groupIndex);
      const visual = newVisual();
      for (let index = 0; index < visualCount; ++index) {
        loader.query_visual(groupIndex, index, visual);
        if (visual.Bitmap) (this.ListBitmap ??= []).push(visual.Bitmap);
        if (visual.ZMap) (this.ListZMap ??= []).push(visual.ZMap);
      }
      const zMap = this.ListZMap ? this.ListZMap[0] : null;
      if (this.ListBitmap) {
        const rootBmp = this.ListBitmap[0];
        const bmp1Rect = rect(rootBmp.XPosition - table.XOffset, rootBmp.YPosition - table.YOffset, rootBmp.Width, rootBmp.Height);
        for (let index = 1; index < this.ListBitmap.length; index++) {
          const bmp = this.ListBitmap[index];
          enclosing_box(bmp1Rect, rect(bmp.XPosition - table.XOffset, bmp.YPosition - table.YOffset, bmp.Width, bmp.Height), bmp1Rect);
        }
        this.RenderSprite = render.create_sprite(
          visualCount > 0 ? VisualTypes.Sprite : VisualTypes.None,
          rootBmp, zMap, rootBmp.XPosition - table.XOffset, rootBmp.YPosition - table.YOffset, bmp1Rect,
        );
      }
    }
    this.GroupIndex = groupIndex;
  }

  Message(code, value) {
    this.MessageField = code === 1024 ? 0 : code;
    return 0;
  }

  port_draw() {}

  put_scoring(index, value) {}

  get_scoring(index) {
    return 0;
  }

  // Shows ListBitmap[index] at its own position (the repeated sprite_set calls).
  setBitmapIndex(index) {
    const bmp = this.ListBitmap[index];
    const zMap = this.ListZMap[index];
    render.sprite_set(this.RenderSprite, bmp, zMap, bmp.XPosition - this.PinballTable.XOffset, bmp.YPosition - this.PinballTable.YOffset);
  }
}

// ---------- TCollisionComponent ----------

export class TCollisionComponent extends TPinballComponent {
  constructor(table, groupIndex, createWall) {
    super(table, groupIndex, true);
    this.EdgeList = [];
    this.ActiveFlag = 1;
    if (this.GroupName !== null) this.UnusedBaseFlag = 1;
    const visual = newVisual();
    if (groupIndex <= 0) {
      default_vsi(visual);
    } else {
      loader.query_visual(groupIndex, 0, visual);
      if (createWall) {
        const floatArr = loader.query_float_attribute(groupIndex, 0, 600);
        TEdgeSegment.install_wall(floatArr, this, flagRef(this), visual.CollisionGroup, table.CollisionCompOffset, 0);
      }
    }
    this.Threshold = visual.Kicker.Threshold;
    this.Elasticity = visual.Elasticity;
    this.Smoothness = visual.Smoothness;
    this.Boost = visual.Kicker.Boost;
    this.HardHitSoundId = visual.Kicker.HardHitSoundId;
    this.SoftHitSoundId = visual.SoftHitSoundId;
    this.GroupIndex = groupIndex;
  }

  port_draw() {
    for (const edge of this.EdgeList) edge.port_draw();
  }

  DefaultCollision(ball, nextPosition, direction) {
    if (this.PinballTable.TiltLockFlag) {
      basic_collision(ball, nextPosition, direction, this.Elasticity, this.Smoothness, BIG, 0);
      return 0;
    }
    const projSpeed = basic_collision(ball, nextPosition, direction, this.Elasticity, this.Smoothness, this.Threshold, this.Boost);
    if (projSpeed <= this.Threshold) {
      if (projSpeed > 0.2 && this.SoftHitSoundId) loader.play_sound(this.SoftHitSoundId);
      return 0;
    }
    if (this.HardHitSoundId) loader.play_sound(this.HardHitSoundId);
    return 1;
  }

  Collision(ball, nextPosition, direction, coef, edge) {
    if (this.PinballTable.TiltLockFlag) {
      basic_collision(ball, nextPosition, direction, this.Elasticity, this.Smoothness, BIG, 0);
      return;
    }
    const projSpeed = basic_collision(ball, nextPosition, direction, this.Elasticity, this.Smoothness, this.Threshold, this.Boost);
    let soundIndex;
    if (projSpeed <= this.Threshold) {
      if (projSpeed <= 0.2) return;
      soundIndex = this.SoftHitSoundId;
    } else {
      soundIndex = this.HardHitSoundId;
    }
    if (soundIndex) loader.play_sound(soundIndex);
  }

  FieldEffect(ball, vecDst) {
    return 0;
  }
}

// ---------- TBall ----------

export class TBall extends TPinballComponent {
  constructor(table) {
    super(table, -1, false);
    this.TimeNow = 0;
    this.RayMaxDistance = 0;
    this.ActiveFlag = 1;
    this.CollisionComp = null;
    this.EdgeCollisionCount = 0;
    this.TimeDelta = 0;
    this.FieldFlag = 1;
    this.CollisionFlag = 0;
    this.Speed = 0;
    this.Position = vec();
    this.Acceleration = vec();
    this.InvAcceleration = vec(1000000000.0, 1000000000.0);
    this.RampFieldForce = vec();
    this.CollisionOffset = vec();
    this.Collisions = [];
    this.VisualZArray = new Array(50).fill(0);
    this.ListBitmap = [];

    let groupIndex = loader.query_handle('ball');
    if (groupIndex < 0) groupIndex = loader.query_handle('ball0');
    this.Offset = loader.query_float_attribute(groupIndex, 0, 500)[0];

    const visual = newVisual();
    const visualCount = loader.query_visual_states(groupIndex);
    for (let index = 0; index < visualCount; ++index) {
      loader.query_visual(groupIndex, index, visual);
      this.ListBitmap.push(visual.Bitmap);
      this.VisualZArray[index] = proj.z_distance(vecAt(loader.query_float_attribute(groupIndex, index, 501)));
    }
    this.RenderSprite = render.create_sprite(VisualTypes.Ball, null, null, 0, 0, null);
    table.CollisionCompOffset = this.Offset;
    this.Position.Z = this.Offset;
  }

  Repaint() {
    if (this.CollisionFlag) {
      this.Position.Z = this.CollisionOffset.X * this.Position.X + this.CollisionOffset.Y * this.Position.Y + this.Offset + this.CollisionOffset.Z;
    }
    const pos2D = proj.xform_to_2d(this.Position);
    const zDepth = proj.z_distance(this.Position);
    let index = 0;
    for (; index < this.ListBitmap.length - 1; ++index) {
      if (this.VisualZArray[index] <= zDepth) break;
    }
    const bmp = this.ListBitmap[index];
    render.ball_set(this.RenderSprite, bmp, zDepth, pos2D[0] - Math.trunc(bmp.Width / 2), pos2D[1] - Math.trunc(bmp.Height / 2));
  }

  not_again(edge) {
    if (this.EdgeCollisionCount < 5) {
      this.Collisions[this.EdgeCollisionCount] = edge;
      ++this.EdgeCollisionCount;
    }
  }

  already_hit(edge) {
    for (let i = 0; i < this.EdgeCollisionCount; i++) {
      if (this.Collisions[i] === edge) return true;
    }
    return false;
  }

  Message(code, value) {
    if (code === 1024) {
      render.ball_set(this.RenderSprite, null, 0, 0, 0);
      this.Position.X = 0;
      this.CollisionComp = null;
      this.Position.Y = 0;
      this.ActiveFlag = 0;
      this.CollisionFlag = 0;
      this.FieldFlag = 1;
      this.Acceleration.Y = 0;
      this.Position.Z = this.Offset;
      this.Acceleration.X = 0;
      this.Speed = 0;
      this.RayMaxDistance = 0;
    }
    return 0;
  }

  static throw_ball(ball, acceleration, angleMult, speedMult1, speedMult2) {
    ball.CollisionComp = null;
    ball.Acceleration = copyVec(acceleration);
    let rnd = RandFloat();
    const angle = (1 - (rnd + rnd)) * angleMult;
    RotateVector(ball.Acceleration, angle);
    rnd = RandFloat();
    ball.Speed = (1 - (rnd + rnd)) * (speedMult1 * speedMult2) + speedMult1;
  }
}

// ---------- TTableLayer ----------

export class TTableLayer extends TCollisionComponent {
  constructor(table) {
    super(table, -1, false);
    const visual = newVisual();
    const groupIndex = loader.query_handle('table');
    loader.query_visual(groupIndex, 0, visual);

    const projCenter = loader.query_float_attribute(groupIndex, 0, 700);
    proj.recenter(projCenter[0], projCenter[1]);
    render.set_background_zmap(visual.ZMap, 0, 0);

    const bmp = visual.Bitmap;
    this.VisBmp = bmp;
    render.create_sprite(VisualTypes.None, bmp, visual.ZMap, 0, 0, rect(0, 0, bmp.Width, bmp.Height));

    table.SoundIndex1 = visual.SoundIndex4;
    table.SoundIndex2 = visual.SoundIndex3;
    table.SoundIndex3 = visual.Kicker.HardHitSoundId;

    const tableAngleArr = loader.query_float_attribute(groupIndex, 0, 305);
    if (tableAngleArr) {
      table.GravityDirVectMult = tableAngleArr[0];
      table.GravityAngleX = tableAngleArr[1];
      table.GravityAnglY = tableAngleArr[2];
    } else {
      table.GravityDirVectMult = 25;
      table.GravityAngleX = 0.5;
      table.GravityAnglY = 1.570796;
    }
    this.GraityDirX = Math.cos(table.GravityAnglY) * Math.sin(table.GravityAngleX) * table.GravityDirVectMult;
    this.GraityDirY = Math.sin(table.GravityAnglY) * Math.sin(table.GravityAngleX) * table.GravityDirVectMult;
    this.GraityMult = loader.query_float_attribute(groupIndex, 0, 701)[0];

    table.XOffset = bmp.XPosition;
    table.YOffset = bmp.YPosition;
    table.Width = bmp.Width;
    table.Height = bmp.Height;
    this.Threshold = visual.Kicker.Threshold;
    this.Boost = 15;

    const arr = visual.FloatArr;
    this.Unknown1F = Math.min(arr[0], Math.min(arr[2], arr[4]));
    this.Unknown2F = Math.min(arr[1], Math.min(arr[3], arr[5]));
    this.Unknown3F = Math.max(arr[0], Math.max(arr[2], arr[4]));
    this.Unknown4F = Math.max(arr[1], Math.max(arr[3], arr[5]));
    edges.edge_manager = new TEdgeManager(this.Unknown1F, this.Unknown2F, this.Unknown3F - this.Unknown1F, this.Unknown4F - this.Unknown2F);

    let p = 0;
    for (let count = visual.FloatArrCount; count > 0; count--) {
      const l = new TLine(this, flagRef(this), visual.CollisionGroup, arr[p + 2], arr[p + 3], arr[p], arr[p + 1]);
      l.place_in_grid();
      this.EdgeList.push(l);
      p += 2;
    }

    this.Field = { Mask: -1, Flag2Ptr: flagRef(this), CollisionComp: this };
    edges_insert_square(this.Unknown2F, this.Unknown1F, this.Unknown4F, this.Unknown3F, null, this.Field);
  }

  FieldEffect(ball, vecDst) {
    vecDst.X = this.GraityDirX - (0.5 - RandFloat() + ball.Acceleration.X) * ball.Speed * this.GraityMult;
    vecDst.Y = this.GraityDirY - ball.Acceleration.Y * ball.Speed * this.GraityMult;
    return 1;
  }
}

// ---------- TWall ----------

export class TWall extends TCollisionComponent {
  constructor(table, groupIndex) {
    super(table, groupIndex, true);
    this.Timer = 0;
    this.BmpPtr = null;
    this.Scores = [0];
    if (this.RenderSprite) render.sprite_set_bitmap(this.RenderSprite, null);
    if (this.ListBitmap) this.BmpPtr = this.ListBitmap[0];
  }

  Message(code, value) {
    if (code === 1024 && this.Timer) {
      timer.kill(this.Timer);
      TWall.TimerExpired(this.Timer, this);
    }
    return 0;
  }

  Collision(ball, nextPosition, direction, coef, edge) {
    if (this.DefaultCollision(ball, nextPosition, direction)) {
      if (this.BmpPtr) {
        render.sprite_set_bitmap(this.RenderSprite, this.BmpPtr);
        this.Timer = timer.set(0.1, this, TWall.TimerExpired);
      }
      control.handler(63, this);
    }
  }

  put_scoring(index, value) {
    if (index < 1) this.Scores[index] = value;
  }

  get_scoring(index) {
    return index < 1 ? this.Scores[index] : 0;
  }

  static TimerExpired(timerId, wall) {
    render.sprite_set_bitmap(wall.RenderSprite, null);
    wall.Timer = 0;
    wall.MessageField = 0;
  }
}

// ---------- TPlunger ----------

export class TPlunger extends TCollisionComponent {
  constructor(table, groupIndex) {
    super(table, groupIndex, true);
    const visual = newVisual();
    loader.query_visual(groupIndex, 0, visual);
    this.Boost = 0;
    this.BallFeedTimer_ = 0;
    this.PullbackTimer_ = 0;
    this.SoundIndexP1 = visual.SoundIndex4;
    this.SoundIndexP2 = visual.SoundIndex3;
    this.HardHitSoundId = visual.Kicker.HardHitSoundId;
    this.Threshold = BIG;
    this.MaxPullback = 100;
    this.Elasticity = 0.5;
    this.Smoothness = 0.5;
    this.PullbackIncrement = Math.trunc(100.0 / (this.ListBitmap.length * 8.0));
    this.Unknown4F = 0.025;
    const floatArr = loader.query_float_attribute(groupIndex, 0, 601);
    table.PlungerPositionX = floatArr[0];
    table.PlungerPositionY = floatArr[1];
  }

  Collision(ball, nextPosition, direction, coef, edge) {
    if (this.PinballTable.TiltLockFlag) this.Message(1017, 0);
    coef = RandFloat() * this.Boost * 0.1 + this.Boost;
    basic_collision(ball, nextPosition, direction, this.Elasticity, this.Smoothness, this.Threshold, coef);
  }

  Message(code, value) {
    switch (code) {
      case 1004:
        if (!this.PullbackTimer_) {
          this.Boost = 0;
          this.Threshold = BIG;
          loader.play_sound(this.HardHitSoundId);
          TPlunger.PullbackTimer(0, this);
        }
        return 0;
      case 1015: {
        const ball = this.PinballTable.BallList[0];
        ball.Message(1024, 0);
        ball.Position.X = this.PinballTable.PlungerPositionX;
        ball.Position.Y = this.PinballTable.PlungerPositionY;
        ball.ActiveFlag = 1;
        this.PinballTable.BallInSink = 0;
        pb.tilt_no_more();
        control.handler(code, this);
        return 0;
      }
      case 1016:
        if (this.BallFeedTimer_) timer.kill(this.BallFeedTimer_);
        this.BallFeedTimer_ = timer.set(0.95999998, this, TPlunger.BallFeedTimer);
        loader.play_sound(this.SoundIndexP1);
        control.handler(code, this);
        return 0;
      case 1017:
        this.Threshold = 0;
        this.Boost = this.MaxPullback;
        timer.set(0.2, this, TPlunger.PlungerReleasedTimer);
        break;
      case 1005:
      case 1009:
      case 1010:
      case 1024:
        if (code === 1024) {
          if (this.BallFeedTimer_) timer.kill(this.BallFeedTimer_);
          this.BallFeedTimer_ = 0;
        }
        this.Threshold = 0;
        if (this.PullbackTimer_) timer.kill(this.PullbackTimer_);
        this.PullbackTimer_ = 0;
        if (code === 1005) loader.play_sound(this.SoundIndexP2);
        this.setBitmapIndex(0);
        timer.set(this.Unknown4F, this, TPlunger.PlungerReleasedTimer);
        break;
      default:
        break;
    }
    return 0;
  }

  static BallFeedTimer(timerId, plunger) {
    plunger.PullbackTimer_ = 0;
    plunger.Message(1015, 0);
  }

  static PullbackTimer(timerId, plunger) {
    plunger.Boost += plunger.PullbackIncrement;
    if (plunger.Boost <= plunger.MaxPullback) {
      plunger.PullbackTimer_ = timer.set(plunger.Unknown4F, plunger, TPlunger.PullbackTimer);
    } else {
      plunger.PullbackTimer_ = 0;
      plunger.Boost = plunger.MaxPullback;
    }
    const index = Math.floor((plunger.ListBitmap.length - 1) * (plunger.Boost / plunger.MaxPullback));
    plunger.setBitmapIndex(index);
  }

  static PlungerReleasedTimer(timerId, plunger) {
    plunger.Threshold = BIG;
    plunger.Boost = 0;
  }
}

// ---------- TFlipper ----------

export class TFlipper extends TCollisionComponent {
  constructor(table, groupIndex) {
    super(table, groupIndex, false);
    const visual = newVisual();
    loader.query_visual(groupIndex, 0, visual);
    this.HardHitSoundId = visual.SoundIndex4;
    this.SoftHitSoundId = visual.SoundIndex3;
    this.Elasticity = visual.Elasticity;
    this.Timer = 0;
    this.Smoothness = visual.Smoothness;

    const collMult = loader.query_float_attribute(groupIndex, 0, 803)[0];
    const retractTime = loader.query_float_attribute(groupIndex, 0, 805)[0];
    const extendTime = loader.query_float_attribute(groupIndex, 0, 804)[0];
    const vecT2 = vecAt(loader.query_float_attribute(groupIndex, 0, 802));
    const vecT1 = vecAt(loader.query_float_attribute(groupIndex, 0, 801));
    const origin = vecAt(loader.query_float_attribute(groupIndex, 0, 800));
    this.FlipperEdge = new TFlipperEdge(this, flagRef(this), visual.CollisionGroup, table, origin, vecT1, vecT2,
      extendTime, retractTime, collMult, this.Elasticity, this.Smoothness);
    this.ExtendAnimationFrameTime = this.FlipperEdge.ExtendTime / (this.ListBitmap.length - 1);
    this.RetractAnimationFrameTime = this.FlipperEdge.RetractTime / (this.ListBitmap.length - 1);
    this.TimerTime = 0;
    this.BmpIndex = 0;
    this.InputTime = 0;
  }

  Message(code, value) {
    if (code === 1 || code === 2 || (code > 1008 && code <= 1011) || code === 1022) {
      let command = code;
      if (code === 1) {
        control.handler(1, this);
        this.TimerTime = this.ExtendAnimationFrameTime;
        loader.play_sound(this.HardHitSoundId);
      } else if (code === 2) {
        this.TimerTime = this.RetractAnimationFrameTime;
        loader.play_sound(this.SoftHitSoundId);
      } else {
        // Retract for all non-input messages.
        command = 2;
        this.TimerTime = this.RetractAnimationFrameTime;
      }

      let timerTime;
      if (this.MessageField) {
        // A message arrived before the animation finished.
        const inputDt = value - this.FlipperEdge.InputTime;
        timerTime = inputDt - Math.floor(inputDt / this.TimerTime) * this.TimerTime;
        if (timerTime < 0) timerTime = 0;
      } else {
        timerTime = this.TimerTime;
      }
      this.MessageField = command;
      this.InputTime = value;
      if (this.Timer) timer.kill(this.Timer);
      this.Timer = timer.set(timerTime, this, TFlipper.TimerExpired);
      this.FlipperEdge.SetMotion(command, value);
    }

    if ((code === 1020 || code === 1024) && this.MessageField) {
      if (this.Timer) timer.kill(this.Timer);
      this.BmpIndex = -1;
      this.MessageField = 2;
      TFlipper.TimerExpired(this.Timer, this);
      this.FlipperEdge.SetMotion(code, value);
    }
    return 0;
  }

  port_draw() {
    this.FlipperEdge.port_draw();
  }

  Collision(ball, nextPosition, direction, coef, edge) {}

  static TimerExpired(timerId, flip) {
    const bmpCountSub1 = flip.ListBitmap.length - 1;
    let newBmpIndex = Math.floor((pb.time_now - flip.InputTime) / flip.TimerTime);
    if (newBmpIndex > bmpCountSub1) newBmpIndex = bmpCountSub1;
    if (newBmpIndex < 0) newBmpIndex = 0;

    let bmpIndexOutOfBounds = false;
    if (flip.MessageField === 1) {
      flip.BmpIndex = newBmpIndex;
      if (flip.BmpIndex >= bmpCountSub1) {
        flip.BmpIndex = bmpCountSub1;
        bmpIndexOutOfBounds = true;
      }
    }
    if (flip.MessageField === 2) {
      flip.BmpIndex = bmpCountSub1 - newBmpIndex;
      if (flip.BmpIndex <= 0) {
        flip.BmpIndex = 0;
        bmpIndexOutOfBounds = true;
      }
    }

    if (bmpIndexOutOfBounds) {
      flip.MessageField = 0;
      flip.Timer = 0;
    } else {
      flip.Timer = timer.set(flip.TimerTime, flip, TFlipper.TimerExpired);
    }
    flip.setBitmapIndex(flip.BmpIndex);
  }
}

// ---------- TBumper ----------

export class TBumper extends TCollisionComponent {
  constructor(table, groupIndex) {
    super(table, groupIndex, true);
    const visual = newVisual();
    this.BmpIndex = 0;
    this.Timer = 0;
    this.TimerTime = loader.query_float_attribute(groupIndex, 0, 407)[0];
    loader.query_visual(groupIndex, 0, visual);
    this.SoundIndex4 = visual.SoundIndex4;
    this.SoundIndex3 = visual.SoundIndex3;
    this.OriginalThreshold = this.Threshold;
    this.Scores = [0, 0, 0, 0];
    this.PlayerData = Array.from({ length: 4 }, () => ({ MessageField: 0, BmpIndex: 0 }));
  }

  Message(code, value) {
    switch (code) {
      case 11: {
        let nextBmp = Math.floor(value);
        const maxBmp = this.ListBitmap.length - 1;
        if (2 * nextBmp > maxBmp) nextBmp = Math.trunc(maxBmp / 2);
        if (nextBmp < 0) nextBmp = 0;
        if (nextBmp !== this.BmpIndex) {
          if (nextBmp >= this.BmpIndex) loader.play_sound(this.SoundIndex4);
          if (nextBmp < this.BmpIndex) loader.play_sound(this.SoundIndex3);
          this.BmpIndex = nextBmp;
          this.Fire();
          control.handler(11, this);
        }
        break;
      }
      case 12: {
        let nextBmp = this.BmpIndex + 1;
        const maxBmp = this.ListBitmap.length - 1;
        if (2 * nextBmp > maxBmp) nextBmp = Math.trunc(maxBmp / 2);
        TBumper.prototype.Message.call(this, 11, nextBmp);
        break;
      }
      case 13: {
        let nextBmp = this.BmpIndex - 1;
        if (nextBmp < 0) nextBmp = 0;
        TBumper.prototype.Message.call(this, 11, nextBmp);
        break;
      }
      case 1020: {
        let player = this.PlayerData[this.PinballTable.CurrentPlayer];
        player.BmpIndex = this.BmpIndex;
        player.MessageField = this.MessageField;
        player = this.PlayerData[Math.floor(value)];
        this.BmpIndex = player.BmpIndex;
        this.MessageField = player.MessageField;
        TBumper.prototype.Message.call(this, 11, this.BmpIndex);
        break;
      }
      case 1024:
        if (this.Timer) {
          timer.kill(this.Timer);
          TBumper.TimerExpired(this.Timer, this);
        }
        this.BmpIndex = 0;
        this.MessageField = 0;
        for (let index = 0; index < this.PinballTable.PlayerCount; ++index) {
          this.PlayerData[index].BmpIndex = 0;
          this.PlayerData[index].MessageField = 0;
        }
        TBumper.TimerExpired(0, this);
        break;
      default:
        break;
    }
    return 0;
  }

  Collision(ball, nextPosition, direction, coef, edge) {
    if (this.DefaultCollision(ball, nextPosition, direction)) {
      this.Fire();
      control.handler(63, this);
    }
  }

  put_scoring(index, value) {
    if (index < 4) this.Scores[index] = value;
  }

  get_scoring(index) {
    return index < 4 ? this.Scores[index] : 0;
  }

  static TimerExpired(timerId, bump) {
    bump.Timer = 0;
    bump.setBitmapIndex(bump.BmpIndex * 2);
    bump.Threshold = bump.OriginalThreshold;
  }

  Fire() {
    this.setBitmapIndex(2 * this.BmpIndex + 1);
    this.Timer = timer.set(this.TimerTime, this, TBumper.TimerExpired);
    this.Threshold = BIG;
  }
}

// ---------- TDrain ----------

export class TDrain extends TCollisionComponent {
  constructor(table, groupIndex) {
    super(table, groupIndex, true);
    this.Timer = 0;
    this.TimerTime = loader.query_float_attribute(groupIndex, 0, 407)[0];
  }

  Message(code, value) {
    if (code === 1024) {
      if (this.Timer) {
        timer.kill(this.Timer);
        this.Timer = 0;
      }
      this.PinballTable.BallInSink = 0;
    }
    return 0;
  }

  Collision(ball, nextPosition, direction, coef, edge) {
    ball.Message(1024, 0);
    this.PinballTable.BallInSink = 1;
    this.Timer = timer.set(this.TimerTime, this, TDrain.TimerCallback);
    control.handler(63, this);
  }

  static TimerCallback(timerId, drain) {
    control.handler(60, drain);
  }
}

// ---------- TKickout ----------

export class TKickout extends TCollisionComponent {
  constructor(table, groupIndex, someFlag) {
    super(table, groupIndex, false);
    const visual = newVisual();
    this.NotSomeFlag = someFlag ? 0 : 1;
    if (!someFlag) this.ActiveFlag = 0;
    this.TimerTime1 = 1.5;
    this.TimerTime2 = 0.05;
    this.MessageField = 0;
    this.Timer = 0;
    this.KickFlag1 = 0;
    this.Ball = null;
    this.OriginalBallZ = 0;
    this.Scores = [0, 0, 0, 0, 0];
    this.FieldMult = loader.query_float_attribute(groupIndex, 0, 305)[0];
    loader.query_visual(groupIndex, 0, visual);
    this.SoftHitSoundId = visual.SoftHitSoundId;
    this.HardHitSoundId = visual.Kicker.HardHitSoundId;

    const fa = visual.FloatArr;
    this.Circle = { Center: vec(fa[0], fa[1], fa[2]), RadiusSq: loader.query_float_attribute(groupIndex, 0, 306)[0] * fa[2] };
    if (this.Circle.RadiusSq === 0) this.Circle.RadiusSq = 0.001;
    // As in the original, the squared radius is passed where a radius is expected.
    const tCircle = new TCircle(this, flagRef(this), visual.CollisionGroup, vecAt(fa), this.Circle.RadiusSq);
    tCircle.place_in_grid();
    this.EdgeList.push(tCircle);

    this.Circle.RadiusSq = fa[2] * fa[2];
    const zAttr = loader.query_float_attribute(groupIndex, 0, 408);
    this.CollisionBallSetZ = zAttr[2];
    this.ThrowSpeedMult2 = visual.Kicker.ThrowBallMult * 0.01;
    this.BallAcceleration = copyVec(visual.Kicker.ThrowBallAcceleration);
    this.ThrowAngleMult = visual.Kicker.ThrowBallAngleMult;
    this.ThrowSpeedMult1 = visual.Kicker.Boost;

    this.Field = { Flag2Ptr: flagRef(this), CollisionComp: this, Mask: visual.CollisionGroup };
    edges_insert_circle({ Center: copyVec(this.Circle.Center), RadiusSq: this.Circle.RadiusSq }, null, this.Field);
  }

  Message(code, value) {
    switch (code) {
      case 55:
        if (this.KickFlag1) {
          if (value < 0) value = this.TimerTime1;
          this.Timer = timer.set(value, this, TKickout.TimerExpired);
        }
        break;
      case 1011:
        if (this.NotSomeFlag) this.ActiveFlag = 0;
        break;
      case 1024:
        if (this.KickFlag1) {
          if (this.Timer) timer.kill(this.Timer);
          TKickout.TimerExpired(0, this);
        }
        if (this.NotSomeFlag) this.ActiveFlag = 0;
        break;
      default:
        break;
    }
    return 0;
  }

  put_scoring(index, value) {
    if (index < 5) this.Scores[index] = value;
  }

  get_scoring(index) {
    return index < 5 ? this.Scores[index] : 0;
  }

  Collision(ball, nextPosition, direction, coef, edge) {
    if (!this.KickFlag1) {
      this.Ball = ball;
      this.Threshold = BIG;
      this.KickFlag1 = 1;
      ball.CollisionComp = this;
      ball.Position.X = this.Circle.Center.X;
      ball.Position.Y = this.Circle.Center.Y;
      this.OriginalBallZ = ball.Position.Z;
      ball.Position.Z = this.CollisionBallSetZ;
      if (this.PinballTable.TiltLockFlag) {
        this.Message(55, 0.1);
      } else {
        loader.play_sound(this.SoftHitSoundId);
        control.handler(63, this);
      }
    }
  }

  FieldEffect(ball, dstVec) {
    if (this.KickFlag1) return 0;
    const direction = vec(this.Circle.Center.X - ball.Position.X, this.Circle.Center.Y - ball.Position.Y);
    if (direction.Y * direction.Y + direction.X * direction.X > this.Circle.RadiusSq) return 0;
    normalize_2d(direction);
    dstVec.X = direction.X * this.FieldMult - ball.Acceleration.X * ball.Speed;
    dstVec.Y = direction.Y * this.FieldMult - ball.Acceleration.Y * ball.Speed;
    return 1;
  }

  static TimerExpired(timerId, kick) {
    if (kick.KickFlag1) {
      kick.KickFlag1 = 0;
      kick.Timer = timer.set(kick.TimerTime2, kick, TKickout.ResetTimerExpired);
      if (kick.Ball) {
        kick.Ball.Position.Z = kick.OriginalBallZ;
        TBall.throw_ball(kick.Ball, kick.BallAcceleration, kick.ThrowAngleMult, kick.ThrowSpeedMult1, kick.ThrowSpeedMult2);
        kick.ActiveFlag = 0;
        kick.Ball = null;
        loader.play_sound(kick.HardHitSoundId);
      }
    }
  }

  static ResetTimerExpired(timerId, kick) {
    if (!kick.NotSomeFlag) kick.ActiveFlag = 1;
    kick.Timer = 0;
  }
}

// ---------- TKickback ----------

export class TKickback extends TCollisionComponent {
  constructor(table, groupIndex) {
    super(table, groupIndex, true);
    this.MessageField = 0;
    this.Timer = 0;
    this.KickActiveFlag = 0;
    this.TimerTime = 0.7;
    this.TimerTime2 = 0.1;
    this.Threshold = BIG;
  }

  Message(code, value) {
    if ((code === 1011 || code === 1024) && this.Timer) {
      timer.kill(this.Timer);
      if (this.ListBitmap) render.sprite_set_bitmap(this.RenderSprite, null);
      this.Timer = 0;
      this.KickActiveFlag = 0;
      this.Threshold = BIG;
    }
    return 0;
  }

  Collision(ball, nextPosition, direction, coef, edge) {
    if (this.PinballTable.TiltLockFlag) {
      basic_collision(ball, nextPosition, direction, this.Elasticity, this.Smoothness, 0, this.Boost);
    } else {
      if (!this.KickActiveFlag) {
        this.Threshold = BIG;
        this.KickActiveFlag = 1;
        this.Timer = timer.set(this.TimerTime, this, TKickback.TimerExpired);
      }
      if (this.DefaultCollision(ball, nextPosition, direction)) this.KickActiveFlag = 0;
    }
  }

  static TimerExpired(timerId, kick) {
    if (kick.KickActiveFlag) {
      kick.Threshold = 0;
      kick.Timer = timer.set(kick.TimerTime2, kick, TKickback.TimerExpired);
      loader.play_sound(kick.HardHitSoundId);
      if (kick.ListBitmap) kick.setBitmapIndex(1);
    } else {
      if (kick.ListBitmap) kick.setBitmapIndex(0);
      kick.Timer = 0;
      control.handler(60, kick);
    }
  }
}

// ---------- TGate ----------

export class TGate extends TCollisionComponent {
  constructor(table, groupIndex) {
    super(table, groupIndex, true);
    const visual = newVisual();
    loader.query_visual(groupIndex, 0, visual);
    this.SoundIndex4 = visual.SoundIndex4;
    this.SoundIndex3 = visual.SoundIndex3;
    this.ActiveFlag = 1;
    render.sprite_set_bitmap(this.RenderSprite, this.ListBitmap[0]);
    control.handler(1024, this);
  }

  Message(code, value) {
    if (code !== 1020) {
      if (code === 53) {
        this.ActiveFlag = 0;
        render.sprite_set_bitmap(this.RenderSprite, null);
        loader.play_sound(this.SoundIndex3);
      } else if (code === 54 || code === 1024) {
        this.ActiveFlag = 1;
        render.sprite_set_bitmap(this.RenderSprite, this.ListBitmap[0]);
        if (code === 54) loader.play_sound(this.SoundIndex4);
      }
      control.handler(code, this);
    }
    return 0;
  }
}

// ---------- TBlocker ----------

export class TBlocker extends TCollisionComponent {
  constructor(table, groupIndex) {
    super(table, groupIndex, true);
    const visual = newVisual();
    loader.query_visual(groupIndex, 0, visual);
    this.SoundIndex4 = visual.SoundIndex4;
    this.SoundIndex3 = visual.SoundIndex3;
    this.TurnOnMsgValue = 55;
    this.TurnOffMsgValue = 5;
    this.Threshold = BIG;
    this.Timer = 0;
    this.MessageField = 0;
    this.ActiveFlag = 0;
    render.sprite_set_bitmap(this.RenderSprite, null);
  }

  Message(code, value) {
    switch (code) {
      case 1011:
      case 1020:
      case 1024:
      case 51:
        if (this.Timer) {
          timer.kill(this.Timer);
          this.Timer = 0;
        }
        this.MessageField = 0;
        this.ActiveFlag = 0;
        render.sprite_set_bitmap(this.RenderSprite, null);
        if (code === 51) loader.play_sound(this.SoundIndex3);
        return 0;
      case 52:
        this.ActiveFlag = 1;
        loader.play_sound(this.SoundIndex4);
        render.sprite_set_bitmap(this.RenderSprite, this.ListBitmap[0]);
        break;
      case 59:
        break;
      default:
        return 0;
    }
    if (this.Timer) timer.kill(this.Timer);
    this.Timer = timer.set(value <= 0 ? 0 : value, this, TBlocker.TimerExpired);
    return 0;
  }

  static TimerExpired(timerId, blocker) {
    blocker.Timer = 0;
    control.handler(60, blocker);
  }
}

// ---------- TOneway ----------

export class TOneway extends TCollisionComponent {
  constructor(table, groupIndex) {
    super(table, groupIndex, false);
    const visual = newVisual();
    this.Line = null;
    this.Scores = [0, 0, 0, 0, 0, 0];
    loader.query_visual(groupIndex, 0, visual);
    if (visual.FloatArrCount === 2) {
      const fa = visual.FloatArr;
      let l = new TLine(this, flagRef(this), visual.CollisionGroup, fa[0], fa[1], fa[2], fa[3]);
      l.Offset(table.CollisionCompOffset);
      l.place_in_grid();
      this.EdgeList.push(l);

      l = new TLine(this, flagRef(this), visual.CollisionGroup, fa[2], fa[3], fa[0], fa[1]);
      this.Line = l;
      l.Offset(-table.CollisionCompOffset * 0.8);
      l.place_in_grid();
      this.EdgeList.push(l);
    }
  }

  Collision(ball, nextPosition, direction, coef, edge) {
    if (edge === this.Line) {
      ball.not_again(edge);
      ball.Position.X = nextPosition.X;
      ball.Position.Y = nextPosition.Y;
      ball.RayMaxDistance -= coef;
      if (!this.PinballTable.TiltLockFlag) {
        if (this.HardHitSoundId) loader.play_sound(this.HardHitSoundId);
        control.handler(63, this);
      }
    } else if (this.PinballTable.TiltLockFlag) {
      basic_collision(ball, nextPosition, direction, this.Elasticity, this.Smoothness, BIG, 0);
    } else if (basic_collision(ball, nextPosition, direction, this.Elasticity, this.Smoothness, this.Threshold, this.Boost) > 0.2) {
      if (this.SoftHitSoundId) loader.play_sound(this.SoftHitSoundId);
    }
  }

  put_scoring(index, value) {
    if (index < 6) this.Scores[index] = value;
  }

  get_scoring(index) {
    return index < 6 ? this.Scores[index] : 0;
  }
}

// ---------- TRollover / TLightRollover / TTripwire ----------

export class TRollover extends TCollisionComponent {
  // build: false for subclasses that build their own walls (the protected constructor).
  constructor(table, groupIndex, createWall = false, build = true) {
    super(table, groupIndex, createWall);
    this.RolloverFlag = 0;
    this.Scores = [0, 0];
    if (build) {
      if (this.ListBitmap) render.sprite_set_bitmap(this.RenderSprite, this.ListBitmap[0]);
      this.build_walls(groupIndex);
    }
  }

  Message(code, value) {
    if (code === 1024) {
      this.ActiveFlag = 1;
      this.RolloverFlag = 0;
      if (this.ListBitmap) render.sprite_set_bitmap(this.RenderSprite, this.ListBitmap[0]);
    }
    return 0;
  }

  Collision(ball, nextPosition, direction, coef, edge) {
    ball.Position.X = nextPosition.X;
    ball.Position.Y = nextPosition.Y;
    ball.RayMaxDistance -= coef;
    ball.not_again(edge);
    if (!this.PinballTable.TiltLockFlag) {
      if (this.RolloverFlag) {
        timer.set(0.1, this, TRollover.TimerExpired);
        this.ActiveFlag = 0;
      } else {
        loader.play_sound(this.SoftHitSoundId);
        control.handler(63, this);
      }
      this.RolloverFlag = this.RolloverFlag === 0 ? 1 : 0;
      if (this.ListBitmap) render.sprite_set_bitmap(this.RenderSprite, this.RolloverFlag ? null : this.ListBitmap[0]);
    }
  }

  put_scoring(index, value) {
    if (index < 2) this.Scores[index] = value;
  }

  get_scoring(index) {
    return index < 2 ? this.Scores[index] : 0;
  }

  build_walls(groupIndex) {
    const visual = newVisual();
    loader.query_visual(groupIndex, 0, visual);
    TEdgeSegment.install_wall(loader.query_float_attribute(groupIndex, 0, 600), this, flagRef(this), visual.CollisionGroup, 0, 600);
    TEdgeSegment.install_wall(loader.query_float_attribute(groupIndex, 0, 603), this, flagRef(this, 'RolloverFlag'), visual.CollisionGroup, 0, 603);
  }

  static TimerExpired(timerId, roll) {
    roll.ActiveFlag = 1;
  }
}

export class TLightRollover extends TRollover {
  constructor(table, groupIndex) {
    super(table, groupIndex, false, false);
    this.RolloverFlag = 0;
    this.Timer = 0;
    if (this.ListBitmap) render.sprite_set_bitmap(this.RenderSprite, null);
    this.build_walls(groupIndex);
    this.FloatArr = loader.query_float_attribute(groupIndex, 0, 407)[0];
  }

  Message(code, value) {
    if (code === 1024) {
      this.ActiveFlag = 1;
      this.RolloverFlag = 0;
      if (this.Timer) timer.kill(this.Timer);
      this.Timer = 0;
      if (this.ListBitmap) render.sprite_set_bitmap(this.RenderSprite, null);
    }
    return 0;
  }

  Collision(ball, nextPosition, direction, coef, edge) {
    ball.Position.X = nextPosition.X;
    ball.Position.Y = nextPosition.Y;
    ball.RayMaxDistance -= coef;
    ball.not_again(edge);
    if (!this.PinballTable.TiltLockFlag) {
      if (this.RolloverFlag) {
        timer.set(0.1, this, TRollover.TimerExpired);
        this.ActiveFlag = 0;
        this.RolloverFlag = 0;
        if (this.Timer === 0) this.Timer = timer.set(this.FloatArr, this, TLightRollover.delay_expired);
      } else {
        loader.play_sound(this.SoftHitSoundId);
        control.handler(63, this);
        this.RolloverFlag = 1;
        if (this.ListBitmap) render.sprite_set_bitmap(this.RenderSprite, this.ListBitmap[0]);
      }
    }
  }

  static delay_expired(timerId, roll) {
    render.sprite_set_bitmap(roll.RenderSprite, null);
    roll.Timer = 0;
  }
}

export class TTripwire extends TRollover {
  constructor(table, groupIndex) {
    super(table, groupIndex, true, false);
  }

  Collision(ball, nextPosition, direction, coef, edge) {
    ball.Position.X = nextPosition.X;
    ball.Position.Y = nextPosition.Y;
    ball.RayMaxDistance -= coef;
    ball.not_again(edge);
    if (!this.PinballTable.TiltLockFlag) {
      loader.play_sound(this.SoftHitSoundId);
      control.handler(63, this);
    }
  }
}

// ---------- TSink ----------

export class TSink extends TCollisionComponent {
  constructor(table, groupIndex) {
    super(table, groupIndex, true);
    const visual = newVisual();
    this.MessageField = 0;
    this.Timer = 0;
    this.Scores = [0, 0, 0];
    this.PlayerMessagefieldBackup = [0, 0, 0, 0];
    loader.query_visual(groupIndex, 0, visual);
    this.BallAcceleration = copyVec(visual.Kicker.ThrowBallAcceleration);
    this.ThrowAngleMult = visual.Kicker.ThrowBallAngleMult;
    this.ThrowSpeedMult1 = visual.Kicker.Boost;
    this.ThrowSpeedMult2 = visual.Kicker.ThrowBallMult * 0.01;
    this.SoundIndex4 = visual.SoundIndex4;
    this.SoundIndex3 = visual.SoundIndex3;
    const floatArr = loader.query_float_attribute(groupIndex, 0, 601);
    this.BallPosition = vec(floatArr[0], floatArr[1]);
    this.TimerTime = loader.query_float_attribute(groupIndex, 0, 407)[0];
  }

  Message(code, value) {
    switch (code) {
      case 56:
        if (value < 0) value = this.TimerTime;
        this.Timer = timer.set(value, this, TSink.TimerExpired);
        break;
      case 1020:
        this.PlayerMessagefieldBackup[this.PinballTable.CurrentPlayer] = this.MessageField;
        this.MessageField = this.PlayerMessagefieldBackup[Math.floor(value)];
        break;
      case 1024:
        if (this.Timer) timer.kill(this.Timer);
        this.Timer = 0;
        this.MessageField = 0;
        for (let index = 0; index < this.PinballTable.PlayerCount; ++index) this.PlayerMessagefieldBackup[index] = 0;
        break;
      default:
        break;
    }
    return 0;
  }

  put_scoring(index, value) {
    if (index < 3) this.Scores[index] = value;
  }

  get_scoring(index) {
    return index < 3 ? this.Scores[index] : 0;
  }

  Collision(ball, nextPosition, direction, coef, edge) {
    this.Timer = 0;
    if (this.PinballTable.TiltLockFlag) {
      basic_collision(ball, nextPosition, direction, this.Elasticity, this.Smoothness, BIG, 0);
    } else {
      ball.ActiveFlag = 0;
      render.sprite_set_bitmap(ball.RenderSprite, null);
      loader.play_sound(this.SoundIndex4);
      control.handler(63, this);
    }
  }

  static TimerExpired(timerId, sink) {
    const ball = sink.PinballTable.BallList[0];
    ball.CollisionComp = null;
    ball.ActiveFlag = 1;
    ball.Position.X = sink.BallPosition.X;
    ball.Position.Y = sink.BallPosition.Y;
    TBall.throw_ball(ball, sink.BallAcceleration, sink.ThrowAngleMult, sink.ThrowSpeedMult1, sink.ThrowSpeedMult2);
    if (sink.SoundIndex3) loader.play_sound(sink.SoundIndex3);
    sink.Timer = 0;
  }
}

// ---------- THole ----------

export class THole extends TCollisionComponent {
  constructor(table, groupIndex) {
    super(table, groupIndex, false);
    const visual = newVisual();
    this.Unknown4 = 0.050000001;
    this.MessageField = 0;
    this.Timer = 0;
    this.BallCapturedFlag = 0;
    this.BallCapturedSecondStage = 0;
    this.Unknown3 = loader.query_float_attribute(groupIndex, 0, 407, 0.25);
    this.GravityMult = loader.query_float_attribute(groupIndex, 0, 701, 0.2);
    this.GravityPull = loader.query_float_attribute(groupIndex, 0, 305)[0];

    loader.query_visual(groupIndex, 0, visual);
    const fa = visual.FloatArr;
    this.Circle = { Center: vec(fa[0], fa[1], fa[2]), RadiusSq: loader.query_float_attribute(groupIndex, 0, 306)[0] * fa[2] };
    if (this.Circle.RadiusSq === 0) this.Circle.RadiusSq = 0.001;
    const tCircle = new TCircle(this, flagRef(this), visual.CollisionGroup, vecAt(fa), this.Circle.RadiusSq);
    tCircle.place_in_grid();
    this.EdgeList.push(tCircle);

    this.ZSetValue = loader.query_float_attribute(groupIndex, 0, 408)[2];
    this.FieldFlag = Math.floor(loader.query_float_attribute(groupIndex, 0, 1304)[0]);

    this.Circle.RadiusSq = fa[2] * fa[2];
    this.Field = { Flag2Ptr: flagRef(this), CollisionComp: this, Mask: visual.CollisionGroup };
    edges_insert_circle({ Center: copyVec(this.Circle.Center), RadiusSq: this.Circle.RadiusSq }, null, this.Field);
  }

  Message(code, value) {
    if (code === 1024 && this.BallCapturedFlag) {
      if (this.Timer) timer.kill(this.Timer);
      this.Timer = 0;
      this.BallCapturedSecondStage = 1;
    }
    return 0;
  }

  Collision(ball, nextPosition, direction, coef, edge) {
    if (!this.BallCapturedFlag) {
      this.BallCapturedSecondStage = 0;
      this.Threshold = BIG;
      this.BallCapturedFlag = 1;
      ball.CollisionComp = this;
      ball.Position.X = this.Circle.Center.X;
      ball.Position.Y = this.Circle.Center.Y;
      ball.Acceleration.Z = 0;
      this.Timer = timer.set(0.5, this, THole.TimerExpired);
      if (!this.PinballTable.TiltLockFlag) {
        loader.play_sound(this.HardHitSoundId);
        control.handler(57, this);
      }
    }
  }

  FieldEffect(ball, vecDst) {
    if (this.BallCapturedFlag) {
      if (this.BallCapturedSecondStage) {
        ball.Acceleration.Z -= this.PinballTable.GravityDirVectMult * ball.TimeDelta * this.GravityMult;
        ball.Position.Z += ball.Acceleration.Z;
        if (ball.Position.Z <= this.ZSetValue) {
          this.BallCapturedFlag = 0;
          this.BallCapturedSecondStage = 0;
          ball.Position.Z = this.ZSetValue;
          ball.Acceleration.Z = 0;
          ball.FieldFlag = this.FieldFlag;
          ball.Acceleration.Y = 0;
          ball.CollisionComp = null;
          ball.Acceleration.X = 0;
          ball.Speed = 0;
          loader.play_sound(this.SoftHitSoundId);
          control.handler(58, this);
        }
      }
      return 0;
    }
    const direction = vec(this.Circle.Center.X - ball.Position.X, this.Circle.Center.Y - ball.Position.Y);
    if (direction.X * direction.X + direction.Y * direction.Y <= this.Circle.RadiusSq) {
      normalize_2d(direction);
      vecDst.X = direction.X * this.GravityPull - ball.Acceleration.X * ball.Speed;
      vecDst.Y = direction.Y * this.GravityPull - ball.Acceleration.Y * ball.Speed;
      return 1;
    }
    return 0;
  }

  static TimerExpired(timerId, hole) {
    hole.Timer = 0;
    hole.BallCapturedSecondStage = 1;
  }
}

// ---------- TFlagSpinner ----------

export class TFlagSpinner extends TCollisionComponent {
  constructor(table, groupIndex) {
    super(table, groupIndex, false);
    const visual = newVisual();
    this.Timer = 0;
    this.Speed = 0;
    this.SpinDirection = 0;
    this.BmpIndex = 0;
    this.Scores = [0, 0];
    loader.query_visual(groupIndex, 0, visual);
    const fa = visual.FloatArr;
    let l = new TLine(this, flagRef(this), visual.CollisionGroup, fa[2], fa[3], fa[0], fa[1]);
    l.place_in_grid();
    this.EdgeList.push(l);
    l = new TLine(this, flagRef(this), visual.CollisionGroup, fa[0], fa[1], fa[2], fa[3]);
    this.PrevCollider = l;
    l.place_in_grid();
    this.EdgeList.push(l);

    this.SpeedDecrement = 0.64999998;
    this.MaxSpeed = 50000;
    this.MinSpeed = 5;
    const speedDec = loader.query_float_attribute(groupIndex, 0, 1202);
    if (speedDec) this.SpeedDecrement = speedDec[0];
    const maxSpeed = loader.query_float_attribute(groupIndex, 0, 1200);
    if (maxSpeed) this.MaxSpeed = maxSpeed[0];
    const minSpeed = loader.query_float_attribute(groupIndex, 0, 1201);
    if (minSpeed) this.MinSpeed = minSpeed[0];
  }

  Message(code, value) {
    if (code === 1024) {
      if (this.Timer) {
        timer.kill(this.Timer);
        this.Timer = 0;
      }
      this.BmpIndex = 0;
      this.setBitmapIndex(0);
    }
    return 0;
  }

  Collision(ball, nextPosition, direction, coef, edge) {
    ball.Position.X = nextPosition.X;
    ball.Position.Y = nextPosition.Y;
    ball.RayMaxDistance -= coef;
    ball.not_again(edge);
    this.SpinDirection = 2 * (this.PrevCollider !== edge ? 1 : 0) - 1;
    this.Speed = ball.Speed === 0 ? this.MinSpeed : ball.Speed * 20;
    if (this.Speed < this.MinSpeed) this.Speed = this.MinSpeed;
    if (this.Speed > this.MaxSpeed) this.Speed = this.MaxSpeed;
    this.NextFrame();
  }

  put_scoring(index, value) {
    if (index < 2) this.Scores[index] = value;
  }

  get_scoring(index) {
    return index < 2 ? this.Scores[index] : 0;
  }

  NextFrame() {
    this.BmpIndex += this.SpinDirection;
    const bmpCount = this.ListBitmap.length;
    if (this.BmpIndex >= bmpCount) this.BmpIndex = 0;
    else if (this.BmpIndex < 0) this.BmpIndex = bmpCount - 1;

    if (!this.PinballTable.TiltLockFlag) {
      control.handler(63, this);
      if (this.SoftHitSoundId) loader.play_sound(this.SoftHitSoundId);
      if (!this.BmpIndex) control.handler(62, this);
    }
    this.setBitmapIndex(this.BmpIndex);

    this.Speed *= this.SpeedDecrement;
    if (this.Speed >= this.MinSpeed) timer.set(1 / this.Speed, this, TFlagSpinner.SpinTimer);
  }

  static SpinTimer(timerId, spinner) {
    spinner.Timer = 0;
    spinner.NextFrame();
  }
}

// ---------- TPopupTarget ----------

export class TPopupTarget extends TCollisionComponent {
  constructor(table, groupIndex) {
    super(table, groupIndex, true);
    this.Timer = 0;
    this.Scores = [0, 0, 0];
    this.PlayerMessagefieldBackup = [0, 0, 0, 0];
    this.TimerTime = loader.query_float_attribute(groupIndex, 0, 407)[0];
  }

  Message(code, value) {
    switch (code) {
      case 49:
        this.ActiveFlag = 0;
        render.sprite_set_bitmap(this.RenderSprite, null);
        break;
      case 50:
        this.Timer = timer.set(this.TimerTime, this, TPopupTarget.TimerExpired);
        break;
      case 1020:
        this.PlayerMessagefieldBackup[this.PinballTable.CurrentPlayer] = this.MessageField;
        this.MessageField = this.PlayerMessagefieldBackup[Math.floor(value)];
        TPopupTarget.prototype.Message.call(this, 50 - (this.MessageField !== 0 ? 1 : 0), 0);
        break;
      case 1024:
        this.MessageField = 0;
        for (let index = 0; index < this.PinballTable.PlayerCount; ++index) this.PlayerMessagefieldBackup[index] = 0;
        if (this.Timer) timer.kill(this.Timer);
        TPopupTarget.TimerExpired(0, this);
        break;
      default:
        break;
    }
    return 0;
  }

  put_scoring(index, value) {
    if (index < 3) this.Scores[index] = value;
  }

  get_scoring(index) {
    return index < 3 ? this.Scores[index] : 0;
  }

  Collision(ball, nextPosition, direction, coef, edge) {
    if (this.PinballTable.TiltLockFlag) {
      basic_collision(ball, nextPosition, direction, this.Elasticity, this.Smoothness, BIG, 0);
    } else if (basic_collision(ball, nextPosition, direction, this.Elasticity, this.Smoothness, this.Threshold, this.Boost) > this.Threshold) {
      if (this.HardHitSoundId) loader.play_sound(this.HardHitSoundId);
      this.Message(49, 0);
      control.handler(63, this);
    }
  }

  static TimerExpired(timerId, target) {
    target.Timer = 0;
    target.ActiveFlag = 1;
    render.sprite_set_bitmap(target.RenderSprite, target.ListBitmap[0]);
    if (timerId && target.SoftHitSoundId) loader.play_sound(target.SoftHitSoundId);
  }
}

// ---------- TSoloTarget ----------

export class TSoloTarget extends TCollisionComponent {
  constructor(table, groupIndex) {
    super(table, groupIndex, true);
    const visual = newVisual();
    this.Timer = 0;
    this.TimerTime = 0.1;
    this.Scores = [0];
    loader.query_visual(groupIndex, 0, visual);
    this.SoundIndex4 = visual.SoundIndex4;
    TSoloTarget.prototype.Message.call(this, 50, 0);
  }

  Message(code, value) {
    switch (code) {
      case 49:
      case 50:
        this.ActiveFlag = code === 50 ? 1 : 0;
        break;
      case 1024:
        if (this.Timer) timer.kill(this.Timer);
        this.Timer = 0;
        this.ActiveFlag = 1;
        break;
      default:
        return 0;
    }
    if (this.ListBitmap) this.setBitmapIndex(1 - this.ActiveFlag);
    return 0;
  }

  put_scoring(index, value) {
    if (index < 1) this.Scores[index] = value;
  }

  get_scoring(index) {
    return index < 1 ? this.Scores[index] : 0;
  }

  Collision(ball, nextPosition, direction, coef, edge) {
    if (this.DefaultCollision(ball, nextPosition, direction)) {
      this.Message(49, 0);
      this.Timer = timer.set(this.TimerTime, this, TSoloTarget.TimerExpired);
      control.handler(63, this);
    }
  }

  static TimerExpired(timerId, target) {
    target.Message(50, 0);
    target.Timer = 0;
  }
}

// ---------- TRamp ----------

export class TRamp extends TCollisionComponent {
  constructor(table, groupIndex) {
    super(table, groupIndex, false);
    const visual = newVisual();
    this.MessageField = 0;
    this.UnusedBaseFlag = 1;
    this.Scores = [0, 0, 0, 0];
    loader.query_visual(groupIndex, 0, visual);
    this.CollisionGroup = visual.CollisionGroup;
    this.BallFieldMult = loader.query_float_attribute(groupIndex, 0, 701, 0.2);
    this.RampFlag1 = Math.trunc(loader.query_float_attribute(groupIndex, 0, 1305, 0));

    // Planes: 13 floats each (offset xyz, three corners, two gravity angles, force).
    const planeArr = loader.query_float_attribute(groupIndex, 0, 1300);
    this.RampPlaneCount = Math.floor(planeArr[0]);
    this.RampPlane = [];
    for (let i = 0; i < this.RampPlaneCount; i++) {
      const o = 1 + i * 13;
      this.RampPlane.push({
        BallCollisionOffset: vec(planeArr[o], planeArr[o + 1], planeArr[o + 2]),
        V1: { X: planeArr[o + 3], Y: planeArr[o + 4] },
        V2: { X: planeArr[o + 5], Y: planeArr[o + 6] },
        V3: { X: planeArr[o + 7], Y: planeArr[o + 8] },
        GravityAngle1: planeArr[o + 9],
        GravityAngle2: planeArr[o + 10],
        FieldForce: { X: planeArr[o + 11], Y: planeArr[o + 12] },
      });
    }

    const floatArr4 = loader.query_float_attribute(groupIndex, 0, 1303);
    this.Line1 = new TLine(this, flagRef(this), 1 << Math.floor(floatArr4[0]), floatArr4[4], floatArr4[5], floatArr4[2], floatArr4[3]);
    this.EdgeList.push(this.Line1);
    this.Line1.WallValue = null;
    this.Line1.place_in_grid();

    const wall1 = loader.query_float_attribute(groupIndex, 0, 1301);
    this.Wall1PointFirst = 1 << Math.floor(wall1[0]);
    const wallPt1_2 = Math.floor(wall1[1]);
    this.Wall1PointLast = wall1[7];
    const [end2, start2] = find_closest_edge(this.RampPlane, wall1.subarray(3, 7));
    this.Line2 = new TLine(this, flagRef(this), this.CollisionGroup, start2.X, start2.Y, end2.X, end2.Y);
    this.EdgeList.push(this.Line2);
    this.Line2.WallValue = null;
    this.Line2.place_in_grid();

    const wall2 = loader.query_float_attribute(groupIndex, 0, 1302);
    const wall2Pt1_2 = Math.floor(wall2[1]);
    this.Wall2PointFirst = 1 << Math.floor(wall2[0]);
    this.Wall2PointLast = wall2[7];
    const [end3, start3] = find_closest_edge(this.RampPlane, wall2.subarray(3, 7));
    this.Line3 = new TLine(this, flagRef(this), this.CollisionGroup, start3.X, start3.Y, end3.X, end3.Y);
    this.EdgeList.push(this.Line3);
    this.Line3.WallValue = null;
    this.Line3.place_in_grid();

    let xMin = 1000000000.0;
    let yMin = 1000000000.0;
    let yMax = -1000000000.0;
    let xMax = -1000000000.0;
    for (const plane of this.RampPlane) {
      xMin = Math.min(Math.min(Math.min(plane.V3.X, plane.V1.X), plane.V2.X), xMin);
      yMin = Math.min(Math.min(Math.min(plane.V3.Y, plane.V1.Y), plane.V2.Y), xMin); // Sic
      xMax = Math.max(Math.max(Math.max(plane.V3.X, plane.V1.X), plane.V2.X), xMin);
      yMax = Math.max(Math.max(Math.max(plane.V3.Y, plane.V1.Y), plane.V2.Y), xMin);

      const pointOrder = [plane.V1, plane.V2, plane.V3, plane.V1];
      for (let pt = 0; pt < 3; pt++) {
        const point1 = pointOrder[pt];
        const point2 = pointOrder[pt + 1];
        let collisionGroup = 0;
        if (point1 !== end2 || point2 !== start2) {
          if (point1 !== end3 || point2 !== start3) collisionGroup = visual.CollisionGroup;
          else if (wall2Pt1_2) collisionGroup = this.Wall2PointFirst;
        } else if (wallPt1_2) {
          collisionGroup = this.Wall1PointFirst;
        }
        if (collisionGroup) {
          const l = new TLine(this, flagRef(this), collisionGroup, point1.X, point1.Y, point2.X, point2.Y);
          this.EdgeList.push(l);
          l.WallValue = plane;
          l.place_in_grid();
        }
      }

      plane.FieldForce.X = Math.cos(plane.GravityAngle2) * Math.sin(plane.GravityAngle1) * table.GravityDirVectMult;
      plane.FieldForce.Y = Math.sin(plane.GravityAngle2) * Math.sin(plane.GravityAngle1) * table.GravityDirVectMult;
    }

    this.Field = { Flag2Ptr: flagRef(this), CollisionComp: this, Mask: visual.CollisionGroup };
    edges_insert_square(yMin, xMin, yMax, xMax, null, this.Field);
  }

  put_scoring(index, value) {
    if (index < 4) this.Scores[index] = value;
  }

  get_scoring(index) {
    return index < 4 ? this.Scores[index] : 0;
  }

  Collision(ball, nextPosition, direction, coef, edge) {
    ball.not_again(edge);
    ball.Position.X = nextPosition.X;
    ball.Position.Y = nextPosition.Y;
    ball.RayMaxDistance -= coef;

    const plane = edge.WallValue;
    if (plane) {
      ball.CollisionFlag = 1;
      ball.CollisionOffset.X = plane.BallCollisionOffset.X;
      ball.CollisionOffset.Y = plane.BallCollisionOffset.Y;
      ball.CollisionOffset.Z = plane.BallCollisionOffset.Z;
      ball.RampFieldForce.X = plane.FieldForce.X;
      ball.RampFieldForce.Y = plane.FieldForce.Y;
      ball.Position.Z = ball.Position.X * ball.CollisionOffset.X + ball.Position.Y * ball.CollisionOffset.Y + ball.Offset + ball.CollisionOffset.Z;
      ball.FieldFlag = this.CollisionGroup;
      return;
    }

    if (edge === this.Line1) {
      if (!this.PinballTable.TiltLockFlag) {
        loader.play_sound(this.SoftHitSoundId);
        control.handler(63, this);
      }
    } else {
      ball.CollisionFlag = 0;
      if (edge === this.Line2) {
        ball.FieldFlag = this.Wall1PointFirst;
        if (!this.RampFlag1) return;
        ball.Position.Z = ball.Offset + this.Wall1PointLast;
      } else {
        ball.FieldFlag = this.Wall2PointFirst;
        if (!this.RampFlag1) return;
        ball.Position.Z = ball.Offset + this.Wall2PointLast;
      }
    }
  }

  FieldEffect(ball, vecDst) {
    vecDst.X = ball.RampFieldForce.X - ball.Acceleration.X * ball.Speed * this.BallFieldMult;
    vecDst.Y = ball.RampFieldForce.Y - ball.Acceleration.Y * ball.Speed * this.BallFieldMult;
    return 1;
  }
}

// ---------- TDemo ----------

export class TDemo extends TCollisionComponent {
  constructor(table, groupIndex) {
    super(table, groupIndex, false);
    const visual = newVisual();
    this.RestartGameTimer = 0;
    this.PlungerFlag = 0;
    this.FlipLeftTimer = 0;
    this.FlipRightTimer = 0;
    this.MessageField = 0;
    this.UnusedBaseFlag = 0;
    this.ActiveFlag = 0;
    this.FlipRightFlag = 0;
    this.FlipLeftFlag = 0;
    table.Demo = this;
    const floatArr1 = loader.query_float_attribute(groupIndex, 0, 407);
    if (floatArr1) {
      this.FlipTimerTime1 = floatArr1[0];
      this.FlipTimerTime2 = floatArr1[1];
      this.UnFlipTimerTime1 = floatArr1[2];
      this.UnFlipTimerTime2 = floatArr1[3];
    } else {
      this.FlipTimerTime1 = 0.2;
      this.FlipTimerTime2 = 0.1;
      this.UnFlipTimerTime1 = 0.2;
      this.UnFlipTimerTime2 = 0.1;
    }
    loader.query_visual(groupIndex, 0, visual);
    const install = (attr, offset) => TEdgeSegment.install_wall(loader.query_float_attribute(groupIndex, 0, attr), this, flagRef(this), visual.CollisionGroup, offset, attr);
    this.Edge1 = install(1400, 0);
    install(1401, 0);
    this.Edge2 = install(1402, 0);
    install(1403, 0);
    this.Edge3 = install(1404, table.CollisionCompOffset);
  }

  Message(code, value) {
    switch (code) {
      case 1014:
        if (this.RestartGameTimer) timer.kill(this.RestartGameTimer);
        this.RestartGameTimer = 0;
        break;
      case 1022:
        if (this.RestartGameTimer) timer.kill(this.RestartGameTimer);
        this.RestartGameTimer = 0;
        if (this.ActiveFlag) this.RestartGameTimer = timer.set(5, this, TDemo.NewGameRestartTimer);
        break;
      case 1024:
        if (this.FlipLeftTimer) timer.kill(this.FlipLeftTimer);
        this.FlipLeftTimer = 0;
        if (this.FlipRightTimer) timer.kill(this.FlipRightTimer);
        this.FlipRightTimer = 0;
        if (this.FlipLeftFlag) TDemo.UnFlipLeft(0, this);
        if (this.FlipRightFlag) TDemo.UnFlipRight(0, this);
        if (this.PlungerFlag) TDemo.PlungerRelease(0, this);
        break;
      default:
        break;
    }
    return 0;
  }

  Collision(ball, nextPosition, direction, coef, edge) {
    ball.not_again(edge);
    ball.Position.X = nextPosition.X;
    ball.Position.Y = nextPosition.Y;
    ball.RayMaxDistance -= coef;
    switch (edge.WallValue) {
      case 1400:
        if (!this.FlipLeftTimer && !this.FlipLeftFlag) {
          const time = this.FlipTimerTime1 + this.FlipTimerTime2 - RandFloat() * (this.FlipTimerTime2 + this.FlipTimerTime2);
          this.FlipLeftTimer = timer.set(time, this, TDemo.FlipLeft);
        }
        break;
      case 1401:
        TDemo.FlipLeft(0, this);
        break;
      case 1402:
        if (!this.FlipRightTimer && !this.FlipRightFlag) {
          const time = this.FlipTimerTime1 + this.FlipTimerTime2 - RandFloat() * (this.FlipTimerTime2 + this.FlipTimerTime2);
          this.FlipRightTimer = timer.set(time, this, TDemo.FlipRight);
        }
        break;
      case 1403:
        TDemo.FlipRight(0, this);
        break;
      case 1404:
        if (!this.PlungerFlag) {
          this.PinballTable.Message(1004, ball.TimeNow);
          this.PlungerFlag = timer.set(RandFloat() + 2, this, TDemo.PlungerRelease);
        }
        break;
      default:
        break;
    }
  }

  static PlungerRelease(timerId, demo) {
    demo.PlungerFlag = 0;
    demo.PinballTable.Message(1005, pb.time_next);
  }

  static UnFlipRight(timerId, demo) {
    if (demo.FlipRightFlag) demo.PinballTable.Message(1003, pb.time_next);
    demo.FlipRightFlag = 0;
  }

  static UnFlipLeft(timerId, demo) {
    if (demo.FlipLeftFlag) demo.PinballTable.Message(1001, pb.time_next);
    demo.FlipLeftFlag = 0;
  }

  static FlipRight(timerId, demo) {
    if (!demo.FlipRightFlag) {
      if (demo.FlipRightTimer) {
        timer.kill(demo.FlipRightTimer);
        demo.FlipRightTimer = 0;
      }
      demo.PinballTable.Message(1002, pb.time_next);
      demo.FlipRightFlag = 1;
      const time = demo.UnFlipTimerTime1 + demo.UnFlipTimerTime2 - RandFloat() * (demo.UnFlipTimerTime2 + demo.UnFlipTimerTime2);
      timer.set(time, demo, TDemo.UnFlipRight);
    }
  }

  static FlipLeft(timerId, demo) {
    if (!demo.FlipLeftFlag) {
      if (demo.FlipLeftTimer) {
        timer.kill(demo.FlipLeftTimer);
        demo.FlipLeftTimer = 0;
      }
      demo.PinballTable.Message(1000, pb.time_next);
      demo.FlipLeftFlag = 1;
      const time = demo.UnFlipTimerTime1 + demo.UnFlipTimerTime2 - RandFloat() * (demo.UnFlipTimerTime2 + demo.UnFlipTimerTime2);
      timer.set(time, demo, TDemo.UnFlipLeft);
    }
  }

  static NewGameRestartTimer(timerId, demo) {
    pb.replay_level(1);
    demo.PinballTable.Message(1014, demo.PinballTable.PlayerCount);
    demo.RestartGameTimer = 0;
  }
}

// ---------- TLight ----------

export class TLight extends TPinballComponent {
  constructor(table, groupIndex) {
    super(table, groupIndex, true);
    this.Timer1 = 0;
    this.FlasherActive = 0;
    this.Timer2 = 0;
    this.Flasher = { Sprite: null, BmpArr: [null, null], TimerDelay: [0, 0], Timer: 0, BmpIndex: 0 };
    this.BmpIndex1 = 0;
    this.FlasherFlag1 = 0;
    this.FlasherFlag2 = 0;
    this.TurnOffAfterFlashingFg = 0;
    this.BmpIndex2 = 0;
    this.FlasherDelay = [0, 0];
    this.PlayerData = Array.from({ length: 4 }, () => ({ MessageField: 0, BmpIndex1: 0, FlasherActive: 0, BmpIndex2: 0 }));
    this.Reset();
    const floatArr1 = loader.query_float_attribute(groupIndex, 0, 900);
    this.Flasher.TimerDelay[0] = floatArr1[0];
    this.FlasherDelay[0] = floatArr1[0];
    const floatArr2 = loader.query_float_attribute(groupIndex, 0, 901);
    this.Flasher.TimerDelay[1] = floatArr2[0];
    this.FlasherDelay[1] = floatArr2[0];
  }

  Message(code, value) {
    switch (code) {
      case 1024:
        this.Reset();
        for (let index = 0; index < this.PinballTable.PlayerCount; ++index) this.savePlayer(this.PlayerData[index]);
        break;
      case 1020: {
        this.savePlayer(this.PlayerData[this.PinballTable.CurrentPlayer]);
        this.Reset();
        const player = this.PlayerData[Math.floor(value)];
        this.FlasherActive = player.FlasherActive;
        this.BmpIndex2 = player.BmpIndex2;
        this.BmpIndex1 = player.BmpIndex1;
        this.MessageField = player.MessageField;
        if (this.BmpIndex2) this.Message(11, this.BmpIndex2);
        if (this.BmpIndex1) this.Message(1, 0);
        if (this.FlasherActive) this.Message(4, 0);
        break;
      }
      case 0:
        this.BmpIndex1 = 0;
        if (this.FlasherActive === 0 && !this.FlasherFlag1 && !this.FlasherFlag2) render.sprite_set_bitmap(this.RenderSprite, this.Flasher.BmpArr[0]);
        break;
      case 1:
        this.BmpIndex1 = 1;
        if (this.FlasherActive === 0 && !this.FlasherFlag1 && !this.FlasherFlag2) render.sprite_set_bitmap(this.RenderSprite, this.Flasher.BmpArr[1]);
        break;
      case 2:
        return this.BmpIndex1;
      case 3:
        return this.FlasherActive;
      case 4:
        this.schedule_timeout(0);
        if (!this.FlasherActive || !this.Flasher.Timer) {
          this.FlasherActive = 1;
          this.FlasherFlag2 = 0;
          this.FlasherFlag1 = 0;
          this.TurnOffAfterFlashingFg = 0;
          TLight.flasher_start(this.Flasher, this.BmpIndex1);
        }
        break;
      case 5:
        this.Flasher.TimerDelay[0] = value * this.FlasherDelay[0];
        this.Flasher.TimerDelay[1] = value * this.FlasherDelay[1];
        break;
      case 6:
        this.Flasher.TimerDelay[0] = this.FlasherDelay[0];
        this.Flasher.TimerDelay[1] = this.FlasherDelay[1];
        break;
      case 7:
        if (!this.FlasherActive) TLight.flasher_start(this.Flasher, this.BmpIndex1);
        this.FlasherActive = 1;
        this.FlasherFlag2 = 0;
        this.TurnOffAfterFlashingFg = 0;
        this.FlasherFlag1 = 0;
        this.schedule_timeout(value);
        break;
      case 8:
        if (!this.FlasherFlag1) {
          if (this.FlasherActive) {
            TLight.flasher_stop(this.Flasher, 0);
            this.FlasherActive = 0;
          } else {
            render.sprite_set_bitmap(this.RenderSprite, this.Flasher.BmpArr[0]);
          }
          this.FlasherFlag1 = 1;
          this.FlasherFlag2 = 0;
        }
        this.schedule_timeout(value);
        break;
      case 9:
        if (!this.FlasherFlag2) {
          if (this.FlasherActive) {
            TLight.flasher_stop(this.Flasher, 1);
            this.FlasherActive = 0;
          } else {
            render.sprite_set_bitmap(this.RenderSprite, this.Flasher.BmpArr[1]);
          }
          this.FlasherFlag2 = 1;
          this.FlasherFlag1 = 0;
        }
        this.schedule_timeout(value);
        break;
      case 11: {
        let bmpIndex = 0;
        this.BmpIndex2 = Math.floor(value);
        if (this.BmpIndex2 > this.ListBitmap.length) this.BmpIndex2 = this.ListBitmap.length;
        if (this.BmpIndex2 < 0) this.BmpIndex2 = 0;
        this.Flasher.BmpArr[0] = null;
        // Index == size reads past the end in the original; treat it as no bitmap.
        this.Flasher.BmpArr[1] = this.ListBitmap[this.BmpIndex2] ?? null;
        if (this.FlasherActive === 0) {
          if (!this.FlasherFlag1) bmpIndex = this.FlasherFlag2 ? 1 : this.BmpIndex1;
        } else {
          bmpIndex = this.Flasher.BmpIndex;
        }
        render.sprite_set_bitmap(this.RenderSprite, this.Flasher.BmpArr[bmpIndex]);
        break;
      }
      case 12: {
        let bmpIndex = this.BmpIndex2 + 1;
        if (bmpIndex > this.ListBitmap.length) bmpIndex = this.ListBitmap.length;
        this.Message(11, bmpIndex);
        break;
      }
      case 13: {
        let bmpIndex = this.BmpIndex2 - 1;
        if (bmpIndex < 0) bmpIndex = 0;
        this.Message(11, bmpIndex);
        break;
      }
      case 14:
        if (this.Timer1) timer.kill(this.Timer1);
        this.Timer1 = 0;
        if (this.FlasherActive !== 0) TLight.flasher_stop(this.Flasher, -1);
        this.FlasherActive = 0;
        this.FlasherFlag1 = 0;
        this.FlasherFlag2 = 0;
        render.sprite_set_bitmap(this.RenderSprite, this.Flasher.BmpArr[this.BmpIndex1]);
        break;
      case 15:
        this.TurnOffAfterFlashingFg = 0;
        if (this.Timer2) timer.kill(this.Timer2);
        this.Timer2 = 0;
        this.Message(1, 0);
        this.Message(7, value);
        break;
      case 16:
        if (this.Timer2) timer.kill(this.Timer2);
        this.Timer2 = 0;
        this.Message(7, value);
        this.TurnOffAfterFlashingFg = 1;
        break;
      case 17:
        this.Message(Math.floor(value) !== 0 ? 1 : 0, 0);
        return this.BmpIndex1;
      case 18:
        this.Message(17, value);
        this.Message(14, 0);
        return this.BmpIndex1;
      case 19:
        this.Message(1, 0);
        this.Message(14, 0);
        break;
      case 20:
        this.Message(0, 0);
        this.Message(14, 0);
        break;
      case 21:
        this.Message(17, this.BmpIndex1 === 0 ? 1 : 0);
        return this.BmpIndex1;
      case 22:
        this.Message(18, this.BmpIndex1 === 0 ? 1 : 0);
        return this.BmpIndex1;
      case 23:
        this.MessageField = Math.floor(value);
        break;
      default:
        break;
    }
    return 0;
  }

  savePlayer(player) {
    player.FlasherActive = this.FlasherActive;
    player.BmpIndex2 = this.BmpIndex2;
    player.BmpIndex1 = this.BmpIndex1;
    player.MessageField = this.MessageField;
  }

  Reset() {
    if (this.Timer1) timer.kill(this.Timer1);
    if (this.Timer2) timer.kill(this.Timer2);
    if (this.FlasherActive) TLight.flasher_stop(this.Flasher, -1);
    this.Timer1 = 0;
    this.Timer2 = 0;
    this.BmpIndex1 = 0;
    this.BmpIndex2 = 0;
    this.FlasherFlag1 = 0;
    this.FlasherFlag2 = 0;
    this.FlasherActive = 0;
    this.TurnOffAfterFlashingFg = 0;
    render.sprite_set_bitmap(this.RenderSprite, null);
    this.Flasher.Sprite = this.RenderSprite;
    this.Flasher.BmpArr[0] = null;
    if (this.ListBitmap) this.Flasher.BmpArr[1] = this.ListBitmap[0];
    this.MessageField = 0;
  }

  schedule_timeout(time) {
    this.Flasher.TimerDelay[0] = this.FlasherDelay[0];
    this.Flasher.TimerDelay[1] = this.FlasherDelay[1];
    if (this.Timer1) timer.kill(this.Timer1);
    this.Timer1 = 0;
    if (time > 0) this.Timer1 = timer.set(time, this, TLight.TimerExpired);
  }

  static TimerExpired(timerId, light) {
    if (light.FlasherActive) TLight.flasher_stop(light.Flasher, -1);
    render.sprite_set_bitmap(light.RenderSprite, light.Flasher.BmpArr[light.BmpIndex1]);
    light.FlasherFlag1 = 0;
    light.FlasherFlag2 = 0;
    light.FlasherActive = 0;
    light.Timer1 = 0;
    if (light.TurnOffAfterFlashingFg !== 0) {
      light.TurnOffAfterFlashingFg = 0;
      light.Message(20, 0);
    }
    if (light.Control) control.handler(60, light);
  }

  static flasher_stop(flash, bmpIndex) {
    if (flash.Timer) timer.kill(flash.Timer);
    flash.Timer = 0;
    if (bmpIndex >= 0) {
      flash.BmpIndex = bmpIndex;
      render.sprite_set_bitmap(flash.Sprite, flash.BmpArr[bmpIndex]);
    }
  }

  static flasher_start(flash, bmpIndex) {
    flash.BmpIndex = bmpIndex;
    TLight.flasher_callback(0, flash);
  }

  static flasher_callback(timerId, flash) {
    const index = 1 - flash.BmpIndex;
    flash.BmpIndex = index;
    render.sprite_set_bitmap(flash.Sprite, flash.BmpArr[index]);
    flash.Timer = timer.set(flash.TimerDelay[flash.BmpIndex], flash, TLight.flasher_callback);
  }
}

// ---------- TLightGroup / TLightBargraph ----------

export class TLightGroup extends TPinballComponent {
  constructor(table, groupIndex) {
    super(table, groupIndex, false);
    this.List = [];
    this.Timer1Time = 0;
    this.Timer1TimeDefault = 0;
    this.MessageField2 = 0;
    this.AnimationFlag = 0;
    this.Timer = 0;
    this.NotifyTimer = 0;
    this.PlayerData = Array.from({ length: 4 }, () => ({ MessageField: 0, MessageField2: 0, Timer1Time: 0 }));
    TLightGroup.prototype.Reset.call(this);
    if (groupIndex > 0) {
      this.Timer1TimeDefault = loader.query_float_attribute(groupIndex, 0, 903)[0];
      const { arr, size } = loader.query_iattribute(groupIndex, 1027);
      for (let index = 0; index < size; ++index) {
        const comp = table.find_component(arr[index]);
        if (comp instanceof TLight) this.List.push(comp);
      }
    }
  }

  Message(code, value) {
    const count = this.List.length;
    const last = () => this.List[count - 1];
    switch (code) {
      case 1011:
      case 1022:
        break;
      case 1020: {
        let player = this.PlayerData[this.PinballTable.CurrentPlayer];
        player.MessageField = this.MessageField;
        player.MessageField2 = this.MessageField2;
        player.Timer1Time = this.Timer1Time;
        this.Reset();
        player = this.PlayerData[Math.floor(value)];
        this.MessageField = player.MessageField;
        this.MessageField2 = player.MessageField2;
        this.Timer1Time = player.Timer1Time;
        if (this.MessageField !== 0) TLightGroup.TimerExpired(0, this);
        break;
      }
      case 1024:
        this.Reset();
        for (let index = 0; index < this.PinballTable.PlayerCount; index++) {
          const player = this.PlayerData[index];
          player.MessageField = this.MessageField;
          player.MessageField2 = this.MessageField2;
          player.Timer1Time = this.Timer1Time;
        }
        break;
      case 24: {
        const lastLight = last();
        if (lastLight.FlasherActive || lastLight.FlasherFlag2 || lastLight.FlasherFlag1) break;
        if (this.MessageField2) TLightGroup.prototype.Message.call(this, 34, 0);
        this.AnimationFlag = 1;
        this.MessageField2 = code;
        const lightMessageField = lastLight.MessageField;
        const bmpIndex1 = lastLight.BmpIndex1;
        for (let index = count - 1; index > 0; --index) {
          const cur = this.List[index];
          const prev = this.List[index - 1];
          cur.Message(prev.BmpIndex1 !== 0 ? 1 : 0, 0);
          cur.MessageField = prev.MessageField;
        }
        const first = this.List[0];
        first.Message(bmpIndex1 !== 0 ? 1 : 0, 0);
        first.MessageField = lightMessageField;
        this.reschedule_animation(value);
        break;
      }
      case 25: {
        const lastLight = last();
        if (lastLight.FlasherActive || lastLight.FlasherFlag2 || lastLight.FlasherFlag1) break;
        if (this.MessageField2) TLightGroup.prototype.Message.call(this, 34, 0);
        const first = this.List[0];
        this.AnimationFlag = 1;
        this.MessageField2 = code;
        const lightMessageField = first.MessageField;
        const bmpIndex1 = first.BmpIndex1;
        for (let index = 0; index < count - 1; index++) {
          const cur = this.List[index];
          const next = this.List[index + 1];
          cur.Message(next.BmpIndex1 !== 0 ? 1 : 0, 0);
          cur.MessageField = next.MessageField;
        }
        lastLight.Message(bmpIndex1 !== 0 ? 1 : 0, 0);
        lastLight.MessageField = lightMessageField;
        this.reschedule_animation(value);
        break;
      }
      case 26: {
        if (this.AnimationFlag || !this.MessageField2) this.start_animation();
        this.MessageField2 = code;
        this.AnimationFlag = 0;
        const flasherFlag2 = last().FlasherFlag2;
        for (let i = count - 1; i > 0; --i) this.List[i].Message((this.List[i - 1].FlasherFlag2 !== 0 ? 1 : 0) + 8, 0);
        this.List[0].Message((flasherFlag2 !== 0 ? 1 : 0) + 8, 0);
        this.reschedule_animation(value);
        break;
      }
      case 27: {
        if (this.AnimationFlag || !this.MessageField2) this.start_animation();
        this.MessageField2 = code;
        this.AnimationFlag = 0;
        const flasherFlag2 = this.List[0].FlasherFlag2;
        for (let i = 0; i < count - 1; i++) this.List[i].Message((this.List[i + 1].FlasherFlag2 !== 0 ? 1 : 0) + 8, 0);
        last().Message((flasherFlag2 !== 0 ? 1 : 0) + 8, 0);
        this.reschedule_animation(value);
        break;
      }
      case 28:
        if (this.AnimationFlag || !this.MessageField2) this.start_animation();
        this.MessageField2 = code;
        this.AnimationFlag = 0;
        for (const light of this.List) {
          if (crand() % 100 > 70) light.Message(9, RandFloat() * value * 3 + 0.1);
        }
        this.reschedule_animation(value);
        break;
      case 29:
        if (this.AnimationFlag || !this.MessageField2) this.start_animation();
        this.MessageField2 = code;
        this.AnimationFlag = 0;
        for (const light of this.List) light.Message(18, crand() % 100 > 70 ? 1 : 0);
        this.reschedule_animation(value);
        break;
      case 30: {
        const offCount = this.List.filter(l => !l.BmpIndex1).length;
        if (!offCount) break;
        let randModCount = crand() % offCount;
        for (let i = count - 1; i >= 0; i--) {
          const light = this.List[i];
          if (!light.BmpIndex1 && randModCount-- === 0) {
            light.Message(1, 0);
            break;
          }
        }
        if (this.MessageField2) this.start_animation();
        break;
      }
      case 31: {
        const onCount = this.List.filter(l => l.BmpIndex1).length;
        if (!onCount) break;
        let randModCount = crand() % onCount;
        for (let i = count - 1; i >= 0; i--) {
          const light = this.List[i];
          if (light.BmpIndex1 && randModCount-- === 0) {
            light.Message(0, 0);
            break;
          }
        }
        if (this.MessageField2) this.start_animation();
        break;
      }
      case 32: {
        const index = this.next_light_up();
        if (index < 0) break;
        this.List[index].Message(1, 0);
        if (this.MessageField2) this.start_animation();
        return 1;
      }
      case 33: {
        const index = this.next_light_down();
        if (index < 0) break;
        this.List[index].Message(0, 0);
        if (this.MessageField2) this.start_animation();
        return 1;
      }
      case 34:
        if (this.Timer) timer.kill(this.Timer);
        this.Timer = 0;
        if (this.MessageField2 === 26 || this.MessageField2 === 27 || this.MessageField2 === 28) TLightGroup.prototype.Message.call(this, 14, 0);
        this.MessageField2 = 0;
        this.AnimationFlag = 0;
        break;
      case 35: {
        const index = Math.floor(value);
        if (index >= count || index < 0) break;
        this.List[index].Message(1, 0);
        if (this.MessageField2) this.start_animation();
        break;
      }
      case 36: {
        const index = Math.floor(value);
        if (index >= count || index < 0) break;
        this.List[index].Message(0, 0);
        if (this.MessageField2) this.start_animation();
        break;
      }
      case 37:
        return this.List.filter(l => l.BmpIndex1).length;
      case 38:
        return count;
      case 39:
        return this.MessageField2;
      case 40:
        return this.AnimationFlag;
      case 41: {
        const index = this.next_light_up();
        if (index < 0) break;
        if (this.MessageField2 || this.AnimationFlag) TLightGroup.prototype.Message.call(this, 34, 0);
        this.List[index].Message(15, value);
        return 1;
      }
      case 42: {
        const index = this.next_light_down();
        if (index < 0) break;
        if (this.MessageField2 || this.AnimationFlag) TLightGroup.prototype.Message.call(this, 34, 0);
        this.List[index].Message(16, value);
        return 1;
      }
      case 43:
        if (this.NotifyTimer) timer.kill(this.NotifyTimer);
        this.NotifyTimer = 0;
        if (value > 0) this.NotifyTimer = timer.set(value, this, TLightGroup.NotifyTimerExpired);
        break;
      case 44:
        for (let i = count - 1; i >= 0; i--) {
          const light = this.List[i];
          if (light.BmpIndex1) {
            light.Message(0, 0);
            light.Message(16, value);
          }
        }
        break;
      case 45: {
        control.handler(code, this);
        const index = Math.floor(value);
        if (index >= 0 && index < count) {
          for (let i = count - 1; i > index; i--) this.List[i].Message(20, 0);
          for (let i = index; i >= 0; i--) this.List[i].Message(19, 0);
        }
        break;
      }
      case 46: {
        const index = this.next_light_down();
        if (index >= 0) this.List[index].Message(4, 0);
        break;
      }
      default:
        for (let i = count - 1; i >= 0; i--) this.List[i].Message(code, value);
        break;
    }
    return 0;
  }

  Reset() {
    if (this.Timer) timer.kill(this.Timer);
    this.Timer = 0;
    if (this.NotifyTimer) timer.kill(this.NotifyTimer);
    this.NotifyTimer = 0;
    this.MessageField2 = 0;
    this.AnimationFlag = 0;
    this.Timer1Time = this.Timer1TimeDefault;
  }

  reschedule_animation(time) {
    if (this.Timer) timer.kill(this.Timer);
    this.Timer = 0;
    if (time === 0) {
      this.MessageField2 = 0;
      this.AnimationFlag = 0;
      return;
    }
    this.Timer1Time = time > 0 ? time : this.Timer1TimeDefault;
    this.Timer = timer.set(this.Timer1Time, this, TLightGroup.TimerExpired);
  }

  start_animation() {
    for (let i = this.List.length - 1; i >= 0; i--) {
      const light = this.List[i];
      light.Message(light.BmpIndex1 ? 9 : 8, 0);
    }
  }

  next_light_up() {
    return this.List.findIndex(l => !l.BmpIndex1);
  }

  next_light_down() {
    for (let index = this.List.length - 1; index >= 0; --index) {
      if (this.List[index].BmpIndex1) return index;
    }
    return -1;
  }

  static TimerExpired(timerId, group) {
    group.Timer = 0;
    group.Message(group.MessageField2, group.Timer1Time);
  }

  static NotifyTimerExpired(timerId, group) {
    group.NotifyTimer = 0;
    control.handler(61, group);
  }
}

export class TLightBargraph extends TLightGroup {
  constructor(table, groupIndex) {
    super(table, groupIndex);
    this.TimerTimeArray = null;
    this.TimerBargraph = 0;
    this.TimeIndex = 0;
    this.PlayerTimerIndexBackup = [0, 0, 0, 0];
    this.Reset();
    if (groupIndex > 0) {
      const floatArr = loader.query_float_attribute(groupIndex, 0, 904);
      if (floatArr) this.TimerTimeArray = Array.from(floatArr.subarray(0, 2 * this.List.length));
    }
  }

  Message(code, value) {
    switch (code) {
      case 37:
        return this.TimeIndex;
      case 45: {
        if (this.TimerBargraph) {
          timer.kill(this.TimerBargraph);
          this.TimerBargraph = 0;
        }
        let timeIndex = Math.floor(value);
        const maxCount = this.List.length * 2;
        if (timeIndex >= maxCount) timeIndex = maxCount - 1;
        if (timeIndex >= 0) {
          super.Message(45, Math.trunc(timeIndex / 2));
          if (!(timeIndex & 1)) super.Message(46, 0);
          if (this.TimerTimeArray) this.TimerBargraph = timer.set(this.TimerTimeArray[timeIndex], this, TLightBargraph.BargraphTimerExpired);
          this.TimeIndex = timeIndex;
        } else {
          super.Message(20, 0);
          this.TimeIndex = 0;
        }
        break;
      }
      case 1011:
        this.Reset();
        break;
      case 1020:
        if (this.TimerBargraph) {
          timer.kill(this.TimerBargraph);
          this.TimerBargraph = 0;
        }
        this.PlayerTimerIndexBackup[this.PinballTable.CurrentPlayer] = this.TimeIndex;
        this.Reset();
        this.TimeIndex = this.PlayerTimerIndexBackup[Math.floor(value)];
        if (this.TimeIndex) this.Message(45, this.TimeIndex);
        break;
      case 1024:
        this.Reset();
        for (let index = 0; index < this.PinballTable.PlayerCount; ++index) this.PlayerTimerIndexBackup[index] = this.TimeIndex;
        super.Message(1024, value);
        break;
      default:
        super.Message(code, value);
        break;
    }
    return 0;
  }

  Reset() {
    if (this.TimerBargraph) {
      timer.kill(this.TimerBargraph);
      this.TimerBargraph = 0;
    }
    this.TimeIndex = 0;
    super.Reset();
  }

  static BargraphTimerExpired(timerId, bar) {
    bar.TimerBargraph = 0;
    if (bar.TimeIndex) {
      bar.Message(45, bar.TimeIndex - 1);
      control.handler(60, bar);
    } else {
      bar.Message(20, 0);
      control.handler(47, bar);
    }
  }
}

// ---------- TComponentGroup / TTimer / TSound ----------

export class TComponentGroup extends TPinballComponent {
  constructor(table, groupIndex) {
    super(table, groupIndex, false);
    this.Timer = 0;
    this.List = [];
    if (groupIndex > 0) {
      const { arr, size } = loader.query_iattribute(groupIndex, 1027);
      for (let index = 0; index < size; ++index) {
        const component = table.find_component(arr[index]);
        if (component) this.List.push(component);
      }
    }
  }

  Message(code, value) {
    if (code === 48) {
      if (this.Timer) {
        timer.kill(this.Timer);
        this.Timer = 0;
      }
      if (value > 0) this.Timer = timer.set(value, this, TComponentGroup.NotifyTimerExpired);
    } else if (code <= 1007 || (code > 1011 && code !== 1020 && code !== 1022)) {
      for (const component of this.List) component.Message(code, value);
    }
    return 0;
  }

  static NotifyTimerExpired(timerId, group) {
    group.Timer = 0;
    control.handler(61, group);
  }
}

export class TTimer extends TPinballComponent {
  constructor(table, groupIndex) {
    super(table, groupIndex, true);
    this.Timer = 0;
  }

  Message(code, value) {
    if (code === 59) {
      if (this.Timer) timer.kill(this.Timer);
      this.Timer = timer.set(value, this, TTimer.TimerExpired);
    } else if ((code === 1011 || code === 1022 || code === 1024) && this.Timer) {
      timer.kill(this.Timer);
      this.Timer = 0;
    }
    return 0;
  }

  static TimerExpired(timerId, t) {
    t.Timer = 0;
    control.handler(60, t);
  }
}

export class TSound extends TPinballComponent {
  constructor(table, groupIndex) {
    super(table, groupIndex, true);
    const visual = newVisual();
    loader.query_visual(groupIndex, 0, visual);
    this.SoundIndex = visual.SoundIndex4;
  }

  // Sound is not implemented; returns the clip duration used for timing.
  Play() {
    return loader.play_sound(this.SoundIndex);
  }
}

// ---------- TTextBox ----------

// Drawing of text when no bitmap font is available (gdrv::grtext_draw_ttext_in_box);
// installed by the host page.
export const textFallback = { draw: null };

export class TTextBox extends TPinballComponent {
  constructor(table, groupIndex) {
    super(table, groupIndex, true);
    this.OffsetX = 0;
    this.OffsetY = 0;
    this.Width = 0;
    this.Height = 0;
    this.BgBmp = render.background_bitmap;
    this.Font = score.msg_fontp;
    this.Message1 = null;
    this.Message2 = null;
    this.Timer = 0;
    if (groupIndex > 0) {
      const { arr } = loader.query_iattribute(groupIndex, 1500);
      this.OffsetX = arr[0];
      this.OffsetY = arr[1];
      this.Width = arr[2];
      this.Height = arr[3];
    }
  }

  Message(code, value) {
    return 0;
  }

  static TimerExpired(timerId, tb) {
    const message = tb.Message1;
    tb.Timer = 0;
    if (message) {
      tb.Message1 = message.NextMessage;
      tb.Draw();
      control.handler(60, tb);
    }
  }

  clearArea() {
    if (this.BgBmp) copy_bitmap(render.vscreen, this.Width, this.Height, this.OffsetX, this.OffsetY, this.BgBmp, this.OffsetX, this.OffsetY);
    else fill_bitmap(render.vscreen, this.Width, this.Height, this.OffsetX, this.OffsetY, 0);
  }

  Clear() {
    this.clearArea();
    if (this.Timer) {
      if (this.Timer !== -1) timer.kill(this.Timer);
      this.Timer = 0;
    }
    this.Message1 = null;
    this.Message2 = null;
  }

  Display(text, time) {
    if (text === null || text === undefined) return;
    if (this.Message1 && text === this.Message2.Text) {
      this.Message2.Refresh(time);
      if (this.Message2 === this.Message1) {
        if (this.Timer && this.Timer !== -1) timer.kill(this.Timer);
        if (time === -1) this.Timer = -1;
        else this.Timer = timer.set(time, this, TTextBox.TimerExpired);
      }
    } else {
      if (this.Timer === -1) this.Clear();
      const message = new TTextBoxMessage(text, time);
      if (this.Message1) this.Message2.NextMessage = message;
      else this.Message1 = message;
      this.Message2 = message;
      if (this.Timer === 0) this.Draw();
    }
  }

  Draw() {
    this.clearArea();
    let display = false;
    while (this.Message1) {
      if (this.Message1.Time === -1) {
        if (!this.Message1.NextMessage) {
          this.Timer = -1;
          display = true;
          break;
        }
      } else if (this.Message1.TimeLeft() >= -2) {
        this.Timer = timer.set(Math.max(this.Message1.TimeLeft(), 0.25), this, TTextBox.TimerExpired);
        display = true;
        break;
      }
      this.Message1 = this.Message1.NextMessage;
    }
    if (!this.Message1) this.Message2 = null;
    if (!display) return;

    const font = this.Font;
    if (!font) {
      textFallback.draw?.(this.Message1.Text, this.OffsetX, this.OffsetY, this.Width, this.Height);
      return;
    }

    const text = this.Message1.Text;
    const lines = [];
    let textHeight = 0;
    for (let start = 0; ; textHeight += font.Height) {
      if (start >= text.length || textHeight + font.Height > this.Height) break;
      const line = this.LayoutTextLine(text, start);
      if (line.start === line.end) break;
      lines.push(line);
      start = line.end;
    }

    let offY = this.OffsetY;
    for (const line of lines) {
      let offX = this.OffsetX;
      for (let i = line.start; i < line.end; i++) {
        const charBmp = font.Chars[text.charCodeAt(i) & 0x7f];
        if (charBmp) {
          if (render.background_bitmap) copy_bitmap_w_transparency(render.vscreen, charBmp.Width, charBmp.Height, offX, offY, charBmp, 0, 0);
          else copy_bitmap(render.vscreen, charBmp.Width, charBmp.Height, offX, offY, charBmp, 0, 0);
          offX += charBmp.Width + font.GapWidth;
        }
      }
      offY += font.Height;
    }
  }

  LayoutTextLine(text, start) {
    const font = this.Font;
    let lineWidth = 0;
    let wordWidth = 0;
    let wordBoundary = -1;
    let end = start;
    for (; ; ++end) {
      const masked = end < text.length ? text.charCodeAt(end) & 0x7f : 0;
      if (!masked || masked === 10) break;
      const charBmp = font.Chars[masked];
      if (!charBmp) continue;
      const width = lineWidth + charBmp.Width + font.GapWidth;
      if (width > this.Width) {
        if (wordBoundary >= 0) {
          end = wordBoundary;
          lineWidth = wordWidth;
        }
        break;
      }
      if (masked === 32) {
        wordBoundary = end;
        wordWidth = width;
      }
      lineWidth = width;
    }
    const at = i => (i < text.length ? text.charCodeAt(i) & 0x7f : 0);
    while (at(end) === 32) ++end;
    if (at(end) === 10) ++end;
    return { start, end, width: lineWidth };
  }
}

class TTextBoxMessage {
  constructor(text, time) {
    this.NextMessage = null;
    this.Time = time;
    this.EndTicks = pb.time_ticks + Math.trunc(time * 1000);
    this.Text = text;
  }

  TimeLeft() {
    return (this.EndTicks - pb.time_ticks) * 0.001;
  }

  Refresh(time) {
    this.Time = time;
    this.EndTicks = pb.time_ticks + Math.trunc(time * 1000);
  }
}

// ---------- TPinballTable ----------

const score_multipliers = [1, 2, 3, 5, 10];

export class TPinballTable extends TPinballComponent {
  constructor() {
    super(null, -1, false);
    this.ComponentList = [];
    this.BallList = [];
    this.CurScoreStruct = null;
    this.ScoreBallcount = null;
    this.ScorePlayerNumber1 = null;
    this.CheatsUsed = 0;
    this.SoundIndex1 = 0;
    this.SoundIndex2 = 0;
    this.SoundIndex3 = 0;
    this.BallInSink = 0;
    this.CurScore = 0;
    this.CurScoreE9 = 0;
    this.ActiveFlag = 1;
    this.TiltLockFlag = 0;
    this.EndGameTimeoutTimer = 0;
    this.LightShowTimer = 0;
    this.ReplayTimer = 0;
    this.TiltTimeoutTimer = 0;
    this.MultiballFlag = 0;
    this.PlayerCount = 0;
    this.Demo = null;
    this.Plunger = null;
    this.Drain = null;
    this.FlipperL = null;
    this.FlipperR = null;
    this.XOffset = 0;
    this.YOffset = 0;
    this.Width = 0;
    this.Height = 0;
    this.GravityDirVectMult = 0;
    this.GravityAngleX = 0;
    this.GravityAnglY = 0;
    this.CollisionCompOffset = 0;
    this.PlungerPositionX = 0;
    this.PlungerPositionY = 0;
    this.ScoreMultiplier = 0;
    this.ScoreAdded = 0;
    this.ScoreSpecial1 = 0;
    this.ScoreSpecial2 = 0;
    this.ScoreSpecial2Flag = 0;
    this.ScoreSpecial3 = 0;
    this.ScoreSpecial3Flag = 0;
    this.UnknownP71 = 0;
    this.BallCount = 0;
    this.ExtraBalls = 0;
    this.UnknownP75 = 0;
    this.BallLockedCounter = 0;
    this.UnknownP78 = 0;
    this.ReplayActiveFlag = 0;
    this.PlayerScores = Array.from({ length: 4 }, () => ({
      ScoreStruct: null, Score: 0, ScoreE9Part: 0, Unknown2: 0, BallCount: 0, ExtraBalls: 0, BallLockedCounter: 0,
    }));

    const ball = new TBall(this);
    this.BallList.push(ball);
    ball.ActiveFlag = 0;
    new TTableLayer(this);
    this.LightGroup = new TLightGroup(this, 0);

    const score1 = score.create('score1', render.background_bitmap);
    this.CurScoreStruct = score1;
    this.PlayerScores[0].ScoreStruct = score1;
    for (let scoreIndex = 1; scoreIndex < 4; scoreIndex++) this.PlayerScores[scoreIndex].ScoreStruct = score.dup(score1);

    this.CurrentPlayer = 0;
    this.MaxBallCount = 3;
    this.ScoreBallcount = score.create('ballcount1', render.background_bitmap);
    this.ScorePlayerNumber1 = score.create('player_number1', render.background_bitmap);

    const groupIndexObjects = loader.query_handle('table_objects');
    const { arr, size } = loader.query_iattribute(groupIndexObjects, 1025);
    for (let i = 0, p = 0; i < Math.trunc(size / 2); ++i, p += 2) {
      const objectType = arr[p];
      const groupIndex = arr[p + 1];
      switch (objectType) {
        case 1000:
        case 1010: new TWall(this, groupIndex); break;
        case 1001: this.Plunger = new TPlunger(this, groupIndex); break;
        case 1002: this.LightGroup.List.push(new TLight(this, groupIndex)); break;
        case 1003: this.FlipperL = new TFlipper(this, groupIndex); break;
        case 1004: this.FlipperR = new TFlipper(this, groupIndex); break;
        case 1005: new TBumper(this, groupIndex); break;
        case 1006: new TPopupTarget(this, groupIndex); break;
        case 1007: this.Drain = new TDrain(this, groupIndex); break;
        case 1011: new TBlocker(this, groupIndex); break;
        case 1012: new TKickout(this, groupIndex, true); break;
        case 1013: new TGate(this, groupIndex); break;
        case 1014: new TKickback(this, groupIndex); break;
        case 1015: new TRollover(this, groupIndex); break;
        case 1016: new TOneway(this, groupIndex); break;
        case 1017: new TSink(this, groupIndex); break;
        case 1018: new TFlagSpinner(this, groupIndex); break;
        case 1019: new TSoloTarget(this, groupIndex); break;
        case 1020: new TLightRollover(this, groupIndex); break;
        case 1021: new TRamp(this, groupIndex); break;
        case 1022: new THole(this, groupIndex); break;
        case 1023: new TDemo(this, groupIndex); break;
        case 1024: new TTripwire(this, groupIndex); break;
        case 1026: new TLightGroup(this, groupIndex); break;
        case 1028: new TComponentGroup(this, groupIndex); break;
        case 1029: new TKickout(this, groupIndex, false); break;
        case 1030: new TLightBargraph(this, groupIndex); break;
        case 1031: new TSound(this, groupIndex); break;
        case 1032: new TTimer(this, groupIndex); break;
        case 1033: new TTextBox(this, groupIndex); break;
        default: break;
      }
    }

    render.build_occlude_list();
    pinball.InfoTextBox = this.find_component('info_text_box');
    pinball.MissTextBox = this.find_component('mission_text_box');
    control.make_links(this);
  }

  find_component(nameOrIndex) {
    if (typeof nameOrIndex === 'string') return this.ComponentList.find(c => c.GroupName === nameOrIndex) ?? null;
    return this.ComponentList.find(c => c.GroupIndex === nameOrIndex) ?? null;
  }

  AddScore(value) {
    if (this.ScoreSpecial3Flag) {
      this.ScoreSpecial3 += value;
      if (this.ScoreSpecial3 > 5000000) this.ScoreSpecial3 = 5000000;
    }
    if (this.ScoreSpecial2Flag) {
      this.ScoreSpecial2 += value;
      if (this.ScoreSpecial2 > 5000000) this.ScoreSpecial2 = 5000000;
    }
    const addedScore = this.ScoreAdded + value * score_multipliers[this.ScoreMultiplier];
    this.CurScore += addedScore;
    if (this.CurScore > 1000000000) {
      ++this.CurScoreE9;
      this.CurScore -= 1000000000;
    }
    score.set(this.CurScoreStruct, this.CurScore);
    return addedScore;
  }

  ChangeBallCount(count) {
    this.BallCount = count;
    if (count <= 0) {
      score.erase(this.ScoreBallcount);
    } else {
      score.set(this.ScoreBallcount, this.MaxBallCount - count + 1);
      score.update(this.ScoreBallcount);
    }
  }

  tilt(time) {
    if (!this.TiltLockFlag && !this.BallInSink) {
      pinball.InfoTextBox.Clear();
      pinball.MissTextBox.Clear();
      pinball.InfoTextBox.Display(get_rc_string(35), -1);
      loader.play_sound(this.SoundIndex3);
      this.TiltTimeoutTimer = timer.set(30, this, TPinballTable.tilt_timeout);
      for (const component of this.ComponentList) component.Message(1011, time);
      this.LightGroup.Message(8, 0);
      this.TiltLockFlag = 1;
      control.table_control_handler(1011);
    }
  }

  port_draw() {
    for (const component of this.ComponentList) component.port_draw();
  }

  Message(code, value) {
    switch (code) {
      case 1000:
        if (!this.TiltLockFlag) this.FlipperL.Message(1, value);
        break;
      case 1001:
        if (!this.TiltLockFlag) this.FlipperL.Message(2, value);
        break;
      case 1002:
        if (!this.TiltLockFlag) this.FlipperR.Message(1, value);
        break;
      case 1003:
        if (!this.TiltLockFlag) this.FlipperR.Message(2, value);
        break;
      case 1004:
      case 1005:
        this.Plunger.Message(code, value);
        break;
      case 1008:
      case 1009:
      case 1010:
        for (const component of this.ComponentList) component.Message(code, value);
        break;
      case 1012:
        this.LightGroup.Message(14, 0);
        if (this.TiltLockFlag) {
          this.TiltLockFlag = 0;
          if (this.TiltTimeoutTimer) timer.kill(this.TiltTimeoutTimer);
          this.TiltTimeoutTimer = 0;
        }
        break;
      case 1013:
        this.LightGroup.Message(34, 0);
        this.LightGroup.Message(20, 0);
        this.Plunger.Message(1016, 0);
        pinball.InfoTextBox.Display(get_rc_string(this.Demo && this.Demo.ActiveFlag ? 30 : 26), -1);
        if (this.Demo) this.Demo.Message(1014, 0);
        break;
      case 1014:
        if (this.EndGameTimeoutTimer) {
          timer.kill(this.EndGameTimeoutTimer);
          TPinballTable.EndGame_timeout(0, this);
          pb.mode_change(1);
        }
        if (this.LightShowTimer) {
          timer.kill(this.LightShowTimer);
          this.LightShowTimer = 0;
          this.Message(1013, 0);
        } else {
          this.CheatsUsed = 0;
          this.Message(1024, 0);
          const ball = this.BallList[0];
          ball.Position.Y = 0;
          ball.Position.X = 0;
          ball.Position.Z = -0.8;

          const playerCount = Math.floor(value);
          this.PlayerCount = playerCount >= 1 ? Math.min(playerCount, 4) : 1;

          const plr1Score = this.PlayerScores[0].ScoreStruct;
          this.CurrentPlayer = 0;
          this.CurScoreStruct = plr1Score;
          this.CurScore = 0;
          score.set(plr1Score, 0);
          this.ScoreMultiplier = 0;

          for (let plrIndex = 1; plrIndex < this.PlayerCount; ++plrIndex) {
            const s = this.PlayerScores[plrIndex];
            score.set(s.ScoreStruct, 0);
            s.Score = 0;
            s.ScoreE9Part = 0;
            s.BallCount = this.MaxBallCount;
            s.ExtraBalls = this.ExtraBalls;
            s.BallLockedCounter = this.BallLockedCounter;
            s.Unknown2 = this.ScoreSpecial3;
          }

          this.BallCount = this.MaxBallCount;
          this.ChangeBallCount(this.BallCount);
          score.set(this.ScorePlayerNumber1, this.CurrentPlayer + 1);
          score.update(this.ScorePlayerNumber1);

          for (let scoreIndex = 4 - this.PlayerCount; scoreIndex > 0; scoreIndex--) score.set(this.PlayerScores[scoreIndex].ScoreStruct, -1);

          this.ScoreSpecial3Flag = 0;
          this.ScoreSpecial2Flag = 0;
          this.UnknownP71 = 0;
          pinball.InfoTextBox.Clear();
          pinball.MissTextBox.Clear();
          this.LightGroup.Message(28, 0.2);
          const time = loader.play_sound(this.SoundIndex1);
          this.LightShowTimer = timer.set(time, this, TPinballTable.LightShow_timeout);
        }
        break;
      case 1018:
        if (this.ReplayTimer) timer.kill(this.ReplayTimer);
        this.ReplayTimer = timer.set(Math.floor(value), this, TPinballTable.replay_timer_callback);
        this.ReplayActiveFlag = 1;
        break;
      case 1021: {
        if (this.PlayerCount <= 1) {
          pinball.InfoTextBox.Display(get_rc_string(this.Demo.ActiveFlag ? 30 : 26), -1);
          break;
        }
        const nextPlayer = (this.CurrentPlayer + 1) % this.PlayerCount;
        const next = this.PlayerScores[nextPlayer];
        if (next.BallCount <= 0) break;

        const cur = this.PlayerScores[this.CurrentPlayer];
        cur.Score = this.CurScore;
        cur.ScoreE9Part = this.CurScoreE9;
        cur.BallCount = this.BallCount;
        cur.ExtraBalls = this.ExtraBalls;
        cur.BallLockedCounter = this.BallLockedCounter;
        cur.Unknown2 = this.ScoreSpecial3;

        this.CurScore = next.Score;
        this.CurScoreE9 = next.ScoreE9Part;
        this.BallCount = next.BallCount;
        this.ExtraBalls = next.ExtraBalls;
        this.BallLockedCounter = next.BallLockedCounter;
        this.ScoreSpecial3 = next.Unknown2;

        this.CurScoreStruct = next.ScoreStruct;
        score.set(this.CurScoreStruct, this.CurScore);
        this.CurScoreStruct.DirtyFlag = true;

        this.ChangeBallCount(this.BallCount);
        score.set(this.ScorePlayerNumber1, nextPlayer + 1);
        score.update(this.ScorePlayerNumber1);

        for (const component of this.ComponentList) component.Message(1020, nextPlayer);

        const textIds = this.Demo.ActiveFlag ? [30, 31, 32, 33] : [26, 27, 28, 29];
        pinball.InfoTextBox.Display(get_rc_string(textIds[nextPlayer]), -1);
        this.ScoreSpecial3Flag = 0;
        this.ScoreSpecial2Flag = 0;
        this.UnknownP71 = 0;
        this.CurrentPlayer = nextPlayer;
        break;
      }
      case 1022:
        loader.play_sound(this.SoundIndex2);
        pinball.MissTextBox.Clear();
        pinball.InfoTextBox.Display(get_rc_string(34), -1);
        this.EndGameTimeoutTimer = timer.set(3, this, TPinballTable.EndGame_timeout);
        break;
      case 1024:
        for (const component of this.ComponentList) component.Message(1024, 0);
        if (this.ReplayTimer) timer.kill(this.ReplayTimer);
        this.ReplayTimer = 0;
        if (this.LightShowTimer) {
          timer.kill(this.LightShowTimer);
          this.LightGroup.Message(34, 0);
        }
        this.LightShowTimer = 0;
        this.ScoreMultiplier = 0;
        this.ScoreAdded = 0;
        this.ScoreSpecial1 = 0;
        this.ScoreSpecial2 = 10000;
        this.ScoreSpecial2Flag = 0;
        this.ScoreSpecial3 = 20000;
        this.ScoreSpecial3Flag = 0;
        this.UnknownP71 = 0;
        this.ExtraBalls = 0;
        this.UnknownP75 = 0;
        this.BallLockedCounter = 0;
        this.MultiballFlag = 0;
        this.UnknownP78 = 0;
        this.ReplayActiveFlag = 0;
        this.ReplayTimer = 0;
        this.TiltLockFlag = 0;
        break;
      default:
        break;
    }
    control.table_control_handler(code);
    return 0;
  }

  static EndGame_timeout(timerId, table) {
    table.EndGameTimeoutTimer = 0;
    pb.end_game();
    for (const component of table.ComponentList) component.Message(1022, 0);
    if (table.Demo) table.Demo.Message(1022, 0);
    control.handler(67, pinball.MissTextBox);
    pinball.InfoTextBox.Display(get_rc_string(24), -1);
  }

  static LightShow_timeout(timerId, table) {
    table.LightShowTimer = 0;
    table.Message(1013, 0);
  }

  static replay_timer_callback(timerId, table) {
    table.ReplayActiveFlag = 0;
    table.ReplayTimer = 0;
  }

  static tilt_timeout(timerId, table) {
    const v = vec();
    table.TiltTimeoutTimer = 0;
    if (table.TiltLockFlag) {
      for (const ball of table.BallList) table.Drain.Collision(ball, v, v, 0, null);
    }
  }
}
