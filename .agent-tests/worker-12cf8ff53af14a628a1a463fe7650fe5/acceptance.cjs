const assert = require('node:assert/strict');
const { orderTasks } = require(require('node:path').resolve(process.argv[2]));
const task = (id, dependsOn = []) => ({ id, dependsOn });
const cases = [
  ['empty', () => assert.deepEqual(orderTasks([]), [])],
  ['chain', () => assert.deepEqual(orderTasks([task('c', ['b']), task('b', ['a']), task('a')]), ['a', 'b', 'c'])],
  ['initial lexical', () => assert.deepEqual(orderTasks([task('z'), task('a'), task('m')]), ['a', 'm', 'z'])],
  ['newly unlocked lexical', () => assert.deepEqual(orderTasks([task('b'), task('a', ['b']), task('z')]), ['b', 'a', 'z'])],
  ['duplicate ids', () => assert.throws(() => orderTasks([task('a'), task('a')]), Error)],
  ['unknown dependency', () => assert.throws(() => orderTasks([task('a', ['missing'])]), Error)],
  ['cycle', () => assert.throws(() => orderTasks([task('a', ['b']), task('b', ['a'])]), Error)],
  ['self cycle', () => assert.throws(() => orderTasks([task('a', ['a'])]), Error)],
  ['repeated dependency', () => assert.deepEqual(orderTasks([task('b', ['a', 'a']), task('a')]), ['a', 'b'])],
  ['frozen input', () => {
    const input = [task('b', ['a']), task('a')];
    const before = JSON.stringify(input);
    input.forEach(t => { Object.freeze(t.dependsOn); Object.freeze(t); });
    Object.freeze(input);
    assert.deepEqual(orderTasks(input), ['a', 'b']);
    assert.equal(JSON.stringify(input), before);
  }],
];
let failures = 0;
for (const [name, run] of cases) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
}
console.log(`${cases.length - failures}/${cases.length} passed`);
process.exitCode = failures ? 1 : 0;
