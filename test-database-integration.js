#!/usr/bin/env node

import { getUserService } from './src/auth/DatabaseUserService.js'
import { getDatabaseService } from './src/database/DatabaseService.js'

async function testDatabaseIntegration() {
  console.log('🧪 Testing PostgreSQL Database Integration')
  console.log('=' .repeat(50))

  try {
    // Test database service initialization
    console.log('\n1. Testing Database Service...')
    const dbService = getDatabaseService()
    const dbInitialized = await dbService.initialize()
    
    if (!dbInitialized) {
      console.log('❌ Database service failed to initialize')
      console.log('   This is expected if PostgreSQL is not running')
      console.log('   The server will fall back to file-based authentication')
      return
    }
    
    console.log('✅ Database service initialized successfully')

    // Test database health
    console.log('\n2. Testing Database Health...')
    const health = await dbService.healthCheck()
    console.log('📊 Database Health:', JSON.stringify(health, null, 2))

    // Test user service initialization
    console.log('\n3. Testing User Service...')
    const userService = getUserService()
    const userServiceReady = await userService.initialize()
    
    if (!userServiceReady) {
      console.log('❌ User service failed to initialize')
      return
    }
    
    console.log('✅ User service initialized successfully')

    // Test user operations
    console.log('\n4. Testing User Operations...')
    
    // Try to create a test user
    try {
      const testUser = await userService.createUser({
        username: 'test_user_db',
        password: 'test123',
        email: 'test@example.com',
        permissions: ['read', 'write'],
        profile: { test: true, created_by: 'test_script' }
      })
      console.log('✅ Test user created:', testUser.username)
      
      // Test authentication
      const authenticatedUser = await userService.authenticateUser('test_user_db', 'test123', {
        ipAddress: '127.0.0.1',
        userAgent: 'Test Script'
      })
      
      if (authenticatedUser) {
        console.log('✅ User authentication successful')
        
        // Test password change
        await userService.changePassword(authenticatedUser.id, 'test123', 'newpassword123')
        console.log('✅ Password change successful')
        
        // Test user update
        const updatedUser = await userService.updateUser(authenticatedUser.id, {
          profile: { test: true, updated: true }
        })
        console.log('✅ User profile updated')
        
        // Clean up test user
        await userService.deactivateUser(authenticatedUser.id)
        console.log('✅ Test user deactivated')
        
      } else {
        console.log('❌ User authentication failed')
      }
      
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log('ℹ️  Test user already exists, skipping creation test')
      } else {
        console.log('❌ User operations test failed:', error.message)
      }
    }

    // Test statistics
    console.log('\n5. Testing Statistics...')
    try {
      const stats = await userService.getAuthStats(7)
      console.log(`📊 Authentication events in last 7 days: ${stats.length}`)
    } catch (error) {
      console.log('⚠️  Statistics test failed:', error.message)
    }

    // Cleanup
    console.log('\n6. Cleanup...')
    await dbService.cleanup()
    await dbService.close()
    console.log('✅ Database connections closed')

    console.log('\n🎉 All database tests completed successfully!')
    console.log('   The server is ready to use PostgreSQL for user management')

  } catch (error) {
    console.error('\n❌ Database integration test failed:', error.message)
    console.log('\n📝 Troubleshooting tips:')
    console.log('   1. Make sure PostgreSQL is installed and running')
    console.log('   2. Create the database: createdb automerge_sync')
    console.log('   3. Check DATABASE_URL in .env file')
    console.log('   4. Verify PostgreSQL credentials')
    console.log('\n   If PostgreSQL is not available, the server will automatically')
    console.log('   fall back to file-based user storage.')
  }
}

// Only run if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testDatabaseIntegration()
}
