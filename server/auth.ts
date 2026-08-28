import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { v4 as uuid } from "uuid";
import { CONFIG } from "./config.ts";
import { db, now } from "./db.ts";

export type AuthUser = {
  id: string;
  email: string;
  username: string;
  role: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser) {
  return jwt.sign(user, CONFIG.JWT_SECRET, { expiresIn: CONFIG.JWT_EXPIRES });
}

export function authOptional(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.ashmarch || (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return next();
  try {
    req.user = jwt.verify(token, CONFIG.JWT_SECRET) as AuthUser;
  } catch {
    /* ignore */
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Sign the ledger first." });
  const banned = db.prepare("SELECT banned_until, ban_reason FROM users WHERE id = ?").get(req.user.id) as
    | { banned_until: number | null; ban_reason: string | null }
    | undefined;
  if (banned?.banned_until && banned.banned_until > Date.now()) {
    return res.status(403).json({ error: `Banished: ${banned.ban_reason || "by decree"}` });
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== "admin") return res.status(403).json({ error: "The seneschal's hall is barred." });
  next();
}

export function hashPassword(pw: string) {
  return bcrypt.hashSync(pw, 10);
}

export function checkPassword(pw: string, hash: string) {
  return bcrypt.compareSync(pw, hash);
}

export function setAuthCookie(res: Response, user: AuthUser) {
  const token = signToken(user);
  res.cookie("ashmarch", token, { httpOnly: true, sameSite: "lax", maxAge: 7 * 24 * 3600 * 1000 });
  return token;
}

export function newId() {
  return uuid();
}

export { now };
