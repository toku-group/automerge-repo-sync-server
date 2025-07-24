import { getDatabaseService } from '../database/DatabaseService.js'

/**
 * PostgreSQL-based User Service
 * Replaces the file-based user management with database operations
 */

export class DatabaseUserService {
  constructor() {
    this.db = getDatabaseService()
    this.isReady = false
  }

  /**
   * Initialize the user service
   */
  async initialize() {
    this.isReady = await this.db.initialize()
    return this.isReady
  }

  /**
   * Create a new user
   */
  async createUser(userData) {
    if (!this.isReady) {
      throw new Error('Database service not initialized')
    }

    const { username, email, password, permissions = ['read', 'write'], profile = {} } = userData
    
    // Hash password
    const { hash, salt } = this.db.hashPassword(password)
    
    try {
      const result = await this.db.query(`
        INSERT INTO users (username, email, password_hash, password_salt, permissions, profile)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, username, email, permissions, profile, is_active, created_at
      `, [username, email, hash, salt, permissions, JSON.stringify(profile)])

      const user = result.rows[0]
      
      // Log successful user creation
      await this.db.logAuthEvent({
        userId: user.id,
        username: user.username,
        action: 'user_created',
        success: true,
        details: { permissions }
      })

      return this.sanitizeUser(user)
    } catch (error) {
      // Log failed user creation
      await this.db.logAuthEvent({
        username,
        action: 'user_creation_failed',
        success: false,
        details: { error: error.message }
      })

      if (error.code === '23505') { // Unique violation
        if (error.constraint === 'users_username_key') {
          throw new Error('Username already exists')
        }
        if (error.constraint === 'users_email_key') {
          throw new Error('Email already exists')
        }
      }
      throw error
    }
  }

  /**
   * Get user by username
   */
  async getUserByUsername(username) {
    if (!this.isReady) {
      throw new Error('Database service not initialized')
    }

    const result = await this.db.query(`
      SELECT id, username, email, password_hash, password_salt, permissions, profile, 
             is_active, created_at, updated_at, last_login
      FROM users 
      WHERE username = $1 AND is_active = true
    `, [username])

    return result.rows[0] || null
  }

  /**
   * Get user by ID
   */
  async getUserById(userId) {
    if (!this.isReady) {
      throw new Error('Database service not initialized')
    }

    const result = await this.db.query(`
      SELECT id, username, email, permissions, profile, is_active, created_at, updated_at, last_login
      FROM users 
      WHERE id = $1 AND is_active = true
    `, [userId])

    return result.rows[0] ? this.sanitizeUser(result.rows[0]) : null
  }

  /**
   * Authenticate user with username and password
   */
  async authenticateUser(username, password, clientInfo = {}) {
    if (!this.isReady) {
      throw new Error('Database service not initialized')
    }

    const user = await this.getUserByUsername(username)
    
    if (!user) {
      await this.db.logAuthEvent({
        username,
        action: 'login_failed',
        success: false,
        ipAddress: clientInfo.ipAddress,
        userAgent: clientInfo.userAgent,
        details: { reason: 'user_not_found' }
      })
      return null
    }

    const isValidPassword = this.db.verifyPassword(password, user.password_hash, user.password_salt)
    
    if (!isValidPassword) {
      await this.db.logAuthEvent({
        userId: user.id,
        username: user.username,
        action: 'login_failed',
        success: false,
        ipAddress: clientInfo.ipAddress,
        userAgent: clientInfo.userAgent,
        details: { reason: 'invalid_password' }
      })
      return null
    }

    // Update last login time
    await this.db.query(`
      UPDATE users 
      SET last_login = NOW(), updated_at = NOW()
      WHERE id = $1
    `, [user.id])

    // Log successful login
    await this.db.logAuthEvent({
      userId: user.id,
      username: user.username,
      action: 'login_success',
      success: true,
      ipAddress: clientInfo.ipAddress,
      userAgent: clientInfo.userAgent
    })

    return this.sanitizeUser(user)
  }

