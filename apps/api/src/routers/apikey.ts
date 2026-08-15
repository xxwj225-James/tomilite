import { router, publicProcedure, z } from '../trpc';
import { prisma } from '@tomilite/database';
import crypto from 'crypto';

// API key lifecycle: generate, list, revoke, verify
const PREFIX = 'tl_';
const TOKEN_LENGTH = 48;

function sha256(s: string) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function genToken() {
  const bytes = crypto.randomBytes(TOKEN_LENGTH);
  return PREFIX + bytes.toString('base64url');
}

export const apikeyRouter = router({
  list: publicProcedure.query(async () => {
    const keys = await prisma.apiKey.findMany({ orderBy: { createdAt: 'desc' } });
    return keys.map(k => ({
      id: k.id, name: k.name, keyPrefix: k.keyPrefix || PREFIX,
      isActive: k.isActive, scopes: k.scopes || 'read,write',
      hitlMode: k.hitlMode || 'manual',
      lastUsedAt: k.lastUsedAt, useCount: k.useCount,
      createdAt: k.createdAt, expiresAt: k.expiresAt,
    }));
  }),

  generate: publicProcedure
    .input(z.object({
      name: z.string(),
      scopes: z.string().default('read,write'),
      hitlMode: z.enum(['manual', 'auto']).default('manual'),
      expiresDays: z.number().default(90),
    }))
    .mutation(async ({ input }) => {
      const rawToken = genToken();
      const hash = sha256(rawToken);

      const key = await prisma.apiKey.create({
        data: {
          name: input.name,
          keyPrefix: PREFIX,
          keyHash: hash,
          scopes: input.scopes || 'read,write',
          hitlMode: input.hitlMode || 'manual',
          isActive: true,
          expiresAt: new Date(Date.now() + input.expiresDays * 86400000).toISOString(),
        },
      });

      return {
        id: key.id, name: key.name,
        key: rawToken, // shown only once!
        scopes: key.scopes, hitlMode: key.hitlMode,
        createdAt: key.createdAt,
      };
    }),

  revoke: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await prisma.apiKey.update({ where: { id: input.id }, data: { isActive: false } });
      return { revoked: true };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await prisma.apiKey.delete({ where: { id: input.id } });
      return { deleted: true };
    }),

  // Verify raw token → returns key info
  verify: publicProcedure
    .input(z.object({ key: z.string() }))
    .mutation(async ({ input }) => {
      const hash = sha256(input.key.trim());
      const key = await prisma.apiKey.findFirst({ where: { keyHash: hash } });
      if (!key) return { valid: false, reason: 'Invalid API key' };
      if (!key.isActive) return { valid: false, reason: 'API key revoked' };
      // Update usage
      await prisma.apiKey.update({
        where: { id: key.id },
        data: { lastUsedAt: new Date().toISOString(), useCount: (key.useCount || 0) + 1 },
      });
      return {
        valid: true,
        id: key.id, name: key.name,
        scopes: key.scopes || 'read,write',
        hitlMode: key.hitlMode || 'manual',
      };
    }),
});
