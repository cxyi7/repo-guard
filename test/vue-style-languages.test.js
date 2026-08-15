import assert from 'node:assert/strict';
import test from 'node:test';
import { collectVueStyleLanguages } from '../src/policies/vue-style-languages.js';

test('collects default and explicit Vue style languages', () => {
  assert.deepEqual(
    collectVueStyleLanguages([
      '<style scoped>.a { color: red; }</style>',
      '<style lang="scss">.b { color: blue; }</style>',
      "<style lang='LESS'>.c { color: green; }</style>",
    ].join('\n')),
    ['css', 'less', 'scss'],
  );
});

test('allows multiple Vue style blocks that use the same language', () => {
  assert.deepEqual(
    collectVueStyleLanguages([
      '<style lang="scss">.a { color: red; }</style>',
      '<style scoped lang=scss>.b { color: blue; }</style>',
    ].join('\n')),
    ['scss'],
  );
});