  /**
   * Update user profile
   */
  async updateUser(userId, updates) {
    if (!this.isReady) {
      throw new Error('Database service not initialized')
    }

    const allowedFields = ['email', 'profile', 'permissions']
    const updateFields = []
    const values = []
    let paramCount = 1

    for (const [field, value] of Object.entries(updates)) {
      if (allowedFields.includes(field)) {
        updateFields.push(`${field} = $${paramCount}`)
        values.push(field === 'profile' ? JSON.stringify(value) : value)
        paramCount++
      }
    }

    if (updateFields.length === 0) {
      throw new Error('No valid fields to update')
    }

    updateFields.push(`updated_at = NOW()`)
    values.push(userId)

    const result = await this.db.query(`
      UPDATE users 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount} AND is_active = true
      RETURNING id, username, email, permissions, profile, is_active, created_at, updated_at, last_login
    `, values)

    if (result.rows.length === 0) {
      throw new Error('User not found')
    }

    return this.sanitizeUser(result.rows[0])
  }

  /**
   * Change user password
   */
  async changePassword(userId, currentPassword, newPassword) {
    if (!this.isReady) {
      throw new Error('Database service not initialized')
    }

    // Get current user data
    const user = await this.db.query(`
      SELECT username, password_hash, password_salt
      FROM users 
      WHERE id = $1 AND is_active = true
    `, [userId])

    if (user.rows.length === 0) {
      throw new Error('User not found')
    }

    const userData = user.rows[0]

    // Verify current password
    const isCurrentValid = this.db.verifyPassword(currentPassword, userData.password_hash, userData.password_salt)
    
    if (!isCurrentValid) {
      await this.db.logAuthEvent({
        userId,
        username: userData.username,
        action: 'password_change_failed',
        success: false,
        details: { reason: 'invalid_current_password' }
      })
      throw new Error('Current password is incorrect')
    }

    // Hash new password
    const { hash, salt } = this.db.hashPassword(newPassword)

    // Update password
    await this.db.query(`
      UPDATE users 
      SET password_hash = $1, password_salt = $2, updated_at = NOW()
      WHERE id = $3
    `, [hash, salt, userId])

    // Revoke all existing refresh tokens for security
    await this.revokeAllRefreshTokens(userId)

    // Log password change
    await this.db.logAuthEvent({
      userId,
      username: userData.username,
      action: 'password_changed',
      success: true
    })

    return true
  }

  /**
   * Store refresh token
   */
  async storeRefreshToken(userId, tokenHash, expiresAt) {
    if (!this.isReady) {
      throw new Error('Database service not initialized')
    }

    const result = await this.db.query(`
      INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
      VALUES ($1, $2, $3)
      RETURNING id
    `, [userId, tokenHash, expiresAt])

    return result.rows[0].id
  }

  /**
   * Verify refresh token
   */
  async verifyRefreshToken(tokenHash) {
    if (!this.isReady) {
      throw new Error('Database service not initialized')
    }

    const result = await this.db.query(`
      SELECT rt.id, rt.user_id, rt.expires_at, u.username, u.permissions
      FROM refresh_tokens rt
      JOIN users u ON rt.user_id = u.id
      WHERE rt.token_hash = $1 
        AND rt.expires_at > NOW() 
        AND rt.revoked_at IS NULL
        AND u.is_active = true
    `, [tokenHash])

    return result.rows[0] || null
  }

  /**
   * Revoke refresh token
   */
  async revokeRefreshToken(tokenHash) {
    if (!this.isReady) {
      throw new Error('Database service not initialized')
    }

    await this.db.query(`
      UPDATE refresh_tokens 
      SET revoked_at = NOW()
      WHERE token_hash = $1
    `, [tokenHash])
  }

  /**
   * Revoke all refresh tokens for a user
   */
  async revokeAllRefreshTokens(userId) {
    if (!this.isReady) {
      throw new Error('Database service not initialized')
    }

    await this.db.query(`
      UPDATE refresh_tokens 
      SET revoked_at = NOW()
      WHERE user_id = $1 AND revoked_at IS NULL
    `, [userId])
  }

