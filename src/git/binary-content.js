import { runGit, runGitBinary } from './execution.js';

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

export function readGitBlob(root, oid, { maxBuffer } = {}) {
  return runGitBinary(['cat-file', 'blob', oid], { cwd: root, maxBuffer }).stdout;
}
