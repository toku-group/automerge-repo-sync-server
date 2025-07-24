#!/usr/bin/env node

/**
 * API Tests
 * 
 * Consolidates API testing functionality including:
 * - API documentation endpoints
 * - Error response validation
 * - CRUD operations
 * - Input validation
 * - Response format validation
 */

const BASE_URL = process.env.TEST_SERVER_URL || 'http://localhost:3030'

class APITests {
  constructor() {
    this.results = { passed: 0, failed: 0, tests: [] }
    this.authToken = null
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

  async getAuthToken() {
    if (this.authToken) return this.authToken

    const response = await this.makeRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: 'admin',
        password: 'admin234'
      })
    })
    
    if (!response.ok) {
      throw new Error('Failed to get authentication token')
    }
    
    this.authToken = response.data.accessToken
    return this.authToken
  }

  // ==================== API DOCUMENTATION TESTS ====================

  async testSwaggerUIAccessibility() {
    const response = await this.makeRequest('/api-docs/')
    
    if (!response.ok) {
      throw new Error(`Swagger UI not accessible: ${response.status}`)
    }
    
    if (!response.data.includes('swagger-ui')) {
      throw new Error('Response does not appear to be Swagger UI')
    }
  }

  async testSwaggerJSONSchema() {
    const response = await this.makeRequest('/api-docs.json')
    
    if (!response.ok) {
      throw new Error(`Swagger JSON not accessible: ${response.status}`)
    }
    
    const schema = response.data
    
    // Validate basic OpenAPI structure
    if (!schema.openapi) {
      throw new Error('Missing OpenAPI version')
    }
    
    if (!schema.info || !schema.info.title) {
      throw new Error('Missing API info')
    }
    
    if (!schema.paths) {
      throw new Error('Missing API paths')
    }
    
    // Check for required endpoints
    const requiredPaths = ['/auth/login', '/api/projects', '/sync/{documentId}']
    for (const path of requiredPaths) {
      if (!schema.paths[path]) {
        throw new Error(`Missing required path: ${path}`)
      }
    }
    
    // Check for error schemas
    const errorSchemas = ['Error', 'DatabaseError', 'ValidationError', 'ConflictError', 'AuthenticationError']
    for (const schemaName of errorSchemas) {
      if (!schema.components?.schemas?.[schemaName]) {
        throw new Error(`Missing error schema: ${schemaName}`)
      }
    }
  }

  async testAPIDocumentationCompleteness() {
    const response = await this.makeRequest('/api-docs.json')
    
    if (!response.ok) {
      throw new Error('Failed to fetch API documentation')
    }
    
    const schema = response.data
    
    // Check that all endpoints have proper error responses documented
    const paths = schema.paths
    for (const [pathName, pathObject] of Object.entries(paths)) {
      for (const [method, methodObject] of Object.entries(pathObject)) {
        if (typeof methodObject !== 'object' || !methodObject.responses) continue
        
        // Protected endpoints should have 401 responses
        if (pathName.startsWith('/api/') || pathName.startsWith('/sync/')) {
          if (!methodObject.responses['401']) {
            throw new Error(`Missing 401 response for ${method.toUpperCase()} ${pathName}`)
          }
        }
        
        // All endpoints should have 500 responses
        if (!methodObject.responses['500']) {
          throw new Error(`Missing 500 response for ${method.toUpperCase()} ${pathName}`)
        }
      }
    }
  }

  // ==================== ERROR RESPONSE TESTS ====================

  async testValidationErrorResponse() {
    const token = await this.getAuthToken()
    
    // Test missing required field
    const response = await this.makeRequest('/api/projects', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        description: 'Missing name field'
      })
    })
    
    if (response.status !== 400) {
      throw new Error(`Expected 400 for validation error, got ${response.status}`)
    }
    
    // Validate error response structure
    const error = response.data
    if (!error.error) {
      throw new Error('Validation error response missing error field')
    }
    
    if (!error.error.includes('required')) {
      throw new Error('Validation error should mention required field')
    }
  }

  async testDatabaseErrorResponse() {
    const token = await this.getAuthToken()
    
    // Test with invalid UUID to trigger database error
    const response = await this.makeRequest('/api/project/invalid-uuid-format', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
    
    // This might return 503 if project service is unavailable, or 500 for database error
    if (response.status !== 500 && response.status !== 503) {
      throw new Error(`Expected 500 or 503 for database/service error, got ${response.status}`)
    }
    
    // Validate error response structure
    const error = response.data
    if (!error.error) {
      throw new Error('Database error response missing error field')
    }
  }

  async testAuthenticationErrorResponse() {
    // Test without token
    const response = await this.makeRequest('/api/projects')
    
    if (response.status !== 401) {
      throw new Error(`Expected 401 for auth error, got ${response.status}`)
    }
    
    // Validate error response structure
    const error = response.data
    if (!error.code || !error.message || !error.timestamp) {
      throw new Error('Auth error response missing required fields')
    }
    
    if (error.code !== 'MISSING_TOKEN') {
      throw new Error(`Expected MISSING_TOKEN code, got ${error.code}`)
    }
  }

  async testNotFoundErrorResponse() {
    const token = await this.getAuthToken()
    
    // Test with non-existent project UUID
    const nonExistentUUID = '550e8400-e29b-41d4-a716-446655440000'
    const response = await this.makeRequest(`/api/project/${nonExistentUUID}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
    
    if (response.status !== 404) {
      throw new Error(`Expected 404 for not found, got ${response.status}`)
    }
    
    // Validate error response structure
    const error = response.data
    if (!error.code || !error.message || !error.timestamp) {
      throw new Error('Not found error response missing required fields')
    }
  }

  // ==================== PROJECT API TESTS ====================

  async testProjectListAPI() {
    const token = await this.getAuthToken()
    
    const response = await this.makeRequest('/api/projects', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
    
    if (!response.ok) {
      throw new Error(`Project list failed: ${response.status} - ${JSON.stringify(response.data)}`)
    }
    
    // Should return an array
    if (!Array.isArray(response.data)) {
      throw new Error('Project list should return an array')
    }
    
    // Validate project structure if any projects exist
    if (response.data.length > 0) {
      const project = response.data[0]
      const requiredFields = ['id', 'name', 'created_at']
      for (const field of requiredFields) {
        if (!(field in project)) {
          throw new Error(`Project missing required field: ${field}`)
        }
      }
    }
  }

  async testProjectCreationAPI() {
    const token = await this.getAuthToken()
    
    const projectData = {
      name: `API Test Project ${Date.now()}`,
      description: 'Test project created via API'
    }
    
    const response = await this.makeRequest('/api/projects', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(projectData)
    })
    
    if (response.status !== 201) {
      throw new Error(`Project creation failed: ${response.status} - ${JSON.stringify(response.data)}`)
    }
    
    const project = response.data
    
    // Validate response structure
    const requiredFields = ['id', 'name', 'description', 'created_at']
    for (const field of requiredFields) {
      if (!(field in project)) {
        throw new Error(`Created project missing required field: ${field}`)
      }
    }
    
    if (project.name !== projectData.name) {
      throw new Error('Created project name does not match input')
    }
    
    // Clean up - delete the test project
    await this.makeRequest(`/api/project/${project.id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
  }

  async testProjectValidationAPI() {
    const token = await this.getAuthToken()
    
    const invalidProjectData = [
      { description: 'Missing name' },
      { name: '' }, // Empty name
      {} // Empty object
    ]
    
    for (const invalidData of invalidProjectData) {
      const response = await this.makeRequest('/api/projects', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(invalidData)
      })
      
      if (response.status !== 400) {
        throw new Error(`Expected 400 for invalid data: ${JSON.stringify(invalidData)}, got ${response.status}`)
      }
      
      if (!response.data.error || !response.data.error.includes('required')) {
        throw new Error('Invalid data should return error about required field')
      }
    }
  }

  // ==================== SYNC API TESTS ====================

  async testSyncEndpointAccess() {
    const token = await this.getAuthToken()
    const testDocId = `test-sync-doc-${Date.now()}`
    
    const response = await this.makeRequest(`/sync/${testDocId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
    
    // Should not be 401 (auth error)
    if (response.status === 401) {
      throw new Error('Sync endpoint rejected valid authentication')
    }
  }

  async testSyncWithInvalidDocumentId() {
    const token = await this.getAuthToken()
    
    // Test with invalid characters
    const invalidDocId = 'invalid!@#$%^&*()doc'
    const response = await this.makeRequest(`/sync/${invalidDocId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
    
    // Should handle gracefully (not 500 error)
    if (response.status === 500) {
      this.log('Invalid document ID causes server error - might need improvement', 'warning')
    }
  }

  // ==================== RATE LIMITING TESTS ====================

  async testRateLimiting() {
    this.log('Rate limiting test - making multiple rapid requests...', 'info')
    
    const requests = []
    const numRequests = 20
    
    for (let i = 0; i < numRequests; i++) {
      requests.push(this.makeRequest('/'))
    }
    
    const responses = await Promise.all(requests)
    
    // Check if any requests were rate limited (429 status)
    const rateLimited = responses.filter(r => r.status === 429)
    
    if (rateLimited.length > 0) {
      this.log(`Rate limiting active: ${rateLimited.length}/${numRequests} requests limited`, 'info')
    } else {
      this.log('No rate limiting detected (may not be implemented)', 'warning')
    }
  }

  // ==================== CORS TESTS ====================

  async testCORSHeaders() {
    const response = await this.makeRequest('/', {
      headers: {
        'Origin': 'http://localhost:3000'
      }
    })
    
    const corsHeaders = response.headers.get('access-control-allow-origin')
    
    if (!corsHeaders) {
      this.log('CORS headers not present - may cause browser issues', 'warning')
    } else {
      this.log(`CORS configured: ${corsHeaders}`, 'info')
    }
  }

  // ==================== MAIN TEST RUNNER ====================

  async run() {
    this.log('Starting API Tests', 'info')
    this.log(`Testing against: ${BASE_URL}`, 'info')

    try {
      // Check server availability
      const healthResponse = await this.makeRequest('/')
      if (!healthResponse.ok) {
        throw new Error('Server not available for testing')
      }

      // API Documentation tests
      await this.runTest('Swagger UI Accessibility', () => this.testSwaggerUIAccessibility())
      await this.runTest('Swagger JSON Schema', () => this.testSwaggerJSONSchema())
      await this.runTest('API Documentation Completeness', () => this.testAPIDocumentationCompleteness())

      // Error response tests
      await this.runTest('Validation Error Response', () => this.testValidationErrorResponse())
      await this.runTest('Database Error Response', () => this.testDatabaseErrorResponse())
      await this.runTest('Authentication Error Response', () => this.testAuthenticationErrorResponse())
      await this.runTest('Not Found Error Response', () => this.testNotFoundErrorResponse())

      // Project API tests
      await this.runTest('Project List API', () => this.testProjectListAPI())
      await this.runTest('Project Creation API', () => this.testProjectCreationAPI())
      await this.runTest('Project Validation API', () => this.testProjectValidationAPI())

      // Sync API tests
      await this.runTest('Sync Endpoint Access', () => this.testSyncEndpointAccess())
      await this.runTest('Sync Invalid Document ID', () => this.testSyncWithInvalidDocumentId())

      // Additional API tests
      await this.runTest('Rate Limiting', () => this.testRateLimiting())
      await this.runTest('CORS Headers', () => this.testCORSHeaders())

    } catch (error) {
      this.log(`Test suite failed: ${error.message}`, 'error')
    }

    this.printResults()
  }

  printResults() {
    console.log('\n' + '='.repeat(50))
    console.log('🌐 API TEST RESULTS')
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
  const tests = new APITests()
  tests.run().catch(error => {
    console.error('❌ API tests failed:', error.message)
    process.exit(1)
  })
}

export { APITests }
