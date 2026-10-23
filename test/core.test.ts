import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng, Registry, hashJson, stableStringify, sin, cos, log2, minJerk } from '../packages/core/index.ts';

test('Rng: same seed → same stream; forks are independent of consumption', () => {
  const a = new Rng(42);
  const b = new Rng(42);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
  const c = new Rng(42);
  const d = new Rng(42);
  d.next(); d.next(); d.next();
  assert.equal(c.fork('x').next(), d.fork('x').next(), 'fork must not depend on how much the parent was used');
  assert.notEqual(new Rng(1).fork('a').next(), new Rng(1).fork('b').next());
  assert.notEqual(new Rng(1).next(), new Rng(2).next());
});

test('arithmetic-only math matches libm closely', () => {
  for (let x = -10; x <= 10; x += 0.37) {
    assert.ok(Math.abs(sin(x) - Math.sin(x)) < 1e-6, `sin(${x})`);
    assert.ok(Math.abs(cos(x) - Math.cos(x)) < 1e-6, `cos(${x})`);
  }
  for (const v of [0.3, 1, 1.5, 2, 7, 100, 1234.5]) assert.ok(Math.abs(log2(v) - Math.log2(v)) < 1e-7, `log2(${v})`);
  assert.equal(minJerk(0), 0);
  assert.equal(minJerk(1), 1);
  assert.ok(Math.abs(minJerk(0.5) - 0.5) < 1e-12);
});

test('stableStringify / hashJson ignore key order', () => {
  assert.equal(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] }), stableStringify({ a: [2, { c: 2, d: 1 }], b: 1 }));
  assert.equal(hashJson({ x: 1, y: 2 }), hashJson({ y: 2, x: 1 }));
  assert.notEqual(hashJson({ x: 1 }), hashJson({ x: 2 }));
});

test('Registry: register / get / disable / duplicates / owner switch-off', () => {
  const r = new Registry();
  r.register('transition', 'cut', { id: 'cut' }, 'core');
  r.register('transition', 'whip', { id: 'whip' }, 'mod:fx');
  assert.deepEqual(r.list('transition'), ['cut', 'whip']);
  assert.throws(() => r.register('transition', 'cut', {}), /already registered/);
  r.disableOwner('mod:fx');
  assert.deepEqual(r.list('transition'), ['cut']);
  assert.throws(() => r.get('transition', 'whip'), /disabled/);
  assert.throws(() => r.get('transition', 'nope'), /not registered/);
  r.setEnabled('transition', 'whip', true);
  assert.equal(r.has('transition', 'whip'), true);
  assert.deepEqual(r.snapshot().map((e) => e.id), ['cut', 'whip']);
});
