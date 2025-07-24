#!/usr/bin/env node

/**
 * Authentication Tests
 * 
 * Consolidates authentication testing functionality including:
 * - JWT token generation and validation
 * - Login/logout flows
 * - Protected endpoint access
 * - WebSocket authentication
 * - Token refresh
 */

const BASE_URL = process.env.TEST_SERVER_URL || 'http://localhost:3030'

class AuthenticationTests {
  constructor() {
    this.results = { passed: 0, failed: 0, tests: [] }
    this.tokens = {}
  }

  log(message, level = 'info') {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0]
    const prefix = {
      'info': '📋',
      'success': '✅',
      'error': '❌',
      'warning': '⚠️'
    }[level] || '📋'
    console.log(`${prefix} [${timestamp}] ${message}`)
  }

  async runTest(testName, testFunction) {
    this.log(`Running ${testName}...`, 'info')
    const startTime = Date.now()
    
    try {
      await testFunction()
      const duration = Date.now() - startTime
      this.log(`${testName} passed (${duration}ms)`, 'success')
      this.results.passed++
      this.results.tests.push({ name: testName, status: 'passed', duration })
    } catch (error) {
      const duration = Date.now() - startTime
      this.log(`${testName} failed: ${error.message}`, 'error')
      this.results.failed++
      this.results.tests.push({ name: testName, status: 'failed', duration, error: error.message })
    }
  }

  async makeRequest(endpoint, options = {}) {
    const url = `${BASE_URL}${endpoint}`
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    })
    
    const contentType = response.headers.get('content-type')
    let data
    
    if (contentType?.includes('application/json')) {
      data = await response.json()
    } else {
      data = await response.text()
    }
    
    return { status: response.status, ok: response.ok, data, headers: response.headers }
  }

  // ==================== BASIC AUTH TESTS ====================

  async testLoginWithValidCredentials() {
    const response = await this.makeRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: 'admin',
        password: 'admin234'
      })
    })

    if (!response.ok) {
      throw new Error(`Login failed with status ${response.status}: ${JSON.stringify(response.data)}`)
    }

    if (!response.data.accessToken || !response.data.refreshToken) {
      throw new Error('Login response missing required tokens')
    }

    if (!response.data.user || !response.data.user.username) {
      throw new Error('Login response missing user information')
    }

    // Store tokens for later tests
    this.tokens.access = response.data.accessToken
    this.tokens.refresh = response.data.refreshToken
  }

  async testLoginWithInvalidCredentials() {
    const response = await this.makeRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: 'admin',
        password: 'wrongpassword'
      })
    })

    if (response.status !== 401) {
      throw new Error(`Expected 401 for invalid credentials, got ${response.status}`)
    }

    if (!response.data.code || response.data.code !== 'INVALID_CREDENTIALS') {
      throw new Error('Expected INVALID_CREDENTIALS error code')
    }
  }

  async testLoginWithMissingCredentials() {
    // Test missing username
    const missingUsernameResponse = await this.makeRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        password: 'admin234'
      })
    })

    if (missingUsernameResponse.status !== 400) {
      throw new Error(`Expected 400 for missing username, got ${missingUsernameResponse.status}`)
    }

    // Test missing password
    const missingPasswordResponse = await this.makeRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: 'admin'
      })
    })

    if (missingPasswordResponse.status !== 400) {
      throw new Error(`Expected 400 for missing password, got ${missingPasswordResponse.status}`)
    }
  }

  // ==================== TOKEN VALIDATION TESTS ====================

  async testAccessTokenValidation() {
    if (!this.tokens.access) {
      throw new Error('No access token available for testing')
    }

    const response = await this.makeRequest('/api/projects', {
      headers: {
        'Authorization': `Bearer ${this.tokens.access}`
      }
    })

    if (!response.ok) {
      throw new Error(`Valid token rejected with status ${response.status}: ${JSON.stringify(response.data)}`)
    }
  }

  async testInvalidAccessToken() {
    const response = await this.makeRequest('/api/projects', {
      headers: {
        'Authorization': 'Bearer invalid-token-here'
      }
    })

    if (response.status !== 401) {
      throw new Error(`Expected 401 for invalid token, got ${response.status}`)
    }

    if (!response.data.code || response.data.code !== 'INVALID_TOKEN') {
      throw new Error('Expected INVALID_TOKEN error code')
    }
  }

  async testMissingAuthorizationHeader() {
    const response = await this.makeRequest('/api/projects')

    if (response.status !== 401) {
      throw new Error(`Expected 401 for missing token, got ${response.status}`)
    }

    if (!response.data.code || response.data.code !== 'MISSING_TOKEN') {
      throw new Error('Expected MISSING_TOKEN error code')
    }
  }

  async testMalformedAuthorizationHeader() {
    // Test without "Bearer" prefix
    const noBearerResponse = await this.makeRequest('/api/projects', {
      headers: {
        'Authorization': 'some-token'
      }
    })

    if (noBearerResponse.status !== 401) {
      throw new Error(`Expected 401 for malformed header, got ${noBearerResponse.status}`)
    }

    // Test with empty Bearer value
    const emptyBearerResponse = await this.makeRequest('/api/projects', {
      headers: {
        'Authorization': 'Bearer '
      }
    })

    if (emptyBearerResponse.status !== 401) {
      throw new Error(`Expected 401 for empty Bearer token, got ${emptyBearerResponse.status}`)
    }
  }

  // ==================== TOKEN REFRESH TESTS ====================

  async testTokenRefresh() {
    if (!this.tokens.refresh) {
      throw new Error('No refresh token available for testing')
    }

    const response = await this.makeRequest('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({
        refreshToken: this.tokens.refresh
      })
    })

    if (!response.ok) {
      throw new Error(`Token refresh failed with status ${response.status}: ${JSON.stringify(response.data)}`)
    }

    if (!response.data.accessToken) {
      throw new Error('Token refresh response missing new access token')
    }

    // Update stored token
    this.tokens.access = response.data.accessToken
  }

  async testInvalidRefreshToken() {
    const response = await this.makeRequest('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({
        refreshToken: 'invalid-refresh-token'
      })
    })

    if (response.status !== 401) {
      throw new Error(`Expected 401 for invalid refresh token, got ${response.status}`)
    }
  }

  // ==================== PROTECTED ENDPOINT TESTS ====================

  async testProtectedEndpointAccess() {
    if (!this.tokens.access) {
      throw new Error('No access token available for testing')
    }

    const endpoints = [
      '/api/projects',
      '/api/project/test-project-id',
      '/sync/test-doc-id'
    ]

    for (const endpoint of endpoints) {
      const response = await this.makeRequest(endpoint, {
        headers: {
          'Authorization': `Bearer ${this.tokens.access}`
        }
      })

      // We expect either success or a meaningful error (not 401)
      if (response.status === 401) {
        throw new Error(`Endpoint ${endpoint} rejected valid token`)
      }
    }
  }

  async testProtectedEndpointWithoutAuth() {
    const endpoints = [
      '/api/projects',
      '/sync/test-doc-id'
    ]

    for (const endpoint of endpoints) {
      const response = await this.makeRequest(endpoint)

      if (response.status !== 401) {
        throw new Error(`Endpoint ${endpoint} should require authentication but returned ${response.status}`)
      }
    }
  }

  // ==================== LOGOUT TESTS ====================

  async testLogout() {
    if (!this.tokens.refresh) {
      throw new Error('No refresh token available for logout testing')
    }

    const response = await this.makeRequest('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({
        refreshToken: this.tokens.refresh
      })
    })

    if (!response.ok) {
      throw new Error(`Logout failed with status ${response.status}: ${JSON.stringify(response.data)}`)
    }

    // Verify the refresh token is now invalid
    const refreshResponse = await this.makeRequest('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({
        refreshToken: this.tokens.refresh
      })
    })

    if (refreshResponse.status !== 401) {
      throw new Error('Refresh token should be invalid after logout')
    }
  }

  // ==================== USER MANAGEMENT AUTH TESTS ====================

  async testUserCreationAuth() {
    // Login first to get a valid token
    await this.testLoginWithValidCredentials()

    const newUser = {
      username: `testuser_${Date.now()}`,
      password: 'testpassword123',
      email: `test_${Date.now()}@example.com`
    }

    const response = await this.makeRequest('/api/users', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.tokens.access}`
      },
      body: JSON.stringify(newUser)
    })

    // This might succeed or fail depending on permissions
    // We just want to ensure auth is checked
    if (response.status === 401) {
      throw new Error('User creation endpoint should not reject valid token')
    }
  }

  // ==================== MAIN TEST RUNNER ====================

  async run() {
    this.log('Starting Authentication Tests', 'info')
    this.log(`Testing against: ${BASE_URL}`, 'info')

    try {
      // Check server availability
      const healthResponse = await this.makeRequest('/')
      if (!healthResponse.ok) {
        throw new Error('Server not available for testing')
      }

      // Basic authentication tests
      await this.runTest('Login with Valid Credentials', () => this.testLoginWithValidCredentials())
      await this.runTest('Login with Invalid Credentials', () => this.testLoginWithInvalidCredentials())
      await this.runTest('Login with Missing Credentials', () => this.testLoginWithMissingCredentials())

      // Token validation tests
      await this.runTest('Valid Access Token', () => this.testAccessTokenValidation())
      await this.runTest('Invalid Access Token', () => this.testInvalidAccessToken())
      await this.runTest('Missing Authorization Header', () => this.testMissingAuthorizationHeader())
      await this.runTest('Malformed Authorization Header', () => this.testMalformedAuthorizationHeader())

      // Token refresh tests
      await this.runTest('Token Refresh', () => this.testTokenRefresh())
      await this.runTest('Invalid Refresh Token', () => this.testInvalidRefreshToken())

      // Protected endpoint tests
      await this.runTest('Protected Endpoint Access', () => this.testProtectedEndpointAccess())
      await this.runTest('Protected Endpoint Without Auth', () => this.testProtectedEndpointWithoutAuth())

      // User management auth tests
      await this.runTest('User Creation Auth', () => this.testUserCreationAuth())

      // Logout tests (do this last as it invalidates tokens)
      await this.runTest('Logout', () => this.testLogout())

    } catch (error) {
      this.log(`Test suite failed: ${error.message}`, 'error')
    }

    this.printResults()
  }

  printResults() {
    console.log('\n' + '='.repeat(50))
    console.log('🔐 AUTHENTICATION TEST RESULTS')
    console.log('='.repeat(50))
    console.log(`✅ Passed: ${this.results.passed}`)
    console.log(`❌ Failed: ${this.results.failed}`)
    console.log('')

    if (this.results.tests.length > 0) {
      this.results.tests.forEach(test => {
        const status = test.status === 'passed' ? '✅' : '❌'
        console.log(`  ${status} ${test.name} (${test.duration}ms)`)
        if (test.error) {
          console.log(`      Error: ${test.error}`)
        }
      })
    }

    if (this.results.failed > 0) {
      process.exit(1)
    }
  }
}

// Check if this file is being run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tests = new AuthenticationTests()
  tests.run().catch(error => {
    console.error('❌ Authentication tests failed:', error.message)
    process.exit(1)
  })
}

export { AuthenticationTests }
