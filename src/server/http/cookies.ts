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
  res.setHeader("Set-Cookie", `roomscape_session=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}`);
}

export function clearSessionCookie(res: ServerResponse, options: SessionCookieOptions = {}): void {
  const secure = options.secure ? "; Secure" : "";
  res.setHeader("Set-Cookie", `roomscape_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}
