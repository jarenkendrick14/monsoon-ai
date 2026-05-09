import { Request, Response, NextFunction } from 'express';
import PocketBase from 'pocketbase';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

interface JwtPayload {
  id: string;
  exp: number;
  type: string;
}

function decodeJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload) as JwtPayload;
  } catch {
    return null;
  }
}

export async function govAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  const payload = decodeJwt(token);

  if (!payload) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  if (payload.exp < Date.now() / 1000) {
    res.status(401).json({ error: 'Token expired' });
    return;
  }

  try {
    const pb = new PocketBase(config.pb.url);
    pb.authStore.save(token, null);
    const user = await pb.collection('users').getOne(payload.id);

    req.user = user as unknown as typeof req.user & NonNullable<typeof req.user>;
    next();
  } catch (err) {
    logger.debug('Gov auth middleware user fetch failed', err);
    res.status(401).json({ error: 'User not found' });
  }
}
