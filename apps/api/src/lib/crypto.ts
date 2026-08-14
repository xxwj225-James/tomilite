import crypto from 'crypto';
import { prisma } from '@tomatolite/database';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

// Key stored in filesystem (TL_USER_DATA/.encryption_key), not in DB.
// Prevents trivial decryption: attacker needs both DB + filesystem access.
const DATA_DIR = process.env.TL_USER_DATA || join(homedir(), '.tomilite');
const KEY_DIR = DATA_DIR;
const KEY_FILE = join(KEY_DIR, '.encryption_key');

let cachedKey: Buffer | null = null;

async function getEncryptionKey(): Promise<Buffer> {
  if (cachedKey) return cachedKey;

  // 1. Try filesystem first (current standard)
  try {
    if (existsSync(KEY_FILE)) {
      const keyB64 = readFileSync(KEY_FILE, 'utf-8').trim();
      if (keyB64) {
        cachedKey = Buffer.from(keyB64, 'base64');
        return cachedKey;
      }
    }
  } catch {}

  // 2. Migrate from DB (old versions stored key in SystemConfig)
  try {
    const config = await prisma.systemConfig.findUnique({ where: { key: 'encryption_key' } });
    if (config?.value) {
      // Migrate: write to file, then delete from DB
      mkdirSync(KEY_DIR, { recursive: true });
      writeFileSync(KEY_FILE, config.value, { mode: 0o600 });
      // Keep DB copy for backward compatibility during transition
      cachedKey = Buffer.from(config.value, 'base64');
      return cachedKey;
    }
  } catch {}

  // 3. First run: generate new key → save to filesystem only
  const key = crypto.randomBytes(KEY_LENGTH);
  mkdirSync(KEY_DIR, { recursive: true });
  writeFileSync(KEY_FILE, key.toString('base64'), { mode: 0o600 });
  cachedKey = key;
  return key;
}

export async function encrypt(plaintext: string): Promise<string> {
  if (!plaintext) return '';
  const key = await getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), encrypted.toString('base64'), tag.toString('base64')].join(':');
}

export async function decrypt(encrypted: string): Promise<string> {
  if (!encrypted || !encrypted.includes(':')) return encrypted;
  const [ivB64, dataB64, tagB64] = encrypted.split(':');
  if (!ivB64 || !dataB64 || !tagB64) return encrypted;
  try {
    const key = await getEncryptionKey();
    const iv = Buffer.from(ivB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return encrypted;
  }
}
