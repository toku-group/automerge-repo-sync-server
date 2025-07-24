#!/usr/bin/env node

/**
 * Unified Test Suite for Automerge Repo Sync Server
 * 
 * This script consolidates all test functionality into a single, organized test runner.
 * Usage: node test-suite.js [category] [--verbose]
 * 
 * Categories:
 * - all: Run all tests (default)
 * - basic: Server startup and health tests
 * - auth: Authentication and authorization tests
 * - database: Database integration and project management tests
 * - users: User management tests
 * - storage: R2 storage and Automerge sync tests
 * - api: API documentation and error handling tests
 * - mocha: Run Mocha test suite
 */

import { readFileSync } from 'fs'
import { execSync } from 'child_process'

const BASE_URL = 'http://localhost:3030'
const TEST_PORT = '3031'

class TestSuite {
  constructor(options = {}) {
    this.verbose = options.verbose || false
    this.category = options.category || 'all'
    this.results = {
      passed: 0,
      failed: 0,
      skipped: 0,
      tests: []
    }
  }

  log(message, level = 'info') {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0]
    const prefix = {
      'info': '📋',
      'success': '✅',
      'error': '❌',
      'warning': '⚠️',
      'debug': '🔍'
    }[level] || '📋'
    
    console.log(`${prefix} [${timestamp}] ${message}`)
  }

  async runTest(testName, testFunction, category = 'general') {
    if (this.category !== 'all' && this.category !== category) {
      this.results.skipped++
      return
    }

    this.log(`Running ${testName}...`, 'info')
    const startTime = Date.now()
    
    try {
      await testFunction()
      const duration = Date.now() - startTime
      this.log(`${testName} passed (${duration}ms)`, 'success')
      this.results.passed++
      this.results.tests.push({ name: testName, status: 'passed', duration, category })
    } catch (error) {
      const duration = Date.now() - startTime
      this.log(`${testName} failed: ${error.message}`, 'error')
      if (this.verbose) {
        console.error(error.stack)
      }
      this.results.failed++
      this.results.tests.push({ name: testName, status: 'failed', duration, category, error: error.message })
    }
  }

  async makeRequest(endpoint, options = {}) {
    const url = `${BASE_URL}${endpoint}`
    
    if (this.verbose) {
      this.log(`Making ${options.method || 'GET'} request to ${url}`, 'debug')
      if (options.body) {
        this.log(`Request body: ${options.body}`, 'debug')
      }
      if (options.headers) {
        this.log(`Request headers: ${JSON.stringify(options.headers)}`, 'debug')
      }
    }
    
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
    
    if (this.verbose) {
      this.log(`Response status: ${response.status}`, 'debug')
      this.log(`Response data: ${JSON.stringify(data)}`, 'debug')
    }
    
    return { status: response.status, ok: response.ok, data, headers: response.headers }
  }

  async getAuthToken(username = 'admin', password = 'admin234') {
    const response = await this.makeRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    })
    
    if (response.ok && response.data.accessToken) {
      return response.data.accessToken
    }
    
    throw new Error(`Failed to get auth token: ${JSON.stringify(response.data)}`)
  }

  // ==================== BASIC TESTS ====================
  
  async testServerHealth() {
    const response = await this.makeRequest('/')
    if (!response.ok) {
      throw new Error(`Health check failed with status ${response.status}`)
    }
    if (!response.data.includes('automerge-repo-sync-server is running')) {
      throw new Error('Health check response invalid')
    }
  }

  async testWebSocketInfo() {
    const response = await this.makeRequest('/ws-info')
    if (!response.ok) {
      throw new Error(`WebSocket info failed with status ${response.status}`)
    }
    if (!response.data.websocketUrl) {
      throw new Error('WebSocket info missing required fields')
    }
  }

  async testSwaggerUI() {
    const response = await this.makeRequest('/api-docs/')
    if (!response.ok) {
      throw new Error(`Swagger UI not accessible: ${response.status}`)
    }
  }

  async testSwaggerJSON() {
    const response = await this.makeRequest('/api-docs.json')
    if (!response.ok) {
      throw new Error(`Swagger JSON not accessible: ${response.status}`)
    }
    if (!response.data.openapi) {
      throw new Error('Invalid Swagger JSON format')
    }
  }

  // ==================== AUTH TESTS ====================

  async testLoginSuccess() {
    const response = await this.makeRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'admin234' })
    })
    
    if (!response.ok) {
      throw new Error(`Login failed with status ${response.status}`)
    }
    
    if (!response.data.accessToken || !response.data.refreshToken) {
      throw new Error('Login response missing tokens')
    }
  }

  async testLoginFailure() {
    const response = await this.makeRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'wrongpassword' })
    })
    
    if (response.status !== 401) {
      throw new Error(`Expected 401 for invalid credentials, got ${response.status}`)
    }
  }

  async testProtectedEndpointWithoutAuth() {
    const response = await this.makeRequest('/api/projects')
    
    if (response.status !== 401) {
      throw new Error(`Expected 401 for unauth request, got ${response.status}`)
    }
    
    if (!response.data.code || response.data.code !== 'MISSING_TOKEN') {
      throw new Error('Missing expected error code for unauthorized request')
    }
  }

  async testProtectedEndpointWithAuth() {
    const token = await this.getAuthToken()
    const response = await this.makeRequest('/api/projects', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    
    if (!response.ok) {
      throw new Error(`Authenticated request failed with status ${response.status}`)
    }
  }

  // ==================== API TESTS ====================

  async testProjectCRUD() {
    const token = await this.getAuthToken()
    const uniqueId = Date.now() + Math.random().toString(36).substr(2, 9)
    const projectName = `Test Project ${uniqueId}`
    
    if (this.verbose) {
      this.log(`Creating project with name: ${projectName}`, 'debug')
    }
    
    // Create project - try with different approach
    const requestBody = JSON.stringify({
      name: projectName,
      description: 'Test project for CRUD operations'
    })
    
    const createResponse = await fetch(`${BASE_URL}/api/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: requestBody
    })
    
    const createData = await createResponse.json()
    
    if (this.verbose) {
      this.log(`Raw fetch response status: ${createResponse.status}`, 'debug')
      this.log(`Raw fetch response data: ${JSON.stringify(createData)}`, 'debug')
    }
    
    if (createResponse.status !== 201) {
      throw new Error(`Project creation failed: ${createResponse.status} - ${JSON.stringify(createData)}`)
    }
    
    const projectId = createData.id
    
    if (this.verbose) {
      this.log(`Created project with ID: ${projectId}`, 'debug')
    }
    
    // Get project
    const getResponse = await this.makeRequest(`/api/project/${projectId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    
    if (!getResponse.ok) {
      throw new Error(`Project retrieval failed: ${getResponse.status} - ${JSON.stringify(getResponse.data)}`)
    }
    
    // Delete project
    const deleteResponse = await this.makeRequest(`/api/project/${projectId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    })
    
    if (!deleteResponse.ok) {
      throw new Error(`Project deletion failed: ${deleteResponse.status} - ${JSON.stringify(deleteResponse.data)}`)
    }
    
    if (this.verbose) {
      this.log(`Successfully deleted project ${projectId}`, 'debug')
    }
  }

  async testErrorHandling() {
    const token = await this.getAuthToken()
    
    // Test validation error
    const validationResponse = await this.makeRequest('/api/projects', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ description: 'Missing name' })
    })
    
    if (validationResponse.status !== 400) {
      throw new Error(`Expected 400 for validation error, got ${validationResponse.status}`)
    }
    
    if (!validationResponse.data.error || !validationResponse.data.error.includes('required')) {
      throw new Error('Expected validation error message about required field')
    }
    
    // Test invalid UUID (but only if we have a project service)
    const invalidUuidResponse = await this.makeRequest('/api/project/invalid-uuid', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    
    // This might return 503 if project service is not available, or 500 for invalid UUID
    if (invalidUuidResponse.status !== 500 && invalidUuidResponse.status !== 503) {
      throw new Error(`Expected 500 or 503 for invalid UUID, got ${invalidUuidResponse.status}`)
    }
  }

  // ==================== MAIN TEST RUNNER ====================

  async runBasicTests() {
    await this.runTest('Server Health Check', () => this.testServerHealth(), 'basic')
    await this.runTest('WebSocket Info', () => this.testWebSocketInfo(), 'basic')
    await this.runTest('Swagger UI Accessibility', () => this.testSwaggerUI(), 'basic')
    await this.runTest('Swagger JSON Endpoint', () => this.testSwaggerJSON(), 'basic')
  }

  async runAuthTests() {
    await this.runTest('Login Success', () => this.testLoginSuccess(), 'auth')
    await this.runTest('Login Failure', () => this.testLoginFailure(), 'auth')
    await this.runTest('Unauth Access', () => this.testProtectedEndpointWithoutAuth(), 'auth')
    await this.runTest('Auth Access', () => this.testProtectedEndpointWithAuth(), 'auth')
  }

  async runApiTests() {
    await this.runTest('Project CRUD Operations', () => this.testProjectCRUD(), 'api')
    await this.runTest('Error Handling', () => this.testErrorHandling(), 'api')
  }

  async runDatabaseTests() {
    // These would be implemented based on existing database test files
    this.log('Database tests require database connection - run npm run test:db for full database tests', 'warning')
  }

  async runStorageTests() {
    this.log('Storage tests require R2 credentials - run individual storage tests manually', 'warning')
  }

  async runUserTests() {
    this.log('User management tests require database connection - included in database test suite', 'warning')
  }

  async runMochaTests() {
    try {
      this.log('Running Mocha test suite...', 'info')
      execSync('npm test', { stdio: 'inherit' })
      this.log('Mocha tests completed successfully', 'success')
      this.results.passed++
    } catch (error) {
      this.log('Mocha tests failed', 'error')
      this.results.failed++
    }
  }

  async run() {
    this.log(`Starting test suite - Category: ${this.category}`, 'info')
    this.log(`Server URL: ${BASE_URL}`, 'debug')
    
    const startTime = Date.now()
    
    try {
      // Check if server is running
      await this.makeRequest('/')
    } catch (error) {
      this.log('Server not accessible. Please start the server first: npm start', 'error')
      return this.printResults()
    }

    if (this.category === 'all' || this.category === 'basic') {
      this.log('🏃 Running Basic Tests...', 'info')
      await this.runBasicTests()
    }

    if (this.category === 'all' || this.category === 'auth') {
      this.log('🔐 Running Authentication Tests...', 'info')
      await this.runAuthTests()
    }

    if (this.category === 'all' || this.category === 'api') {
      this.log('🌐 Running API Tests...', 'info')
      await this.runApiTests()
    }

    if (this.category === 'all' || this.category === 'database') {
      this.log('🗄️ Running Database Tests...', 'info')
      await this.runDatabaseTests()
    }

    if (this.category === 'all' || this.category === 'storage') {
      this.log('💾 Running Storage Tests...', 'info')
      await this.runStorageTests()
    }

    if (this.category === 'all' || this.category === 'users') {
      this.log('👥 Running User Tests...', 'info')
      await this.runUserTests()
    }

    if (this.category === 'all' || this.category === 'mocha') {
      this.log('🧪 Running Mocha Tests...', 'info')
      await this.runMochaTests()
    }

    const totalTime = Date.now() - startTime
    this.printResults(totalTime)
  }

  printResults(totalTime = 0) {
    console.log('\n' + '='.repeat(60))
    console.log('📊 TEST RESULTS SUMMARY')
    console.log('='.repeat(60))
    console.log(`✅ Passed: ${this.results.passed}`)
    console.log(`❌ Failed: ${this.results.failed}`)
    console.log(`⏭️  Skipped: ${this.results.skipped}`)
    console.log(`⏱️  Total Time: ${totalTime}ms`)
    console.log('')

    if (this.results.tests.length > 0) {
      console.log('📋 Test Details:')
      this.results.tests.forEach(test => {
        const status = test.status === 'passed' ? '✅' : '❌'
        console.log(`  ${status} ${test.name} (${test.duration}ms) [${test.category}]`)
        if (test.error && this.verbose) {
          console.log(`      Error: ${test.error}`)
        }
      })
    }

    if (this.results.failed > 0) {
      console.log('\n❌ Some tests failed. Use --verbose for detailed error information.')
      process.exit(1)
    } else {
      console.log('\n🎉 All tests passed!')
      process.exit(0)
    }
  }
}

// ==================== CLI INTERFACE ====================

function printUsage() {
  console.log(`
Unified Test Suite for Automerge Repo Sync Server

Usage: node test-suite.js [category] [--verbose]

Categories:
  all        Run all available tests (default)
  basic      Server startup and health tests
  auth       Authentication and authorization tests
  database   Database integration tests
  users      User management tests
  storage    R2 storage and sync tests
  api        API documentation and error handling tests
  mocha      Run Mocha test suite

Options:
  --verbose  Show detailed error information
  --help     Show this help message

Examples:
  node test-suite.js                    # Run all tests
  node test-suite.js auth               # Run only auth tests
  node test-suite.js api --verbose      # Run API tests with details
`)
}

// Parse command line arguments
const args = process.argv.slice(2)
const category = args.find(arg => !arg.startsWith('--')) || 'all'
const verbose = args.includes('--verbose')
const help = args.includes('--help')

if (help) {
  printUsage()
  process.exit(0)
}

// Check if fetch is available (Node.js 18+)
if (typeof fetch === 'undefined') {
  console.error('❌ This test suite requires Node.js 18+ with built-in fetch support')
  process.exit(1)
}

// Run the test suite
const testSuite = new TestSuite({ category, verbose })
testSuite.run().catch(error => {
  console.error('❌ Test suite failed:', error.message)
  process.exit(1)
})
