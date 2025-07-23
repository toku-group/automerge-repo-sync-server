import jwt from 'jsonwebtoken'
import crypto from 'crypto'

/**
 * JWT Authentication utilities for automerge sync server
 */

// Get JWT secret from environment or generate a secure one
const JWT_SECRET = process.env.JWT_SECRET || (() => {
  console.warn('JWT_SECRET not set in environment. Generating a random secret for this session.')
  console.warn('⚠️  IMPORTANT: Set JWT_SECRET in production to maintain session persistence!')
  return crypto.randomBytes(64).toString('hex')
})()

const JWT_EXPIRY = process.env.JWT_EXPIRY || '24h'
const JWT_REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '7d'

/**
 * Generate an access token for a user
 * @param {Object} user - User object
 * @param {string} user.id - User ID
 * @param {string} user.username - Username
 * @param {string[]} [user.permissions] - User permissions
 * @returns {string} JWT token
 */
export function generateAccessToken(user) {
  const payload = {
    sub: user.id,
    username: user.username,
    permissions: user.permissions || ['read', 'write'],
    type: 'access',
    iat: Math.floor(Date.now() / 1000)
  }
  
  return jwt.sign(payload, JWT_SECRET, { 
    expiresIn: JWT_EXPIRY,
    issuer: 'automerge-sync-server',
    audience: 'automerge-clients'
  })
}

/**
 * Generate a refresh token for a user
 * @param {Object} user - User object
 * @returns {string} JWT refresh token
 */
export function generateRefreshToken(user) {
  const payload = {
    sub: user.id,
    username: user.username,
    type: 'refresh',
    iat: Math.floor(Date.now() / 1000)
  }
  
  return jwt.sign(payload, JWT_SECRET, { 
    expiresIn: JWT_REFRESH_EXPIRY,
    issuer: 'automerge-sync-server',
    audience: 'automerge-clients'
  })
}

/**
 * Verify and decode a JWT token
 * @param {string} token - JWT token to verify
 * @returns {Object|null} Decoded token payload or null if invalid
 */
export function verifyToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: 'automerge-sync-server',
      audience: 'automerge-clients'
    })
    
    return decoded
  } catch (error) {
    console.warn('JWT verification failed:', error.message)
    return null
  }
}

/**
 * Extract token from Authorization header
 * @param {string} authHeader - Authorization header value
 * @returns {string|null} Token or null if not found
 */
export function extractToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }
  
  return authHeader.substring(7) // Remove 'Bearer ' prefix
}

/**
 * Check if user has required permission
 * @param {Object} user - Decoded JWT payload
 * @param {string} permission - Required permission
 * @returns {boolean} True if user has permission
 */
export function hasPermission(user, permission) {
  if (!user || !user.permissions) {
    return false
  }
  
  // Admin users have all permissions
  if (user.permissions.includes('admin')) {
    return true
  }
  
  return user.permissions.includes(permission)
}

/**
 * Middleware to authenticate JWT tokens
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
export function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization
  const token = extractToken(authHeader)
  
  if (!token) {
    return res.status(401).json({ 
      error: 'Access token required',
      code: 'MISSING_TOKEN'
    })
  }
  
  const decoded = verifyToken(token)
  if (!decoded) {
    return res.status(401).json({ 
      error: 'Invalid or expired token',
      code: 'INVALID_TOKEN'
    })
  }
  
  if (decoded.type !== 'access') {
    return res.status(401).json({ 
      error: 'Invalid token type',
      code: 'INVALID_TOKEN_TYPE'
    })
  }
  
  // Attach user info to request
  req.user = decoded
  next()
}

/**
 * Middleware to require specific permission
 * @param {string} permission - Required permission
 * @returns {Function} Express middleware function
 */
export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Authentication required',
        code: 'NOT_AUTHENTICATED'
      })
    }
    
    if (!hasPermission(req.user, permission)) {
      return res.status(403).json({ 
        error: `Permission '${permission}' required`,
        code: 'INSUFFICIENT_PERMISSIONS'
      })
    }
    
    next()
  }
}

/**
 * Authenticate WebSocket connection
 * @param {string} token - JWT token from WebSocket
 * @returns {Object|null} User info or null if authentication fails
 */
export function authenticateWebSocket(token) {
  if (!token) {
    return null
  }
  
  const decoded = verifyToken(token)
  if (!decoded || decoded.type !== 'access') {
    return null
  }
  
  return decoded
}