  /**
   * List all users (admin only)
   */
  async listUsers(limit = 50, offset = 0) {
    if (!this.isReady) {
      throw new Error('Database service not initialized')
    }

    const result = await this.db.query(`
      SELECT id, username, email, permissions, profile, is_active, created_at, updated_at, last_login
      FROM users 
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset])

    return result.rows.map(user => this.sanitizeUser(user))
  }

  /**
   * Deactivate user (soft delete)
   */
  async deactivateUser(userId) {
    if (!this.isReady) {
      throw new Error('Database service not initialized')
    }

    const result = await this.db.query(`
      UPDATE users 
      SET is_active = false, updated_at = NOW()
      WHERE id = $1
      RETURNING username
    `, [userId])

    if (result.rows.length === 0) {
      throw new Error('User not found')
    }

    // Revoke all tokens
    await this.revokeAllRefreshTokens(userId)

    // Log deactivation
    await this.db.logAuthEvent({
      userId,
      username: result.rows[0].username,
      action: 'user_deactivated',
      success: true
    })

    return true
  }

  /**
   * Permanently delete a user from the database
   * WARNING: This action is irreversible and will delete all user data
   */
  async deleteUser(userId) {
    if (!this.isReady) {
      throw new Error('Database service not initialized')
    }

    try {
      // Begin transaction to ensure data consistency
      await this.db.query('BEGIN')

      // Get user info before deletion for logging
      const userResult = await this.db.query(`
        SELECT username, email FROM users WHERE id = $1
      `, [userId])

      if (userResult.rows.length === 0) {
        await this.db.query('ROLLBACK')
        throw new Error('User not found')
      }

      const { username, email } = userResult.rows[0]

      // Delete all related data in correct order (respecting foreign keys)
      
      // 1. Delete refresh tokens
      await this.db.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [userId])
      
      // 2. Delete auth audit logs
      await this.db.query(`DELETE FROM auth_audit_log WHERE user_id = $1`, [userId])
      
      // 3. Delete user sessions
      await this.db.query(`DELETE FROM user_sessions WHERE user_id = $1`, [userId])
      
      // 4. Finally delete the user
      const deleteResult = await this.db.query(`
        DELETE FROM users WHERE id = $1
        RETURNING username
      `, [userId])

      if (deleteResult.rows.length === 0) {
        await this.db.query('ROLLBACK')
        throw new Error('Failed to delete user')
      }

      // Commit transaction
      await this.db.query('COMMIT')

      // Log successful deletion (this will create a new audit entry)
      await this.db.logAuthEvent({
        userId: null, // User no longer exists
        username: username,
        action: 'user_deleted',
        success: true,
        details: { deleted_user: username, deleted_email: email }
      })

      return true
    } catch (error) {
      // Rollback on any error
      await this.db.query('ROLLBACK')
      throw error
    }
  }

  /**
   * Get authentication statistics
   */
  async getAuthStats(days = 7) {
    if (!this.isReady) {
      throw new Error('Database service not initialized')
    }

    const result = await this.db.query(`
      SELECT 
        action,
        success,
        COUNT(*) as count,
        DATE(created_at) as date
      FROM auth_audit_log
      WHERE created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY action, success, DATE(created_at)
      ORDER BY date DESC, action
    `)

    return result.rows
  }

  /**
   * Remove sensitive data from user object
   */
  sanitizeUser(user) {
    if (!user) return null
    
    const { password_hash, password_salt, ...sanitized } = user
    
    // Parse JSON fields if they're strings
    if (typeof sanitized.profile === 'string') {
      sanitized.profile = JSON.parse(sanitized.profile)
    }
    
    return sanitized
  }

  /**
   * Health check
   */
  async healthCheck() {
    if (!this.isReady) {
      return { status: 'not_ready', message: 'Database service not initialized' }
    }

    try {
      const dbHealth = await this.db.healthCheck()
      const userCount = await this.db.query('SELECT COUNT(*) as count FROM users WHERE is_active = true')
      
      return {
        status: 'healthy',
        database: dbHealth,
        activeUsers: parseInt(userCount.rows[0].count)
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message
      }
    }
  }
}

// Singleton instance
let userService = null

export function getUserService() {
  if (!userService) {
    userService = new DatabaseUserService()
  }
  return userService
}

// For backward compatibility with existing code
export default getUserService
