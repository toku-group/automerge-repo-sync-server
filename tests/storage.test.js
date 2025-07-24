#!/usr/bin/env node

/**
 * Storage Tests
 * 
 * Consolidates storage testing functionality including:
 * - R2 storage operations
 * - Automerge document sync
 * - Document versioning
 * - Storage error handling
 */

import { R2StorageAdapter } from '../src/storage/R2StorageAdapter.js'

const BASE_URL = process.env.TEST_SERVER_URL || 'http://localhost:3030'

class StorageTests {
  constructor() {
    this.results = { passed: 0, failed: 0, tests: [] }
    this.storage = new R2StorageAdapter()
    this.testDocuments = []
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
    } else if (contentType?.includes('application/octet-stream')) {
      data = await response.arrayBuffer()
    } else {
      data = await response.text()
    }
    
    return { status: response.status, ok: response.ok, data, headers: response.headers }
  }

  async getAuthToken() {
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
    
    return response.data.accessToken
  }

  // ==================== R2 STORAGE TESTS ====================

  async testR2Configuration() {
    // Check if R2 environment variables are set
    const requiredVars = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_ACCESS_KEY_ID', 'CLOUDFLARE_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']
    const missingVars = requiredVars.filter(varName => !process.env[varName])
    
    if (missingVars.length > 0) {
      this.log(`R2 credentials not configured. Missing: ${missingVars.join(', ')}`, 'warning')
      this.log('Skipping R2 tests. Set environment variables to enable R2 testing.', 'warning')
      return
    }

    // Test R2 connection by attempting to list bucket contents
    try {
      const objects = await this.storage.listObjects('test/')
      this.log(`R2 connection successful. Found ${objects.length} test objects`, 'info')
    } catch (error) {
      throw new Error(`R2 connection failed: ${error.message}`)
    }
  }

  async testDocumentStorage() {
    const requiredVars = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_ACCESS_KEY_ID', 'CLOUDFLARE_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']
    const missingVars = requiredVars.filter(varName => !process.env[varName])
    
    if (missingVars.length > 0) {
      this.log('R2 credentials not configured, skipping document storage test', 'warning')
      return
    }

    const testDocId = `test-doc-${Date.now()}`
    const testData = new Uint8Array([1, 2, 3, 4, 5]) // Simple test data
    
    try {
      // Store document
      await this.storage.save(testDocId, testData)
      this.testDocuments.push(testDocId)
      
      // Retrieve document
      const retrievedData = await this.storage.load(testDocId)
      
      if (!retrievedData || retrievedData.length !== testData.length) {
        throw new Error('Retrieved data does not match stored data')
      }
      
      // Compare bytes
      for (let i = 0; i < testData.length; i++) {
        if (retrievedData[i] !== testData[i]) {
          throw new Error(`Data mismatch at byte ${i}: expected ${testData[i]}, got ${retrievedData[i]}`)
        }
      }
      
    } catch (error) {
      throw new Error(`Document storage test failed: ${error.message}`)
    }
  }

  async testDocumentDeletion() {
    const requiredVars = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_ACCESS_KEY_ID', 'CLOUDFLARE_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']
    const missingVars = requiredVars.filter(varName => !process.env[varName])
    
    if (missingVars.length > 0) {
      this.log('R2 credentials not configured, skipping document deletion test', 'warning')
      return
    }

    const testDocId = `test-delete-doc-${Date.now()}`
    const testData = new Uint8Array([6, 7, 8, 9, 10])
    
    try {
      // Store document
      await this.storage.save(testDocId, testData)
      
      // Verify it exists
      const retrievedData = await this.storage.load(testDocId)
      if (!retrievedData) {
        throw new Error('Document was not stored properly')
      }
      
      // Delete document
      await this.storage.delete(testDocId)
      
      // Verify it's deleted
      try {
        await this.storage.load(testDocId)
        throw new Error('Document still exists after deletion')
      } catch (loadError) {
        if (!loadError.message.includes('not found') && !loadError.message.includes('NoSuchKey')) {
          throw loadError
        }
        // Expected error - document should not exist
      }
      
    } catch (error) {
      throw new Error(`Document deletion test failed: ${error.message}`)
    }
  }

  // ==================== AUTOMERGE SYNC TESTS ====================

  async testAutomergeSyncEndpoint() {
    const token = await this.getAuthToken()
    const testDocId = `sync-test-doc-${Date.now()}`
    
    // Test sync endpoint accessibility
    const response = await this.makeRequest(`/sync/${testDocId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
    
    // The exact response depends on implementation, but it should not be 401
    if (response.status === 401) {
      throw new Error('Sync endpoint rejected valid authentication token')
    }
  }

  async testDocumentSnapshot() {
    const token = await this.getAuthToken()
    const testDocId = `snapshot-test-doc-${Date.now()}`
    
    // Test snapshot retrieval
    const response = await this.makeRequest(`/snapshot/${testDocId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
    
    // Should either return a snapshot or a 404 for non-existent document
    if (response.status !== 404 && response.status !== 200) {
      throw new Error(`Unexpected status for snapshot endpoint: ${response.status}`)
    }
  }

  async testDocumentIncremental() {
    const token = await this.getAuthToken()
    const testDocId = `incremental-test-doc-${Date.now()}`
    
    // Test incremental sync
    const response = await this.makeRequest(`/incremental/${testDocId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
    
    // Should either return incremental data or appropriate error
    if (response.status !== 404 && response.status !== 200) {
      throw new Error(`Unexpected status for incremental endpoint: ${response.status}`)
    }
  }

  // ==================== WEBSOCKET TESTS ====================

  async testWebSocketInfo() {
    const response = await this.makeRequest('/ws-info')
    
    if (!response.ok) {
      throw new Error(`WebSocket info endpoint failed: ${response.status}`)
    }
    
    if (!response.data.websocketUrl) {
      throw new Error('WebSocket info missing websocketUrl')
    }
    
    // Validate WebSocket URL format
    const wsUrl = response.data.websocketUrl
    if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) {
      throw new Error(`Invalid WebSocket URL format: ${wsUrl}`)
    }
  }

  // ==================== ERROR HANDLING TESTS ====================

  async testStorageErrorHandling() {
    const token = await this.getAuthToken()
    
    // Test with invalid document ID
    const invalidDocResponse = await this.makeRequest('/sync/invalid-doc-id-format!@#$%', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
    
    // Should handle invalid characters gracefully
    if (invalidDocResponse.status === 500) {
      this.log('Invalid document ID caused server error - this might need improvement', 'warning')
    }
  }

  async testLargeDocumentHandling() {
    const requiredVars = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_ACCESS_KEY_ID', 'CLOUDFLARE_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']
    const missingVars = requiredVars.filter(varName => !process.env[varName])
    
    if (missingVars.length > 0) {
      this.log('R2 credentials not configured, skipping large document test', 'warning')
      return
    }

    const testDocId = `large-doc-${Date.now()}`
    const largeData = new Uint8Array(1024 * 1024) // 1MB of data
    
    // Fill with pattern
    for (let i = 0; i < largeData.length; i++) {
      largeData[i] = i % 256
    }
    
    try {
      // Store large document
      await this.storage.save(testDocId, largeData)
      this.testDocuments.push(testDocId)
      
      // Retrieve and verify
      const retrievedData = await this.storage.load(testDocId)
      
      if (retrievedData.length !== largeData.length) {
        throw new Error(`Size mismatch: expected ${largeData.length}, got ${retrievedData.length}`)
      }
      
      this.log(`Large document test passed (${largeData.length} bytes)`, 'info')
      
    } catch (error) {
      throw new Error(`Large document test failed: ${error.message}`)
    }
  }

  // ==================== CLEANUP ====================

  async cleanup() {
    if (this.testDocuments.length === 0) {
      return
    }

    const requiredVars = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_ACCESS_KEY_ID', 'CLOUDFLARE_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']
    const missingVars = requiredVars.filter(varName => !process.env[varName])
    
    if (missingVars.length > 0) {
      this.log('Cannot cleanup test documents - R2 credentials not configured', 'warning')
      return
    }

    this.log(`Cleaning up ${this.testDocuments.length} test documents...`, 'info')
    
    for (const docId of this.testDocuments) {
      try {
        await this.storage.delete(docId)
      } catch (error) {
        this.log(`Failed to cleanup document ${docId}: ${error.message}`, 'warning')
      }
    }
    
    this.testDocuments = []
  }

  // ==================== MAIN TEST RUNNER ====================

  async run() {
    this.log('Starting Storage Tests', 'info')
    this.log(`Testing against: ${BASE_URL}`, 'info')

    try {
      // Check server availability
      const healthResponse = await this.makeRequest('/')
      if (!healthResponse.ok) {
        throw new Error('Server not available for testing')
      }

      // R2 Storage tests
      await this.runTest('R2 Configuration', () => this.testR2Configuration())
      await this.runTest('Document Storage', () => this.testDocumentStorage())
      await this.runTest('Document Deletion', () => this.testDocumentDeletion())
      await this.runTest('Large Document Handling', () => this.testLargeDocumentHandling())

      // Automerge sync tests
      await this.runTest('Automerge Sync Endpoint', () => this.testAutomergeSyncEndpoint())
      await this.runTest('Document Snapshot', () => this.testDocumentSnapshot())
      await this.runTest('Document Incremental', () => this.testDocumentIncremental())

      // WebSocket tests
      await this.runTest('WebSocket Info', () => this.testWebSocketInfo())

      // Error handling tests
      await this.runTest('Storage Error Handling', () => this.testStorageErrorHandling())

    } catch (error) {
      this.log(`Test suite failed: ${error.message}`, 'error')
    } finally {
      // Always cleanup test documents
      await this.cleanup()
    }

    this.printResults()
  }

  printResults() {
    console.log('\n' + '='.repeat(50))
    console.log('💾 STORAGE TEST RESULTS')
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
  const tests = new StorageTests()
  tests.run().catch(error => {
    console.error('❌ Storage tests failed:', error.message)
    process.exit(1)
  })
}

export { StorageTests }
