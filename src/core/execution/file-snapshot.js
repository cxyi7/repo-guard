import {
  readFileSync,
  writeFileSync,
} from 'node:fs';

export function captureFileContents(files) {
  return new Map(files.map((file) => [file, readFileSync(file)]));
}

export function restoreFileContents(contents) {
  for (const [file, content] of contents) {
    writeFileSync(file, content);
  }
}
