const crypto = require('node:crypto');

function apiError(statusCode, code, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function decodeBase64Url(value) {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

let jwksCache = { keys: [], expiresAt: 0 };

async function fetchSupabaseJwks(supabaseUrl) {
  const now = Date.now();
  if (jwksCache.expiresAt > now && jwksCache.keys.length > 0) {
    return jwksCache.keys;
  }
  const cleanUrl = supabaseUrl.replace(/\/+$/, '');
  const jwksUrl = `${cleanUrl}/auth/v1/.well-known/jwks.json`;
  const res = await fetch(jwksUrl, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw apiError(500, 'AUTH_JWKS_FAILED', 'Failed to retrieve Supabase JWKS for token verification.');
  }
  const data = await res.json();
  const keys = Array.isArray(data.keys) ? data.keys : [];
  jwksCache = { keys, expiresAt: now + 10 * 60 * 1000 };
  return keys;
}

function validateClaims(payload) {
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && Number(payload.exp) < now) {
    throw apiError(401, 'TOKEN_EXPIRED', 'Authentication token has expired.');
  }
  if (payload.nbf && Number(payload.nbf) > now) {
    throw apiError(401, 'INVALID_TOKEN', 'Authentication token is not yet active.');
  }
}

async function verifyAsymmetricJwt(headerPart, payloadPart, signaturePart, header, supabaseUrl) {
  const keys = await fetchSupabaseJwks(supabaseUrl);
  const matchingKey = (header.kid ? keys.find((k) => k.kid === header.kid) : null) || keys[0];
  if (!matchingKey) {
    throw apiError(401, 'INVALID_TOKEN', 'No matching public key found in Supabase JWKS.');
  }
  const publicKey = crypto.createPublicKey({ key: matchingKey, format: 'jwk' });
  const algorithm = header.alg === 'ES256' ? 'SHA256' : 'RSA-SHA256';
  const isValid = crypto.verify(
    algorithm,
    Buffer.from(`${headerPart}.${payloadPart}`),
    publicKey,
    Buffer.from(signaturePart, 'base64url')
  );
  if (!isValid) {
    throw apiError(401, 'INVALID_TOKEN', 'Invalid authentication token signature.');
  }
  const payload = JSON.parse(decodeBase64Url(payloadPart));
  validateClaims(payload);
  return payload;
}

function verifyHs256(token, secret) {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) {
    throw apiError(401, 'INVALID_TOKEN', 'Invalid authentication token.');
  }
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw apiError(401, 'INVALID_TOKEN', 'Invalid authentication token signature.');
  }
  const parsed = JSON.parse(decodeBase64Url(payload));
  validateClaims(parsed);
  return parsed;
}

async function decodeJwtForConfiguredMode(token) {
  if (token.startsWith('demo.')) {
    if (process.env.NODE_ENV === 'production') {
      throw apiError(401, 'DEMO_AUTH_DISABLED', 'Demo authentication is disabled in production.');
    }
    const allowLocalDemo = !process.env.DATABASE_URL && process.env.NODE_ENV !== 'production';
    if (process.env.AUTH_MODE === 'demo' || process.env.NODE_ENV === 'test' || allowLocalDemo) {
      const parts = token.split('.');
      if (parts.length < 2) throw apiError(401, 'INVALID_TOKEN', 'Malformed demo token.');
      const parsed = JSON.parse(decodeBase64Url(parts[1]));
      validateClaims(parsed);
      return parsed;
    }
    throw apiError(401, 'DEMO_AUTH_DISABLED', 'Demo authentication is not permitted in this configuration.');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw apiError(401, 'INVALID_TOKEN', 'Invalid JWT structure.');
  }

  let header;
  try {
    header = JSON.parse(decodeBase64Url(parts[0]));
  } catch {
    throw apiError(401, 'INVALID_TOKEN', 'Invalid token header.');
  }

  if (header.alg === 'HS256' && process.env.SUPABASE_JWT_SECRET) {
    return verifyHs256(token, process.env.SUPABASE_JWT_SECRET);
  }

  if ((header.alg === 'RS256' || header.alg === 'ES256') && process.env.SUPABASE_URL) {
    return await verifyAsymmetricJwt(parts[0], parts[1], parts[2], header, process.env.SUPABASE_URL);
  }

  if (process.env.SUPABASE_JWT_SECRET) {
    return verifyHs256(token, process.env.SUPABASE_JWT_SECRET);
  }

  if (process.env.NODE_ENV === 'production') {
    throw apiError(500, 'AUTH_NOT_CONFIGURED', 'Supabase authentication verification is not configured on the server.');
  }

  const allowLocalDemo = !process.env.DATABASE_URL && process.env.NODE_ENV !== 'production';
  if (process.env.AUTH_MODE === 'demo' || process.env.NODE_ENV === 'test' || allowLocalDemo) {
    const parsed = JSON.parse(decodeBase64Url(parts[1]));
    validateClaims(parsed);
    return parsed;
  }

  throw apiError(500, 'AUTH_NOT_CONFIGURED', 'Supabase JWT verification is not configured.');
}

async function findProfileForAuth(db, payload) {
  const authUserId = payload.sub || payload.user_id;
  if (!authUserId) {
    throw apiError(401, 'INVALID_TOKEN', 'Authentication token is missing a user id.');
  }
  return db.get('SELECT * FROM profiles WHERE auth_user_id = ?', [authUserId]);
}

function requireAuth(db) {
  return async (req, res, next) => {
    try {
      if (process.env.NODE_ENV === 'test' && req.header('x-test-profile-id')) {
        const profile = await db.get('SELECT * FROM profiles WHERE id = ?', [req.header('x-test-profile-id')]);
        if (!profile) return next(apiError(401, 'UNAUTHENTICATED', 'Test profile was not found.'));
        req.user = profile;
        return next();
      }

      const header = req.header('authorization') || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : null;
      if (!token) {
        return next(apiError(401, 'UNAUTHENTICATED', 'Authentication is required.'));
      }

      const payload = await decodeJwtForConfiguredMode(token);
      const profile = await findProfileForAuth(db, payload);
      if (!profile) {
        return next(apiError(401, 'PROFILE_NOT_FOUND', 'No FoodQueue profile exists for this authenticated user.'));
      }
      req.user = profile;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(apiError(403, 'FORBIDDEN', 'You are not authorized to perform this action.'));
    }
    return next();
  };
}

async function requireCanteenMember(db, req, canteenId) {
  if (req.user.role === 'admin') return true;
  const member = await db.get(
    'SELECT * FROM canteen_members WHERE canteen_id = ? AND profile_id = ?',
    [canteenId, req.user.id]
  );
  if (!member) {
    throw apiError(403, 'FORBIDDEN', 'You are not authorized for this canteen.');
  }
  return true;
}

module.exports = {
  apiError,
  decodeJwtForConfiguredMode,
  requireAuth,
  requireCanteenMember,
  requireRole
};
