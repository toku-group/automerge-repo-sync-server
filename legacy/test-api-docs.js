#!/usr/bin/env node

/**
 * Test script to verify API documentation includes enhanced error handling
 */

const BASE_URL = 'http://localhost:3030'

async function testApiDocs() {
  console.log('🔍 Testing enhanced API documentation...\n')
  
  try {
    // Test 1: Check if API docs are accessible
    console.log('Test 1: Checking API documentation accessibility')
    
    // Try different common swagger JSON endpoints
    const possibleEndpoints = [
      `${BASE_URL}/api-docs.json`,
      `${BASE_URL}/api-docs/swagger.json`,
      `${BASE_URL}/swagger.json`,
      `${BASE_URL}/docs.json`
    ]
    
    let swaggerDoc = null
    let workingEndpoint = null
    
    for (const endpoint of possibleEndpoints) {
      try {
        const response = await fetch(endpoint)
        if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
          swaggerDoc = await response.json()
          workingEndpoint = endpoint
          break
        }
      } catch (e) {
        // Continue to next endpoint
      }
    }
    
    if (!swaggerDoc) {
      console.log('❌ Could not find accessible swagger JSON endpoint')
      console.log('   Trying to access Swagger UI page instead...')
      
      const uiResponse = await fetch(`${BASE_URL}/api-docs/`)
      if (uiResponse.ok) {
        console.log('✅ Swagger UI page is accessible at /api-docs/')
        console.log('   Manual verification: Visit http://localhost:3030/api-docs/ to see enhanced error documentation')
        return
      } else {
        console.log('❌ Swagger UI page also not accessible')
        return
      }
    }
    
    console.log(`✅ API documentation accessible at ${workingEndpoint}`)
    
    // Test 2: Check if enhanced error schemas exist
    console.log('\nTest 2: Checking enhanced error schemas')
    const schemas = swaggerDoc.components?.schemas || {}
    
    const expectedSchemas = [
      'Error',
      'DatabaseError', 
      'ValidationError',
      'ConflictError',
      'AuthenticationError'
    ]
    
    expectedSchemas.forEach(schemaName => {
      if (schemas[schemaName]) {
        console.log(`✅ Schema '${schemaName}' found`)
        
        // Check if schema has proper structure
        const schema = schemas[schemaName]
        if (schema.properties?.error) {
          console.log(`   - Has 'error' property`)
        }
        if (schema.properties?.details && schemaName === 'DatabaseError') {
          console.log(`   - Has 'details' property for database errors`)
        }
        if (schema.properties?.code && schemaName === 'AuthenticationError') {
          console.log(`   - Has 'code' property for authentication errors`)
        }
      } else {
        console.log(`❌ Schema '${schemaName}' missing`)
      }
    })
    
    // Test 3: Check if project endpoints reference new error schemas
    console.log('\nTest 3: Checking project endpoints use enhanced error schemas')
    const paths = swaggerDoc.paths || {}
    
    const endpointsToCheck = [
      ['/api/projects', 'get'],
      ['/api/projects', 'post'],
      ['/api/project/{projectId}', 'get'],
      ['/api/project/{projectId}', 'delete'],
      ['/api/project/{projectId}/documents', 'get'],
      ['/api/project/{projectId}/documents', 'post']
    ]
    
    endpointsToCheck.forEach(([path, method]) => {
      const endpoint = paths[path]?.[method]
      if (endpoint) {
        console.log(`\n📍 Endpoint: ${method.toUpperCase()} ${path}`)
        
        const responses = endpoint.responses || {}
        
        // Check for specific error schemas
        if (responses['401']?.content?.['application/json']?.schema?.$ref?.includes('AuthenticationError')) {
          console.log('   ✅ 401 uses AuthenticationError schema')
        }
        if (responses['400']?.content?.['application/json']?.schema?.$ref?.includes('ValidationError')) {
          console.log('   ✅ 400 uses ValidationError schema')
        }
        if (responses['409']?.content?.['application/json']?.schema?.$ref?.includes('ConflictError')) {
          console.log('   ✅ 409 uses ConflictError schema')
        }
        if (responses['500']?.content?.['application/json']?.schema?.$ref?.includes('DatabaseError')) {
          console.log('   ✅ 500 uses DatabaseError schema')
        }
        if (responses['503']?.content?.['application/json']?.schema?.$ref?.includes('DatabaseError')) {
          console.log('   ✅ 503 uses DatabaseError schema')
        }
        
        // Count total documented error responses
        const errorResponses = Object.keys(responses).filter(code => 
          parseInt(code) >= 400 && parseInt(code) < 600
        )
        console.log(`   📊 Documents ${errorResponses.length} error response types: ${errorResponses.join(', ')}`)
        
      } else {
        console.log(`❌ Endpoint ${method.toUpperCase()} ${path} not found`)
      }
    })
    
    // Test 4: Check authentication endpoint documentation
    console.log('\n\n📍 Authentication endpoint: POST /auth/login')
    const loginEndpoint = paths['/auth/login']?.post
    if (loginEndpoint) {
      const responses = loginEndpoint.responses || {}
      const errorResponses = Object.keys(responses).filter(code => 
        parseInt(code) >= 400 && parseInt(code) < 600
      )
      console.log(`   📊 Documents ${errorResponses.length} error response types: ${errorResponses.join(', ')}`)
      
      if (responses['400']) {
        console.log('   ✅ 400 (Bad Request) documented')
      }
      if (responses['401']) {
        console.log('   ✅ 401 (Unauthorized) documented')
      }
      if (responses['503']) {
        console.log('   ✅ 503 (Service Unavailable) documented')
      }
    }
    
    console.log('\n✅ API documentation enhancement verification completed!')
    
  } catch (error) {
    console.error('❌ Error testing API documentation:', error.message)
  }
}

// Check if fetch is available (Node.js 18+)
if (typeof fetch === 'undefined') {
  console.error('❌ This script requires Node.js 18+ with built-in fetch support')
  process.exit(1)
}

testApiDocs().catch(error => {
  console.error('❌ Test failed:', error)
  process.exit(1)
})
