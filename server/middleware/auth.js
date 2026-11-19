const { getAuth, verifyToken } = require('@clerk/express');

/**
 * Require a valid Clerk session.
 *
 * Primary path: the Clerk session JWT sent as an `Authorization: Bearer <token>`
 * header (or a Clerk cookie), verified by `clerkMiddleware()`/`getAuth()`.
 *
 * Fallback path: `?token=<token>` for popup windows that cannot set headers
 * (integration OAuth starts open a new browsing context).
 *
 * On success sets `req.user = { userId, email, sessionId }` so existing route
 * handlers can keep using `req.user.userId`.
 */
async function requireAuth(req, res, next) {
  try {
    const auth = getAuth(req);
    if (auth && auth.userId) {
      req.user = {
        userId: auth.userId,
        email: auth.sessionClaims && auth.sessionClaims.email,
        sessionId: auth.sessionId,
      };
      return next();
    }

    const raw = typeof req.query.token === 'string' ? req.query.token : null;
    if (raw) {
      const payload = await verifyToken(raw, { secretKey: process.env.CLERK_SECRET_KEY });
      if (payload && payload.sub) {
        req.user = { userId: payload.sub, email: payload.email, sessionId: payload.sid };
        return next();
      }
    }

    return res.status(401).json({ error: 'unauthorized' });
  } catch (_err) {
    return res.status(401).json({ error: 'invalid token' });
  }
}

module.exports = { requireAuth };
