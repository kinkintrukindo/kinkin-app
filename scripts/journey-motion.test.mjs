import test from 'node:test';
import assert from 'node:assert/strict';
import { createJourneyMotion } from '../src/landing/journey-motion.mjs';

test('upward travel completes a forward U-turn before returning toward the warehouse', () => {
  const motion = createJourneyMotion(300);
  const start = motion.update(.6, 1 / 60);
  let pose = motion.update(.3, 1 / 60);
  let turningFrames = 0;
  let hasReturned = false;
  let previous = start;
  for (let i = 0; i < 300; i++) {
    pose = motion.update(.3, 1 / 60);
    assert.ok(pose.distance >= previous.distance);
    if (pose.heading > 0 && pose.heading < Math.PI - 1e-9) {
      turningFrames++;
      assert.equal(pose.progress, start.progress);
      assert.ok(Math.abs(pose.forward) <= 2.00001);
      assert.ok(Math.abs(pose.lateral) <= 2.00001);
    }
    if (pose.progress < previous.progress) {
      hasReturned = true;
      assert.ok(Math.cos(pose.heading) < -.99, 'cab must face the warehouse before returning');
    }
    previous = pose;
  }
  assert.ok(turningFrames > 30);
  assert.ok(hasReturned);
  assert.ok(Math.abs(pose.progress - .3) < .0001);
  assert.equal(pose.lateral, -2);
});

test('rapid scroll reversals finish each turn continuously and settle facing the final destination', () => {
  const motion = createJourneyMotion(300);
  let pose = motion.update(.6, 1 / 60);
  let previous = pose;
  for (let i = 0; i < 500; i++) {
    const target = i < 12 ? .2 : .9;
    pose = motion.update(target, 1 / 60);
    assert.ok(Math.abs(pose.heading - previous.heading) < .051);
    const step = pose.progress - previous.progress;
    if (Math.abs(step) > 1e-10) assert.ok(step * Math.cos(pose.heading) > 0);
    previous = pose;
  }
  assert.ok(Math.abs(pose.progress - .9) < .0001);
  assert.ok(Math.cos(pose.heading) > .99);
  assert.equal(motion.active, false);
});

test('reduced motion faces the travel direction immediately without an animated turn', () => {
  const motion = createJourneyMotion(300);
  motion.update(.8, 1 / 60, true);
  const pose = motion.update(0, 1 / 60, true);
  assert.equal(pose.progress, 0);
  assert.equal(pose.heading, Math.PI);
  assert.equal(pose.forward, 0);
  assert.equal(motion.active, false);
});
