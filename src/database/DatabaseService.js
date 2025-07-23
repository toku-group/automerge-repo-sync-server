import pg from 'pg'
import crypto from 'crypto'

/**
 * PostgreSQL Database Service for User Authentication
 * Replaces the JSON file-based user storage with a production-ready database
 */

const { Pool } = pg

export class DatabaseService {
  constructor() {
    // Database connection configuration
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL || this.getDefaultConnectionString(),
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
      connectionTimeoutMillis: 2000, // Return error after 2 seconds if connection could not be established
    })

    // Handle pool errors
    this.pool.on('error', (err) => {
      console.error('Unexpected error on idle database client', err)
    })

    this.isInitialized = false
  }

  /**
   * Get default connection string for development
   */
  getDefaultConnectionString() {
    const host = process.env.DB_HOST || 'localhost'
    const port = process.env.DB_PORT || '5432'
    const database = process.env.DB_NAME || 'automerge_sync'
    const username = process.env.DB_USER || 'postgres'
    const password = process.env.DB_PASSWORD || 'postgres'
    
    return `postgresql://${username}:${password}@${host}:${port}/${database}`
  }

  /**
   * Initialize database connection and create tables if needed
   */
  async initialize() {
    if (this.isInitialized) return

    try {
      // Test connection with timeout
      const client = await Promise.race([
        this.pool.connect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), 5000)
        )
      ])
      
      console.log('✅ Database connection established')
      client.release()

      // Initialize schema if needed
      await this.initializeSchema()
      
      this.isInitialized = true
      console.log('✅ Database service initialized')
    } catch (error) {
      console.error('❌ Database initialization failed:', error.message)
      
      // Fallback to file-based storage if database is not available
      console.log('📁 Falling back to file-based user storage')
      return false
    }
    
    return true
  }

  /**
   * Initialize database schema
   */
  async initializeSchema() {
    const client = await this.pool.connect()
    
    try {
      // Check if tables exist
      const result = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'users'
      `)

      if (result.rows.length === 0) {
        console.log('📊 Creating database schema...')
        
        // Read and execute schema file
        const fs = await import('fs')
        const path = await import('path')
        const schemaPath = path.join(process.cwd(), 'database', 'schema.sql')
        
        if (fs.existsSync(schemaPath)) {
          const schema = fs.readFileSync(schemaPath, 'utf8')
          await client.query(schema)
          console.log('✅ Database schema created')
        } else {
          // Create minimal schema inline
          await this.createMinimalSchema(client)
        }
      }
    } finally {
      client.release()
    }
  }

  /**
   * Create minimal schema if schema.sql file is not found
   */
  async createMinimalSchema(client) {
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
      
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        permissions TEXT[] DEFAULT ARRAY['read', 'write'],
        profile JSONB DEFAULT '{}',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        last_login TIMESTAMP WITH TIME ZONE
      );

      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        revoked_at TIMESTAMP WITH TIME ZONE
      );

      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
    `)
    console.log('✅ Minimal database schema created')
  }

  /**
   * Execute a query with error handling
   */
  async query(text, params = []) {
    const client = await this.pool.connect()
    try {
      const result = await client.query(text, params)
      return result
    } catch (error) {
      console.error('Database query error:', error.message)
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Execute multiple queries in a transaction
   */
  async transaction(queries) {
    const client = await this.pool.connect()
    
    try {
      await client.query('BEGIN')
      
      const results = []
      for (const { text, params = [] } of queries) {
        const result = await client.query(text, params)
        results.push(result)
      }
      
      await client.query('COMMIT')
      return results
    } catch (error) {
      await client.query('ROLLBACK')
      console.error('Transaction error:', error.message)
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Hash password with salt
   */
  hashPassword(password) {
    const salt = crypto.randomBytes(32).toString('hex')
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex')
    return { hash, salt }
  }

  /**
   * Verify password against hash and salt
   */
  verifyPassword(password, hash, salt) {
    const verifyHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex')
    return hash === verifyHash
  }

  /**
   * Log authentication events for security audit
   */
  async logAuthEvent(data) {
    try {
      await this.query(`
        INSERT INTO auth_audit_log (user_id, username, action, success, ip_address, user_agent, details)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        data.userId || null,
        data.username || null,
        data.action,
        data.success,
        data.ipAddress || null,
        data.userAgent || null,
        JSON.stringify(data.details || {})
      ])
    } catch (error) {
      console.error('Failed to log auth event:', error.message)
    }
  }

  /**
   * Cleanup expired tokens and old data
   */
  async cleanup() {
    try {
      const result = await this.query('SELECT cleanup_expired_tokens()')
      const deletedCount = result.rows[0]?.cleanup_expired_tokens || 0
      if (deletedCount > 0) {
        console.log(`🧹 Cleaned up ${deletedCount} expired tokens`)
      }
    } catch (error) {
      console.error('Cleanup error:', error.message)
    }
  }

  /**
   * Close database connections
   */
  async close() {
    await this.pool.end()
    console.log('🔌 Database connections closed')
  }

  /**
   * Health check for database connection
   */
  async healthCheck() {
    try {
      const result = await this.query('SELECT NOW() as current_time')
      return {
        status: 'healthy',
        timestamp: result.rows[0].current_time,
        connections: {
          total: this.pool.totalCount,
          idle: this.pool.idleCount,
          waiting: this.pool.waitingCount
        }
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
let databaseService = null

export function getDatabaseService() {
  if (!databaseService) {
    databaseService = new DatabaseService()
  }
  return databaseService
}
