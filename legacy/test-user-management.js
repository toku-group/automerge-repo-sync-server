#!/usr/bin/env node

/**
 * Test script for user management API endpoints
 * Tests the new list users and delete user functionality
 */

import { getUserService } from './src/auth/DatabaseUserService.js'

async function testUserManagement() {
  console.log('🧪 Testing user management API endpoints...\n')

  try {
    // Initialize database service
    console.log('📝 Initializing database service...')
    const userService = getUserService()
    await userService.initialize()
    console.log('✅ Database service initialized\n')

    // 1. Create a test user to delete
    console.log('👤 Creating a test user for deletion...')
    const testUser = await userService.createUser({
      username: `deletetest_${Date.now()}`,
      email: `deletetest_${Date.now()}@example.com`,
      password: 'testpassword123',
      permissions: ['read', 'write']
    })
    console.log(`✅ Test user created: ${testUser.username} (ID: ${testUser.id})\n`)

    // 2. Login as admin to get JWT token
    console.log('🔐 Authenticating as admin...')
    const loginResponse = await fetch('http://localhost:3030/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: 'admin',
        password: 'admin123'
      })
    })

    if (!loginResponse.ok) {
      throw new Error(`Login failed: ${loginResponse.status}`)
    }

    const loginData = await loginResponse.json()
    const adminToken = loginData.accessToken
    console.log('✅ Admin authentication successful\n')

    // 3. Test listing users
    console.log('📋 Testing user list endpoint...')
    const listResponse = await fetch('http://localhost:3030/auth/users?limit=10', {
      headers: {
        'Authorization': `Bearer ${adminToken}`
      }
    })

    if (!listResponse.ok) {
      throw new Error(`List users failed: ${listResponse.status}`)
    }

    const listData = await listResponse.json()
    console.log(`✅ Found ${listData.users.length} users:`)
    listData.users.forEach(user => {
      console.log(`   - ${user.username} (${user.email || 'no email'}) - ${user.is_active ? 'Active' : 'Inactive'}`)
    })
    console.log(`📊 Pagination: ${listData.pagination.offset + 1}-${Math.min(listData.pagination.offset + listData.pagination.limit, listData.pagination.total)} of ${listData.pagination.total}\n`)

    // 4. Test deleting the test user
    console.log(`🗑️  Testing user deletion for user: ${testUser.username}...`)
    const deleteResponse = await fetch(`http://localhost:3030/auth/users/${testUser.id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${adminToken}`
      }
    })

    if (!deleteResponse.ok) {
      const errorData = await deleteResponse.json()
      throw new Error(`Delete user failed: ${deleteResponse.status} - ${errorData.error}`)
    }

    const deleteData = await deleteResponse.json()
    console.log(`✅ ${deleteData.message}`)
    console.log(`   Deleted user ID: ${deleteData.userId}\n`)

    // 5. Verify user was deleted by trying to get user info
    console.log('🔍 Verifying user was completely removed...')
    const deletedUser = await userService.getUserById(testUser.id)
    if (deletedUser === null) {
      console.log('✅ User successfully removed from database')
    } else {
      console.log('❌ User still exists in database (unexpected):', deletedUser)
    }

    // 6. Test edge cases
    console.log('\n🧪 Testing edge cases...')
    
    // Try to delete non-existent user
    console.log('   Testing deletion of non-existent user...')
    const nonExistentResponse = await fetch('http://localhost:3030/auth/users/00000000-0000-0000-0000-000000000000', {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${adminToken}`
      }
    })
    
    if (nonExistentResponse.status === 404) {
      console.log('   ✅ Correctly returns 404 for non-existent user')
    } else {
      console.log(`   ❌ Unexpected status for non-existent user: ${nonExistentResponse.status}`)
    }

    // Try to delete own account (should be prevented)
    console.log('   Testing self-deletion prevention...')
    const adminUser = await userService.getUserByUsername('admin')
    const selfDeleteResponse = await fetch(`http://localhost:3030/auth/users/${adminUser.id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${adminToken}`
      }
    })
    
    if (selfDeleteResponse.status === 400) {
      const errorData = await selfDeleteResponse.json()
      console.log(`   ✅ Correctly prevents self-deletion: ${errorData.error}`)
    } else {
      console.log(`   ❌ Self-deletion prevention failed with status: ${selfDeleteResponse.status}`)
    }

    // 7. Test permission requirements
    console.log('   Testing permission requirements...')
    
    // Create a non-admin user
    const regularUser = await userService.createUser({
      username: `regular_${Date.now()}`,
      email: `regular_${Date.now()}@example.com`,
      password: 'regularpassword123',
      permissions: ['read', 'write'] // No admin permission
    })

    // Login as regular user
    const regularLoginResponse = await fetch('http://localhost:3030/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: regularUser.username,
        password: 'regularpassword123'
      })
    })

    const regularLoginData = await regularLoginResponse.json()
    const regularToken = regularLoginData.accessToken

    // Try to list users as regular user (should fail)
    const unauthorizedListResponse = await fetch('http://localhost:3030/auth/users', {
      headers: {
        'Authorization': `Bearer ${regularToken}`
      }
    })

    if (unauthorizedListResponse.status === 403) {
      console.log('   ✅ Regular users correctly denied access to list users')
    } else {
      console.log(`   ❌ Regular user unexpectedly allowed to list users: ${unauthorizedListResponse.status}`)
    }

    // Try to delete user as regular user (should fail)
    const unauthorizedDeleteResponse = await fetch(`http://localhost:3030/auth/users/${regularUser.id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${regularToken}`
      }
    })

    if (unauthorizedDeleteResponse.status === 403) {
      console.log('   ✅ Regular users correctly denied access to delete users')
    } else {
      console.log(`   ❌ Regular user unexpectedly allowed to delete users: ${unauthorizedDeleteResponse.status}`)
    }

    // Clean up the regular user
    await userService.deleteUser(regularUser.id)

    console.log('\n🎉 User management API testing completed successfully!')

  } catch (error) {
    console.error('❌ Test failed:', error.message)
    console.error('Full error:', error)
    process.exit(1)
  }
}

// Run the test if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testUserManagement()
}

export { testUserManagement }
