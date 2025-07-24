#!/usr/bin/env node

/**
 * WebSocket Authentication Test
 */

import WebSocket from 'ws'

const BASE_URL = 'http://localhost:3030'
const WS_URL = 'ws://localhost:3030'

async function testWebSocketAuth() {
  console.log('🧪 WebSocket Authentication Test\n')

  try {
    // Get access token
    console.log('1. Getting access token...')
    const loginResponse = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })

    const loginData = await loginResponse.json()
    const accessToken = loginData.accessToken
    console.log('✅ Access token obtained')
    console.log()

    // Test WebSocket connection with authentication
    console.log('2. Testing WebSocket with authentication...')
    
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${WS_URL}?token=${accessToken}`)
      
      let testTimeout = setTimeout(() => {
        ws.close()
        reject(new Error('WebSocket test timeout'))
      }, 5000)

      ws.on('open', () => {
        console.log('✅ WebSocket connected with authentication')
        clearTimeout(testTimeout)
        
        // Close after successful connection
        setTimeout(() => {
          ws.close()
        }, 1000)
      })

      ws.on('close', (code, reason) => {
        console.log(`🔌 WebSocket closed: ${code} ${reason}`)
        
        if (code === 1000) { // Normal closure
          console.log('✅ WebSocket authentication test successful')
          resolve()
        } else if (code === 1008) { // Authentication failed
          reject(new Error('WebSocket authentication failed'))
        }
      })

      ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error.message)
        clearTimeout(testTimeout)
        reject(error)
      })
    })

  } catch (error) {
    console.error('❌ WebSocket test failed:', error.message)
  }
}

// Run WebSocket test
testWebSocketAuth()
  .then(() => {
    console.log('\n🎉 WebSocket authentication test completed successfully!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ WebSocket authentication test failed:', error.message)
    process.exit(1)
  })
