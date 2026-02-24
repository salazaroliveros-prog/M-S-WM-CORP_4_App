import { describe, expect, it } from 'vitest';
import { computeCpm } from '../../lib/ganttCpm';

describe('computeCpm', () => {
  it('computes critical path and slack for a simple fork-join', () => {
    // A splits into B and C; D depends on both.
    // Durations: A=2, B=5, C=2, D=1
    // Path A->B->D = 2+5+1 = 8 (critical)
    // Path A->C->D = 2+2+1 = 5 (C has slack 3)
    const res = computeCpm([
      { key: 'A', durationDays: 2, deps: [] },
      { key: 'B', durationDays: 5, deps: ['A'] },
      { key: 'C', durationDays: 2, deps: ['A'] },
      { key: 'D', durationDays: 1, deps: ['B', 'C'] },
    ]);

    expect(res.hasCycle).toBe(false);
    expect(res.projectEnd).toBe(7); // 0-based inclusive

    const A = res.tasks.get('A')!;
    const B = res.tasks.get('B')!;
    const C = res.tasks.get('C')!;
    const D = res.tasks.get('D')!;

    expect(A.es).toBe(0);
    expect(A.ef).toBe(1);

    expect(B.es).toBe(2);
    expect(B.ef).toBe(6);

    expect(C.es).toBe(2);
    expect(C.ef).toBe(3);

    expect(D.es).toBe(7);
    expect(D.ef).toBe(7);

    expect(B.slackDays).toBe(0);
    expect(C.slackDays).toBe(3);

    expect(B.isCritical).toBe(true);
    expect(C.isCritical).toBe(false);
    expect(D.isCritical).toBe(true);
  });

  it('handles unknown deps by ignoring them', () => {
    const res = computeCpm([
      { key: 'A', durationDays: 1, deps: ['NOPE'] },
      { key: 'B', durationDays: 1, deps: ['A'] },
    ]);

    expect(res.hasCycle).toBe(false);
    expect(res.tasks.get('A')!.es).toBe(0);
    expect(res.tasks.get('B')!.es).toBe(1);
  });
});
