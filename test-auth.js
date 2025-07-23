#!/usr/bin/env node

/**
 * Simple JWT Authentication Test Script
 */

const BASE_URL = 'http://localhost:3030'

async function testAuth() {
  console.log('🧪 JWT Authentication Test Suite\n')

  try {
    console.log('1. Testing health check...')
    const healthResponse = await fetch(`${BASE_URL}/`)
    const healthText = await healthResponse.text()
    console.log(`✅ Health check: ${healthText.trim()}`)
    console.log()

    console.log('2. Testing login...')
    const loginResponse = await fetch(`${BASE_URL}/auth/login`, {
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
      const errorText = await loginResponse.text()
      console.log(`❌ Login failed (${loginResponse.status}): ${errorText}`)
      return
    }

    const loginData = await loginResponse.json()
    console.log('✅ Login successful!')
    console.log(`   User: ${loginData.user.username}`)
    console.log(`   Permissions: ${loginData.user.permissions.join(', ')}`)
    console.log(`   Token expires in: ${loginData.expiresIn}`)
    console.log()

    const accessToken = loginData.accessToken

    console.log('3. Testing protected endpoint - /auth/me...')
    const meResponse = await fetch(`${BASE_URL}/auth/me`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    })

    if (!meResponse.ok) {
      const errorText = await meResponse.text()
      console.log(`❌ /auth/me failed (${meResponse.status}): ${errorText}`)
      return
    }

    const userData = await meResponse.json()
    console.log('✅ /auth/me successful!')
    console.log(`   User: ${userData.username}`)
    console.log(`   ID: ${userData.id}`)
    console.log()

    console.log('4. Testing protected endpoint - /api/projects...')
    const projectsResponse = await fetch(`${BASE_URL}/api/projects`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    })

    if (!projectsResponse.ok) {
      const errorText = await projectsResponse.text()
      console.log(`❌ /api/projects failed (${projectsResponse.status}): ${errorText}`)
      return
    }

    const projectsData = await projectsResponse.json()
    console.log('✅ /api/projects successful!')
    console.log(`   Found ${projectsData.projects.length} projects`)
    console.log()

    console.log('5. Testing unauthorized access...')
    const unauthorizedResponse = await fetch(`${BASE_URL}/api/projects`)
    
    if (unauthorizedResponse.status === 401) {
      console.log('✅ Unauthorized access correctly blocked (401)')
    } else {
      console.log(`❌ Expected 401, got ${unauthorizedResponse.status}`)
    }
    console.log()

    console.log('6. Testing token refresh...')
    const refreshResponse = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        refreshToken: loginData.refreshToken
      })
    })

    if (!refreshResponse.ok) {
      const errorText = await refreshResponse.text()
      console.log(`❌ Token refresh failed (${refreshResponse.status}): ${errorText}`)
      return
    }

    const refreshData = await refreshResponse.json()
    console.log('✅ Token refresh successful!')
    console.log(`   New token expires in: ${refreshData.expiresIn}`)
    console.log()

    console.log('🎉 All tests passed! JWT authentication is working correctly.')

  } catch (error) {
    console.error('❌ Test failed with error:', error.message)
  }
}

// Run tests
testAuth().catch(console.error)
