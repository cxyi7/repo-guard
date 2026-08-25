import { runGit, runGitBinary } from './execution.js';
import { executionError } from '../core/error/repo-guard-error.js';

function attachBlobSizes(root, entries) {
  if (entries.length === 0) return entries;
  const input = Buffer.from(`${entries.map(({ oid }) => oid).join('\n')}\n`, 'ascii');
  const result = runGitBinary(
    ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
    { cwd: root, input },
  );
  const sizes = new Map(
    result.stdout.toString('utf8').trim().split('\n').filter(Boolean).map((line) => {
      const [oid, type, rawSize] = line.split(' ');
      return [oid, type === 'blob' ? Number(rawSize) : null];
    }),
  );
  return entries.map((entry) => ({ ...entry, size: sizes.get(entry.oid) ?? null }));
}

function parseIndexRecord(record) {
  const tab = record.indexOf('\t');
  const metadata = record.slice(0, tab).split(' ');
  return {
    mode: metadata[0],
    oid: metadata[1],
    stage: Number(metadata[2]),
    path: record.slice(tab + 1).replaceAll('\\', '/'),
  };
}

export function listIndexBinaryEntries(root) {
  const entries = runGit(['ls-files', '--cached', '--stage', '-z'], { cwd: root }).stdout
    .split('\0')
    .filter(Boolean)
    .map(parseIndexRecord)
    .filter(({ stage, mode }) => stage === 0 && mode !== '160000' && mode !== '120000');
  return attachBlobSizes(root, entries);
}

export const listIndexBlobEntries = listIndexBinaryEntries;

export function listRevisionBinaryEntries(root, revision) {
  const entries = runGit(['ls-tree', '-r', '-z', revision], { cwd: root }).stdout
    .split('\0')
    .filter(Boolean)
    .map((record) => {
      const tab = record.indexOf('\t');
      const [mode, type, oid] = record.slice(0, tab).split(' ');
      return {
        mode,
        type,
        oid,
        path: record.slice(tab + 1).replaceAll('\\', '/'),
      };
    })
    .filter(({ mode, type }) => type === 'blob' && mode !== '120000');
  return attachBlobSizes(root, entries);
}

export const listRevisionBlobEntries = listRevisionBinaryEntries;

export function readGitBlob(root, oid, { maxBuffer } = {}) {
  return runGitBinary(['cat-file', 'blob', oid], { cwd: root, maxBuffer }).stdout;
}

export function readGitBlobs(root, entries, { maxTotalBytes = 210000000 } = {}) {
  const uniqueOids = [...new Set(entries.map(({ oid }) => oid))];
  if (uniqueOids.length === 0) return new Map();
  const declaredBytes = entries.reduce((total, entry) => total + (entry.size ?? 0), 0);
  if (declaredBytes > maxTotalBytes) {
    throw executionError(
      'git/blob-batch-too-large',
      `Git 快照待读取内容共 ${declaredBytes} 字节，超过安全上限 ${maxTotalBytes} 字节`,
    );
  }
  const input = Buffer.from(`${uniqueOids.join('\n')}\n`, 'ascii');
  const result = runGitBinary(['cat-file', '--batch'], {
    cwd: root,
    input,
    maxBuffer: maxTotalBytes + (uniqueOids.length * 160) + 1024,
  });
  const buffersByOid = new Map();
  let cursor = 0;
  for (const expectedOid of uniqueOids) {
    const headerEnd = result.stdout.indexOf(10, cursor);
    if (headerEnd === -1) {
      throw executionError('git/blob-batch-invalid', 'Git 批量对象输出缺少对象头');
    }
    const [oid, type, rawSize] = result.stdout.subarray(cursor, headerEnd).toString('ascii').split(' ');
    const size = Number(rawSize);
    if (type !== 'blob' || !Number.isInteger(size) || size < 0 || oid !== expectedOid) {
      throw executionError('git/blob-batch-invalid', `Git 批量对象输出无效：${oid} ${type} ${rawSize}`);
    }
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + size;
    if (contentEnd >= result.stdout.length || result.stdout[contentEnd] !== 10) {
      throw executionError('git/blob-batch-invalid', `Git 对象 ${oid} 的内容长度与声明不一致`);
    }
    buffersByOid.set(oid, result.stdout.subarray(contentStart, contentEnd));
    cursor = contentEnd + 1;
  }
  return new Map(entries.map((entry) => [entry.path, buffersByOid.get(entry.oid)]));
}
