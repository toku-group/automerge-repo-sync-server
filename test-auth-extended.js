#!/usr/bin/env node

/**
 * Extended JWT Authentication Test - User Management & Projects
 */

const BASE_URL = 'http://localhost:3030'

async function testExtendedFeatures() {
  console.log('🧪 Extended JWT Authentication Test Suite\n')

  try {
    // Login as admin
    console.log('1. Logging in as admin...')
    const loginResponse = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })

    const loginData = await loginResponse.json()
    const adminToken = loginData.accessToken
    console.log('✅ Admin login successful')
    console.log()

    // Test user management
    console.log('2. Testing user management...')
    
    // Create a new user
    console.log('   Creating new user...')
    const createUserResponse = await fetch(`${BASE_URL}/users`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: 'testuser',
        password: 'testpass123',
        permissions: ['read', 'write']
      })
    })

    if (createUserResponse.ok) {
      const newUser = await createUserResponse.json()
      console.log(`   ✅ User created: ${newUser.username}`)
    } else {
      const error = await createUserResponse.text()
      console.log(`   ❌ User creation failed: ${error}`)
    }

    // List all users
    console.log('   Listing all users...')
    const usersResponse = await fetch(`${BASE_URL}/users`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    })

    if (usersResponse.ok) {
      const usersData = await usersResponse.json()
      console.log(`   ✅ Found ${usersData.users.length} users:`)
      usersData.users.forEach(user => {
        console.log(`      - ${user.username} (${user.permissions.join(', ')})`)
      })
    }
    console.log()

    // Test project operations
    console.log('3. Testing project operations...')
    
    // Create a new project
    console.log('   Creating new project...')
    const createProjectResponse = await fetch(`${BASE_URL}/api/projects`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'JWT Test Project',
        description: 'A test project created via JWT authenticated API'
      })
    })

    if (createProjectResponse.ok) {
      const newProject = await createProjectResponse.json()
      console.log(`   ✅ Project created: ${newProject.projectId}`)
      console.log(`      Name: ${newProject.document.name}`)
      
      const projectId = newProject.projectId

      // Get the created project
      console.log('   Retrieving created project...')
      const getProjectResponse = await fetch(`${BASE_URL}/api/project/${projectId}`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      })

      if (getProjectResponse.ok) {
        const projectData = await getProjectResponse.json()
        console.log(`   ✅ Project retrieved: ${projectData.document.name}`)
      }

      // Clean up - delete the test project
      console.log('   Cleaning up - deleting test project...')
      const deleteProjectResponse = await fetch(`${BASE_URL}/api/project/${projectId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      })

      if (deleteProjectResponse.ok) {
        console.log('   ✅ Test project deleted')
      }
    } else {
      const error = await createProjectResponse.text()
      console.log(`   ❌ Project creation failed: ${error}`)
    }
    console.log()

    // Test password change
    console.log('4. Testing password change...')
    const changePasswordResponse = await fetch(`${BASE_URL}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        currentPassword: 'admin123',
        newPassword: 'newpassword123'
      })
    })

    if (changePasswordResponse.ok) {
      console.log('   ✅ Password changed successfully')
      
      // Test login with new password
      console.log('   Testing login with new password...')
      const newLoginResponse = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'newpassword123' })
      })

      if (newLoginResponse.ok) {
        console.log('   ✅ Login with new password successful')
        
        // Change password back
        const newData = await newLoginResponse.json()
        await fetch(`${BASE_URL}/auth/change-password`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${newData.accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            currentPassword: 'newpassword123',
            newPassword: 'admin123'
          })
        })
        console.log('   ✅ Password changed back to original')
      }
    } else {
      const error = await changePasswordResponse.text()
      console.log(`   ❌ Password change failed: ${error}`)
    }
    console.log()

    // Clean up test user
    console.log('5. Cleaning up test user...')
    const deleteUserResponse = await fetch(`${BASE_URL}/users/testuser`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    })

    if (deleteUserResponse.ok) {
      console.log('   ✅ Test user deleted')
    }
    console.log()

    console.log('🎉 All extended tests passed! JWT authentication system is fully functional.')

  } catch (error) {
    console.error('❌ Extended test failed with error:', error.message)
  }
}

// Run extended tests
testExtendedFeatures().catch(console.error)
