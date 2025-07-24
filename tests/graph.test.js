#!/usr/bin/env node

/**
 * Neo4j Graph Database Integration Tests
 * Tests Neo4j connectivity, document watching, and graph analysis APIs
 */

import fetch from 'node-fetch'

// Polyfill fetch for Node.js environments without built-in fetch
if (!globalThis.fetch) {
  globalThis.fetch = fetch
}

const BASE_URL = 'http://localhost:3030'

class GraphTests {
  constructor() {
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
      'info': '📊',
      'success': '✅',
      'error': '❌',
      'warning': '⚠️',
      'debug': '🔍'
    }[level] || '📊'
    
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
    
    try {
      if (contentType?.includes('application/json')) {
        data = await response.json()
      } else {
        data = await response.text()
      }
    } catch (error) {
      data = null
    }
    
    return { status: response.status, ok: response.ok, data, headers: response.headers }
  }

  async getAuthToken() {
    const response = await this.makeRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'admin234' })
    })
    
    if (response.ok && response.data.accessToken) {
      return response.data.accessToken
    }
    
    throw new Error(`Failed to get auth token: ${JSON.stringify(response.data)}`)
  }

  async testGraphStatsEndpoint() {
    const token = await this.getAuthToken()
    const response = await this.makeRequest('/api/graph/stats', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    
    if (response.status === 503) {
      this.log('Neo4j service not available - skipping graph tests', 'warning')
      this.results.skipped++
      return
    }
    
    if (!response.ok) {
      throw new Error(`Graph stats endpoint failed with status ${response.status}`)
    }
    
    if (!response.data.success) {
      throw new Error('Graph stats response missing success field')
    }
    
    const stats = response.data.data
    if (typeof stats.documentCount !== 'number' || typeof stats.totalNodes !== 'number') {
      throw new Error('Graph stats response missing required fields')
    }
    
    this.log(`Graph stats: ${stats.documentCount} documents, ${stats.totalNodes} nodes`, 'debug')
  }

  async testNodeTypesDistribution() {
    const token = await this.getAuthToken()
    const response = await this.makeRequest('/api/graph/nodes/types', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    
    if (response.status === 503) {
      this.results.skipped++
      return
    }
    
    if (!response.ok) {
      throw new Error(`Node types endpoint failed with status ${response.status}`)
    }
    
    if (!response.data.success || !Array.isArray(response.data.data)) {
      throw new Error('Node types response format invalid')
    }
  }

  async testRelationshipPatterns() {
    const token = await this.getAuthToken()
    const response = await this.makeRequest('/api/graph/relationships/patterns', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    
    if (response.status === 503) {
      this.results.skipped++
      return
    }
    
    if (!response.ok) {
      throw new Error(`Relationship patterns endpoint failed with status ${response.status}`)
    }
    
    if (!response.data.success || !Array.isArray(response.data.data)) {
      throw new Error('Relationship patterns response format invalid')
    }
  }

  async testNodeSearch() {
    const token = await this.getAuthToken()
    const response = await this.makeRequest('/api/graph/nodes/search?searchTerm=test&limit=10', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    
    if (response.status === 503) {
      this.results.skipped++
      return
    }
    
    if (!response.ok) {
      throw new Error(`Node search endpoint failed with status ${response.status}`)
    }
    
    if (!response.data.success || !Array.isArray(response.data.data)) {
      throw new Error('Node search response format invalid')
    }
  }

  async testCustomQuery() {
    const token = await this.getAuthToken()
    
    // Test read-only query
    const readQuery = {
      query: 'MATCH (n) RETURN count(n) as nodeCount LIMIT 1',
      parameters: {}
    }
    
    const response = await this.makeRequest('/api/graph/query', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(readQuery)
    })
    
    if (response.status === 503) {
      this.results.skipped++
      return
    }
    
    if (!response.ok) {
      throw new Error(`Custom query endpoint failed with status ${response.status}`)
    }
    
    if (!response.data.success) {
      throw new Error('Custom query response missing success field')
    }
    
    // Test that write queries are rejected
    const writeQuery = {
      query: 'CREATE (n:TestNode) RETURN n',
      parameters: {}
    }
    
    const writeResponse = await this.makeRequest('/api/graph/query', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(writeQuery)
    })
    
    if (writeResponse.status !== 403) {
      throw new Error('Write query should be forbidden but was not rejected')
    }
  }

  async testDocumentAnalysis() {
    const token = await this.getAuthToken()
    
    // First, try to get a list of projects to find a document ID
    const projectsResponse = await this.makeRequest('/api/projects', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    
    let testDocumentId = 'test-document-id'
    
    if (projectsResponse.ok && projectsResponse.data.length > 0) {
      // Use the first available project's first document if available
      const firstProject = projectsResponse.data[0]
      if (firstProject.documents && firstProject.documents.length > 0) {
        testDocumentId = firstProject.documents[0].documentId
      }
    }
    
    const response = await this.makeRequest(`/api/graph/document/${testDocumentId}/analysis`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    
    if (response.status === 503) {
      this.results.skipped++
      return
    }
    
    // It's OK if the document is not found (404), as long as the endpoint is working
    if (response.status !== 404 && !response.ok) {
      throw new Error(`Document analysis endpoint failed with status ${response.status}`)
    }
    
    if (response.ok && !response.data.success) {
      throw new Error('Document analysis response missing success field')
    }
  }

  async testSimilarDocuments() {
    const token = await this.getAuthToken()
    const testDocumentId = 'test-document-id'
    
    const response = await this.makeRequest(`/api/graph/document/${testDocumentId}/similar?limit=5`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    
    if (response.status === 503) {
      this.results.skipped++
      return
    }
    
    // It's OK if no similar documents are found, as long as the endpoint is working
    if (!response.ok) {
      throw new Error(`Similar documents endpoint failed with status ${response.status}`)
    }
    
    if (!response.data.success || !Array.isArray(response.data.data)) {
      throw new Error('Similar documents response format invalid')
    }
  }

  async testDocumentGraphStructure() {
    const token = await this.getAuthToken()
    const testDocumentId = 'test-document-id'
    
    const response = await this.makeRequest(`/api/graph/document/${testDocumentId}/structure?depth=2`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    
    if (response.status === 503) {
      this.results.skipped++
      return
    }
    
    // It's OK if the document is not found, as long as the endpoint is working
    if (!response.ok && response.status !== 404) {
      throw new Error(`Document structure endpoint failed with status ${response.status}`)
    }
    
    if (response.ok && !response.data.success) {
      throw new Error('Document structure response missing success field')
    }
  }

  async testUnauthenticatedAccess() {
    const response = await this.makeRequest('/api/graph/stats')
    
    if (response.status !== 401) {
      throw new Error(`Expected 401 for unauthenticated request, got ${response.status}`)
    }
    
    if (!response.data.code || response.data.code !== 'MISSING_TOKEN') {
      throw new Error('Missing expected error code for unauthorized request')
    }
  }

  async run() {
    this.log('Starting Neo4j Graph Database Tests', 'info')
    this.log(`Server URL: ${BASE_URL}`, 'debug')
    
    const startTime = Date.now()
    
    try {
      // Check if server is running
      await this.makeRequest('/')
    } catch (error) {
      this.log('Server not accessible. Please start the server first: npm start', 'error')
      return this.printResults()
    }

    // Run tests
    await this.runTest('Graph Statistics Endpoint', () => this.testGraphStatsEndpoint())
    await this.runTest('Node Types Distribution', () => this.testNodeTypesDistribution())
    await this.runTest('Relationship Patterns', () => this.testRelationshipPatterns())
    await this.runTest('Node Search', () => this.testNodeSearch())
    await this.runTest('Custom Query Execution', () => this.testCustomQuery())
    await this.runTest('Document Analysis', () => this.testDocumentAnalysis())
    await this.runTest('Similar Documents', () => this.testSimilarDocuments())
    await this.runTest('Document Graph Structure', () => this.testDocumentGraphStructure())
    await this.runTest('Unauthenticated Access Control', () => this.testUnauthenticatedAccess())

    const totalTime = Date.now() - startTime
    this.printResults(totalTime)
  }

  printResults(totalTime = 0) {
    console.log('\n' + '='.repeat(60))
    console.log('📊 NEO4J GRAPH DATABASE TEST RESULTS')
    console.log('='.repeat(60))
    console.log(`✅ Passed: ${this.results.passed}`)
    console.log(`❌ Failed: ${this.results.failed}`)
    console.log(`⏭️  Skipped: ${this.results.skipped}`)
    console.log(`⏱️  Total Time: ${totalTime}ms`)
    console.log('')

    if (this.results.tests.length > 0) {
      console.log('📊 Test Details:')
      this.results.tests.forEach(test => {
        const status = test.status === 'passed' ? '✅' : '❌'
        console.log(`  ${status} ${test.name} (${test.duration}ms)`)
        if (test.error) {
          console.log(`      Error: ${test.error}`)
        }
      })
    }

    if (this.results.skipped > 0) {
      console.log('\n⚠️  Some tests were skipped because Neo4j service is not configured.')
      console.log('   To enable Neo4j integration, set these environment variables:')
      console.log('   NEO4J_URI=bolt://localhost:7687')
      console.log('   NEO4J_USERNAME=neo4j')
      console.log('   NEO4J_PASSWORD=your-password')
    }

    if (this.results.failed > 0) {
      console.log('\n❌ Some graph database tests failed.')
      process.exit(1)
    } else {
      console.log('\n🎉 All Neo4j graph database tests passed!')
      process.exit(0)
    }
  }
}

// Run the tests
const graphTests = new GraphTests()
graphTests.run().catch(error => {
  console.error('❌ Neo4j test suite failed:', error.message)
  process.exit(1)
})
