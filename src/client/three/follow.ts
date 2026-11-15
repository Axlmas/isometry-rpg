import * as THREE from 'three';

/**
 * The drawn body of a character that the rules move at full speed from the very first
 * tick. Drawn as is, every start would be a jolt. This body follows the rules' position
 * with a limited acceleration: it gathers speed over a fifth of a second, then closes the
 * small gap; it brakes harder than it accelerates and never runs past a standing target.
 */
export class Follower {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  private readonly gap = new THREE.Vector3();
  private readonly want = new THREE.Vector3();

  constructor(
    /** m/s² when gathering speed. */
    private readonly accel = 28,
    /** m/s² when the target stands still. */
    private readonly brake = 60,
    /** How strongly the gap to the target is closed, per second. */
    private readonly catchUp = 9,
    /** Beyond this many metres the body jumps instead of running (travel, respawn). */
    private readonly jump = 3,
  ) {}

  /** Puts the body straight on a place, standing. */
  reset(at: THREE.Vector3): void {
    this.position.copy(at);
    this.velocity.set(0, 0, 0);
  }

  /** Moves the body for one frame towards `target`, which itself moves at `targetVelocity`. */
  update(target: THREE.Vector3, targetVelocity: THREE.Vector3, dt: number): void {
    const gap = this.gap.subVectors(target, this.position);
    if (dt <= 0 || gap.lengthSq() > this.jump * this.jump) {
      this.position.copy(target);
      this.velocity.copy(targetVelocity);
      return;
    }
    const standing = targetVelocity.lengthSq() < 1e-6;
    const want = this.want.copy(targetVelocity).addScaledVector(gap, this.catchUp);
    // Catching up is a slightly quicker stride, not a sprint: that would be a jolt of its own.
    const cap = standing ? 2.5 : targetVelocity.length() * 1.2 + 0.4;
    if (want.length() > cap) want.setLength(cap);
    const change = want.sub(this.velocity);
    const limit = (standing ? this.brake : this.accel) * dt;
    if (change.length() > limit) change.setLength(limit);
    this.velocity.add(change);
    this.position.addScaledVector(this.velocity, dt);
    // A standing target is never overrun, and the last few millimetres are not crept:
    // the body stops on it.
    const left = this.gap.subVectors(target, this.position);
    if (standing && (this.velocity.dot(left) < 0 || left.lengthSq() < 0.02 * 0.02)) {
      this.position.copy(target);
      this.velocity.set(0, 0, 0);
    }
  }

  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }
}
