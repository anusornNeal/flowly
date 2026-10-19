import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createServer } from '../apps/api/src/server.js';

export const headers = { host: '127.0.0.1:3210', 'x-flowly-actor': 'fly45-qa' };
export type ImagePart = { bytes: Buffer; name: string; mime: string };
export async function image(format: 'png' | 'jpeg' | 'webp' = 'png', width = 24, height = 16): Promise<ImagePart> {
  return { bytes: await sharp({ create: { width, height, channels: 3, background: '#c13567' } }).toFormat(format).toBuffer(),
    name: `reference.${format === 'jpeg' ? 'jpg' : format}`, mime: `image/${format}` };
}
export function multipart(fields: Record<string, unknown>, files: ImagePart[], fieldName = 'files') {
  const boundary = `fly45-${randomUUID()}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${typeof value === 'string' ? value : JSON.stringify(value)}\r\n`));
  for (const file of files) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${file.name}"\r\nContent-Type: ${file.mime}\r\n\r\n`), file.bytes, Buffer.from('\r\n'));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
export async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowly-fly45-qa-'));
  let api: Awaited<ReturnType<typeof createServer>>;
  try { api = await createServer({ root }); }
  catch (error) { fs.rmSync(root, { recursive: true, force: true }); throw error; }
  return {
    root, get api() { return api; },
    async op(name: string, input: object = {}) {
      const response = await api.inject({ method: 'POST', url: `/api/operations/${name}`, headers, payload: input });
      assert.equal(response.statusCode, 200, `${name}: ${response.body}`);
      return response.json().result;
    },
    async restart() { await api.close(); api = await createServer({ root }); },
    async close() { try { await api.close(); } finally { fs.rmSync(root, { recursive: true, force: true }); } },
  };
}
export function cli(root: string, operation: string, input: object): Promise<{ exit: number | null; result: any }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve('bin/flowly.cjs'), operation, '--input=-', '--actor=fly45-cli'], {
      env: { ...process.env, FLOWLY_DATA_DIR: root }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(Error(`CLI timeout: ${operation}`)); }, 30_000);
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.stdin.on('error', reject);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', exit => {
      clearTimeout(timer);
      try { resolve({ exit, result: JSON.parse(stdout || stderr) }); } catch { reject(Error(`CLI non-JSON output: ${operation}: ${stdout} ${stderr}`)); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
