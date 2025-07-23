#!/usr/bin/env node

/**
 * Test User Creation in PostgreSQL
 * Creates a test user and verifies it's stored in the database
 */

import { getUserService } from './src/auth/DatabaseUserService.js'

async function testUserCreation() {
  console.log('🧪 Testing user creation in PostgreSQL...\n')
  
  try {
    const userService = getUserService()
    await userService.initialize()
    
    console.log('✅ Database service initialized')
    
    // Create a test user
    const timestamp = Date.now()
    const testUser = {
      username: `testuser_${timestamp}`,
      email: `test_${timestamp}@example.com`,
      password: 'testpassword123',
      permissions: ['read', 'write'],
      profile: { role: 'test_user', created_by: 'test_script' }
    }
    
    console.log('📝 Creating test user...')
    const createdUser = await userService.createUser(testUser)
    console.log('✅ Test user created:', {
      id: createdUser.id,
      username: createdUser.username,
      email: createdUser.email,
      permissions: createdUser.permissions,
      active: createdUser.is_active
    })
    
    // Test authentication
    console.log('\n🔐 Testing authentication...')
    const authenticatedUser = await userService.authenticateUser(testUser.username, 'testpassword123')
    
    if (authenticatedUser) {
      console.log('✅ Authentication successful for test user')
      console.log('   User ID:', authenticatedUser.id)
      console.log('   Username:', authenticatedUser.username)
      console.log('   Permissions:', authenticatedUser.permissions)
    } else {
      console.log('❌ Authentication failed for test user')
    }
    
    // Test password change
    console.log('\n🔄 Testing password change...')
    const passwordChanged = await userService.changePassword(createdUser.id, 'testpassword123', 'newpassword456')
    
    if (passwordChanged) {
      console.log('✅ Password change successful')
      
      // Verify new password works
      const authWithNewPassword = await userService.authenticateUser(testUser.username, 'newpassword456')
      if (authWithNewPassword) {
        console.log('✅ Authentication with new password successful')
      } else {
        console.log('❌ Authentication with new password failed')
      }
    } else {
      console.log('❌ Password change failed')
    }
    
    // List all users
    console.log('\n👥 Listing all users...')
    const allUsers = await userService.listUsers(10, 0)
    console.log(`✅ Found ${allUsers.length} users in database:`)
    allUsers.forEach(user => {
      console.log(`   - ${user.username} (${user.email || 'no email'}) - ${user.is_active ? 'Active' : 'Inactive'}`)
    })
    
    // Clean up test user
    console.log('\n🧹 Cleaning up test user...')
    await userService.deleteUser(testUser.username)
    console.log('✅ Test user deleted')
    
  } catch (error) {
    console.error('❌ Test failed:', error.message)
    console.error(error.stack)
  }
}

testUserCreation()
  .then(() => {
    console.log('\n🎉 User creation test completed successfully!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n💥 User creation test failed:', error.message)
    process.exit(1)
  })
