import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getEnv } from '../env';
import type { DocumentStorage, StorageMetadata } from './types';

function safeKey(key: string): string {
  const normalized = key.replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Invalid document storage key');
  return normalized;
}

export class LocalDocumentStorage implements DocumentStorage {
  constructor(private readonly root: string) {}
  private path(key: string) {
    const root = resolve(this.root);
    const output = resolve(root, safeKey(key));
    if (output !== root && !output.startsWith(`${root}${sep}`)) throw new Error('Document key escapes storage root');
    return output;
  }
  async upload(key: string, buffer: Buffer): Promise<string> { const path = this.path(key); await mkdir(dirname(path), { recursive: true }); await writeFile(path, buffer, { flag: 'wx' }).catch(async (error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; await writeFile(path, buffer); }); return safeKey(key); }
  download(key: string) { return readFile(this.path(key)); }
  async delete(key: string) { await rm(this.path(key), { force: true }); }
  async exists(key: string) { return stat(this.path(key)).then(() => true, () => false); }
}

export class S3DocumentStorage implements DocumentStorage {
  private readonly client: S3Client;
  constructor(private readonly bucket: string, region: string, credentials: { accessKeyId: string; secretAccessKey: string }, endpoint?: string) {
    this.client = new S3Client({ region, credentials, endpoint, forcePathStyle: Boolean(endpoint) });
  }
  async upload(key: string, buffer: Buffer, metadata: StorageMetadata = {}) { const name = safeKey(key); await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: name, Body: buffer, ContentType: metadata.contentType, Metadata: Object.fromEntries(Object.entries(metadata).filter(([, value]) => value != null) as [string, string][]) })); return name; }
  async download(key: string) { const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: safeKey(key) })); if (!result.Body) throw new Error('Stored document body is empty'); return Buffer.from(await result.Body.transformToByteArray()); }
  async delete(key: string) { await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: safeKey(key) })); }
  async exists(key: string) { return this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: safeKey(key) })).then(() => true, () => false); }
}

export function getDocumentStorage(): DocumentStorage {
  const env = getEnv();
  if (env.AWS_S3_BUCKET && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) return new S3DocumentStorage(env.AWS_S3_BUCKET, env.AWS_REGION, { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY }, env.AWS_ENDPOINT);
  return new LocalDocumentStorage(env.DOCUMENT_STORAGE_PATH);
}
