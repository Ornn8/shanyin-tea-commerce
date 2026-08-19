/**
 * Cross-tab cart lock tests (Issue #5, ADR-0007).
 *
 * In Node (vitest) `navigator.locks` does not exist, so `withCartLock`
 * exercises the per-context queue fallback — which is exactly what a browser
 * without the Web Locks API uses. The grid: tasks submitted "at the same
 * time" must run strictly one after another (they are cart cookie writes, so
 * overlap would silently drop one mutation), and results/errors must propagate
 * independently without one poisoning the next.
 */
import { describe, expect, it } from 'vitest';
import { withCartLock } from '@/lib/cart-lock';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('withCartLock (per-context queue fallback)', () => {
  it('serializes overlapping tasks so they never interleave', async () => {
    const order: string[] = [];
    const taskA = withCartLock(async () => {
      order.push('a-start');
      await delay(20);
      order.push('a-end');
      return 'A';
    });
    const taskB = withCartLock(async () => {
      order.push('b-start');
      await delay(5);
      order.push('b-end');
      return 'B';
    });
    const [a, b] = await Promise.all([taskA, taskB]);
    expect(a).toBe('A');
    expect(b).toBe('B');
    // A mutation must fully finish (and its cookie write land) before the next
    // one begins — the exact guarantee that prevents a lost update.
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('propagates results and errors independently', async () => {
    const boom = withCartLock(async () => {
      throw new Error('server rejected');
    });
    const ok = withCartLock(async () => 42);
    await expect(boom).rejects.toThrow('server rejected');
    // A rejected task must not poison the queue for the next task.
    await expect(ok).resolves.toBe(42);
  });
});
