import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGitAuthorIdent } from '../src/git/file-history.js';

test('解析 Git 作者身份并保留作者时区中的本地时间', () => {
  assert.deepEqual(
    parseGitAuthorIdent('lxz <lxz@example.com> 0 +0800\n'),
    { name: 'lxz', date: '1970-01-01 08:00:00' },
  );
  assert.deepEqual(
    parseGitAuthorIdent('Editor Name <editor@example.com> 3600 -0100'),
    { name: 'Editor Name', date: '1970-01-01 00:00:00' },
  );
});

test('拒绝无法解析的 Git 作者身份', () => {
  assert.throws(
    () => parseGitAuthorIdent('invalid'),
    /当前提交身份格式无效/,
  );
});
