#!/usr/bin/env node

import { getDatabaseService } from '../src/database/DatabaseService.js'
import { getUserService } from '../src/auth/DatabaseUserService.js'

/**
 * Database setup script for devcontainer
 * Initializes the database schema and creates default users
 */

async function setupDatabase() {
  console.log('🔧 Setting up PostgreSQL database for development...')
  console.log('=' .repeat(60))

  try {
    // Wait for PostgreSQL to be ready with retries
    console.log('⏳ Waiting for PostgreSQL to be ready...')
    
    let retries = 10
    let dbService = null
    let dbInitialized = false
    
    while (retries > 0 && !dbInitialized) {
      try {
        dbService = getDatabaseService()
        dbInitialized = await dbService.initialize()
        if (dbInitialized) break
      } catch (error) {
        console.log(`   Attempt ${11 - retries}/10 failed: ${error.message}`)
      }
      
      retries--
      if (retries > 0) {
        console.log(`   Retrying in 3 seconds... (${retries} attempts left)`)
        await new Promise(resolve => setTimeout(resolve, 3000))
      }
    }
    
    if (!dbInitialized) {
      console.log('❌ Failed to initialize database service after multiple attempts')
      console.log('   This is expected if PostgreSQL is not running or not ready yet')
      console.log('   The server will fall back to file-based authentication')
      process.exit(0) // Exit gracefully, not an error
    }
    
    console.log('✅ Database service initialized')

    // Test database connection
    console.log('🔗 Testing database connection...')
    const health = await dbService.healthCheck()
    console.log('📊 Database health:', health.status)
    
    if (health.status !== 'healthy') {
      console.error('❌ Database health check failed')
      process.exit(1)
    }

    // Initialize user service
    console.log('👤 Initializing user service...')
    const userService = getUserService()
    const userServiceReady = await userService.initialize()
    
    if (!userServiceReady) {
      console.error('❌ Failed to initialize user service')
      process.exit(1)
    }
    
    console.log('✅ User service initialized')

    // Check if admin user already exists
    console.log('🔍 Checking for existing admin user...')
    const existingAdmin = await userService.getUserByUsername('admin')
    
    if (existingAdmin) {
      console.log('ℹ️  Admin user already exists')
    } else {
      // Create default admin user
      console.log('👑 Creating default admin user...')
      const adminUser = await userService.createUser({
        username: 'admin',
        email: 'admin@localhost',
        password: 'admin123',
        permissions: ['admin', 'read', 'write', 'delete'],
        profile: { 
          role: 'administrator', 
          created_by: 'setup_script',
          description: 'Default development admin user'
        }
      })
      console.log('✅ Admin user created:', adminUser.username)
    }

    // Create a test user for development
    console.log('🧪 Creating test user...')
    try {
      const testUser = await userService.createUser({
        username: 'testuser',
        email: 'test@localhost',
        password: 'test123',
        permissions: ['read', 'write'],
        profile: { 
          role: 'developer', 
          created_by: 'setup_script',
          description: 'Test user for development'
        }
      })
      console.log('✅ Test user created:', testUser.username)
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log('ℹ️  Test user already exists')
      } else {
        console.log('⚠️  Failed to create test user:', error.message)
      }
    }

    // Show current users
    console.log('📋 Current users in database:')
    const users = await userService.listUsers(10, 0)
    users.forEach(user => {
      console.log(`   - ${user.username} (${user.permissions.join(', ')}) - ${user.email || 'no email'}`)
    })

    // Show statistics
    console.log('📊 Authentication statistics:')
    try {
      const stats = await userService.getAuthStats(30)
      console.log(`   - Total events in last 30 days: ${stats.length}`)
    } catch (error) {
      console.log('   - No statistics available yet')
    }

    // Clean up
    if (dbService) {
      await dbService.close()
    }
    
    console.log('')
    console.log('🎉 Database setup completed successfully!')
    console.log('')
    console.log('📝 Development credentials:')
    console.log('   Admin - Username: admin, Password: admin123')
    console.log('   Test  - Username: testuser, Password: test123')
    console.log('')
    console.log('🚀 Ready to start the server with: npm start')
    
  } catch (error) {
    console.error('❌ Database setup failed:', error.message)
    console.log('')
    console.log('🔧 This is not necessarily an error - the setup will be tried again')
    console.log('   when the server starts. Common reasons:')
    console.log('   1. PostgreSQL container is still starting up')
    console.log('   2. Network connections are still being established')
    console.log('   3. Database is not yet ready to accept connections')
    console.log('')
    console.log('📁 The server will automatically fall back to file-based storage')
    console.log('   if PostgreSQL is not available.')
    
    // Exit gracefully - this is not a hard error
    process.exit(0)
  }
}

// Run setup if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  setupDatabase()
}
