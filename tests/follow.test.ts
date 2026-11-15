import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Follower } from '../src/client/three/follow';

// The drawn hero follows the rules' hero, who starts and stops at full speed at once.
// Run at 60 frames a second for a hero running 5.6 m/s.

const SPEED = 5.6;
const DT = 1 / 60;

function run(seconds: number, moving: (t: number) => boolean) {
  const body = new Follower();
  const target = new THREE.Vector3();
  const vel = new THREE.Vector3();
  body.reset(target);
  const frames: { t: number; speed: number; lag: number; target: THREE.Vector3; body: THREE.Vector3 }[] = [];
  for (let t = 0; t < seconds; t += DT) {
    vel.set(moving(t) ? SPEED : 0, 0, 0);
    target.addScaledVector(vel, DT);
    body.update(target, vel, DT);
    frames.push({ t, speed: body.speed, lag: target.x - body.position.x, target: target.clone(), body: body.position.clone() });
  }
  return frames;
}

describe('the drawn hero setting off and stopping', () => {
  it('gathers speed over about a fifth of a second instead of jumping to full speed', () => {
    const frames = run(1.5, () => true);
    expect(frames[0]!.speed).toBeLessThan(1);
    const full = frames.find((f) => f.speed >= SPEED * 0.95)!;
    expect(full.t).toBeGreaterThan(0.12);
    expect(full.t).toBeLessThan(0.35);
  });

  it('stays close behind the hero and catches up', () => {
    const frames = run(1.5, () => true);
    expect(Math.max(...frames.map((f) => f.lag))).toBeLessThan(0.75);
    // In the end it is no more than a frame's step behind.
    expect(Math.abs(frames[frames.length - 1]!.lag)).toBeLessThan(SPEED * DT * 1.5);
    // While catching up it may run a little faster, never wildly so.
    expect(Math.max(...frames.map((f) => f.speed))).toBeLessThan(SPEED * 1.35);
  });

  it('stops where the hero stops, without running past and back', () => {
    const frames = run(2, (t) => t < 1);
    const after = frames.filter((f) => f.t >= 1);
    for (const f of after) expect(f.body.x).toBeLessThanOrEqual(f.target.x + 1e-9);
    const last = frames[frames.length - 1]!;
    expect(last.speed).toBe(0);
    expect(last.body.x).toBeCloseTo(last.target.x, 6);
  });

  it('settles quickly when the hero stops right after setting off', () => {
    const frames = run(1.2, (t) => t < 0.15);
    const settled = frames.find((f) => f.t > 0.15 && f.speed === 0)!;
    expect(settled.t).toBeLessThan(0.6);
  });

  it('jumps rather than runs when the hero is moved far at once', () => {
    const body = new Follower();
    body.reset(new THREE.Vector3());
    body.update(new THREE.Vector3(40, 0, 0), new THREE.Vector3(), DT);
    expect(body.position.x).toBe(40);
  });
});
