import type { IncomingMessage, ServerResponse } from "node:http";

export function readCookie(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const chunk of header.split(";")) {
    const [key, value] = chunk.trim().split("=");
    if (key === name && value) {
      return decodeURIComponent(value);
    }
  }
  return undefined;
}

interface SessionCookieOptions {
  secure?: boolean;
}

export function setSessionCookie(res: ServerResponse, sessionId: string, options: SessionCookieOptions = {}): void {
  const secure = options.secure ? "; Secure" : "";
  appendCookie(res, `roomscape_session=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}`);
}

export function clearSessionCookie(res: ServerResponse, options: SessionCookieOptions = {}): void {
  const secure = options.secure ? "; Secure" : "";
  appendCookie(res, `roomscape_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

export function setRememberedDeviceCookie(res: ServerResponse, token: string, options: SessionCookieOptions = {}): void {
  const secure = options.secure ? "; Secure" : "";
  appendCookie(res, `roomscape_device=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=7776000${secure}`);
}

export function clearRememberedDeviceCookie(res: ServerResponse, options: SessionCookieOptions = {}): void {
  const secure = options.secure ? "; Secure" : "";
  appendCookie(res, `roomscape_device=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

export function setPendingLoginCookie(res: ServerResponse, token: string, options: SessionCookieOptions = {}): void {
  const secure = options.secure ? "; Secure" : "";
  appendCookie(res, `roomscape_login=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${secure}`);
}

export function clearPendingLoginCookie(res: ServerResponse, options: SessionCookieOptions = {}): void {
  const secure = options.secure ? "; Secure" : "";
  appendCookie(res, `roomscape_login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

function appendCookie(res: ServerResponse, cookie: string): void {
  const current = res.getHeader("Set-Cookie");
  if (!current) {
    res.setHeader("Set-Cookie", cookie);
    return;
  }
  if (Array.isArray(current)) {
    res.setHeader("Set-Cookie", [...current.map(String), cookie]);
    return;
  }
  res.setHeader("Set-Cookie", [String(current), cookie]);
}
