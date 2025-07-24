#!/usr/bin/env node

/**
 * Test script to verify database error handling in project API endpoints
 */

const BASE_URL = 'http://localhost:3030'

// Test data
let VALID_TOKEN = null
const INVALID_TOKEN = 'invalid.token.here'

async function makeRequest(endpoint, options = {}) {
  try {
    const url = `${BASE_URL}${endpoint}`
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    })
    
    const data = await response.json()
    return {
      status: response.status,
      ok: response.ok,
      data
    }
  } catch (error) {
    return {
      status: 0,
      ok: false,
      error: error.message
    }
  }
}

async function getAuthToken() {
  try {
    const response = await makeRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: 'admin',
        password: 'admin234'
      })
    })
    
    if (response.ok && response.data.accessToken) {
      return response.data.accessToken
    } else {
      console.error('Failed to get auth token:', response)
      return null
    }
  } catch (error) {
    console.error('Error getting auth token:', error)
    return null
  }
}

async function testErrorHandling() {
  console.log('🧪 Testing API error handling...\n')
  
  // First, get a valid auth token
  console.log('Getting authentication token...')
  VALID_TOKEN = await getAuthToken()
  if (!VALID_TOKEN) {
    console.error('❌ Failed to get authentication token. Cannot proceed with tests.')
    return
  }
  console.log('✅ Got authentication token\n')
  
  // Test 1: Missing authentication token
  console.log('Test 1: Missing authentication token')
  const test1 = await makeRequest('/api/projects')
  console.log(`Status: ${test1.status}`)
  console.log(`Response: ${JSON.stringify(test1.data, null, 2)}\n`)
  
  // Test 2: Invalid authentication token
  console.log('Test 2: Invalid authentication token')
  const test2 = await makeRequest('/api/projects', {
    headers: { 'Authorization': `Bearer ${INVALID_TOKEN}` }
  })
  console.log(`Status: ${test2.status}`)
  console.log(`Response: ${JSON.stringify(test2.data, null, 2)}\n`)
  
  // Test 3: Valid request - should work
  console.log('Test 3: Valid request - list projects')
  const test3 = await makeRequest('/api/projects', {
    headers: { 'Authorization': `Bearer ${VALID_TOKEN}` }
  })
  console.log(`Status: ${test3.status}`)
  console.log(`Response: ${JSON.stringify(test3.data, null, 2)}\n`)
  
  // Test 4: Create project with missing data
  console.log('Test 4: Create project with missing name')
  const test4 = await makeRequest('/api/projects', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${VALID_TOKEN}` },
    body: JSON.stringify({ description: 'No name provided' })
  })
  console.log(`Status: ${test4.status}`)
  console.log(`Response: ${JSON.stringify(test4.data, null, 2)}\n`)
  
  // Test 5: Create valid project
  console.log('Test 5: Create valid project')
  const projectData = { 
    name: 'Error Test Project',
    description: 'Testing error handling'
  }
  console.log('Sending data:', JSON.stringify(projectData))
  const test5 = await makeRequest('/api/projects', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${VALID_TOKEN}` },
    body: JSON.stringify(projectData)
  })
  console.log(`Status: ${test5.status}`)
  console.log(`Response: ${JSON.stringify(test5.data, null, 2)}\n`)
  
  // Test 6: Try to create duplicate project (using the same name)
  console.log('Test 6: Create duplicate project (should fail)')
  const test6 = await makeRequest('/api/projects', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${VALID_TOKEN}` },
    body: JSON.stringify({ 
      name: 'Error Test Project',
      description: 'Duplicate project'
    })
  })
  console.log(`Status: ${test6.status}`)
  console.log(`Response: ${JSON.stringify(test6.data, null, 2)}\n`)
  
  // Test 7: Get non-existent project (valid UUID format)
  console.log('Test 7: Get non-existent project')
  const test7 = await makeRequest('/api/project/00000000-0000-0000-0000-000000000000', {
    headers: { 'Authorization': `Bearer ${VALID_TOKEN}` }
  })
  console.log(`Status: ${test7.status}`)
  console.log(`Response: ${JSON.stringify(test7.data, null, 2)}\n`)
  
  // Test 8: Delete non-existent project (valid UUID format)
  console.log('Test 8: Delete non-existent project')
  const test8 = await makeRequest('/api/project/00000000-0000-0000-0000-000000000000', {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${VALID_TOKEN}` }
  })
  console.log(`Status: ${test8.status}`)
  console.log(`Response: ${JSON.stringify(test8.data, null, 2)}\n`)
  
  // Test 9: Invalid UUID format
  console.log('Test 9: Invalid UUID format')
  const test9 = await makeRequest('/api/project/invalid-uuid-format', {
    headers: { 'Authorization': `Bearer ${VALID_TOKEN}` }
  })
  console.log(`Status: ${test9.status}`)
  console.log(`Response: ${JSON.stringify(test9.data, null, 2)}\n`)
  
  console.log('✅ Error handling tests completed!')
}

// Check if fetch is available (Node.js 18+)
if (typeof fetch === 'undefined') {
  console.error('❌ This script requires Node.js 18+ with built-in fetch support')
  process.exit(1)
}

testErrorHandling().catch(error => {
  console.error('❌ Test failed:', error)
  process.exit(1)
})
