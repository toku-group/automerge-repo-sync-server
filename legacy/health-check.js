#!/usr/bin/env node

/**
 * Simple health check script for devcontainer
 * Verifies that the server and database are working correctly
 */

import { getDatabaseService } from './src/database/DatabaseService.js'

async function quickHealthCheck() {
  console.log('🏥 Quick Health Check')
  console.log('==================')

  try {
    // Check database service
    console.log('📊 Checking database service...')
    const dbService = getDatabaseService()
    const dbInitialized = await dbService.initialize()
    
    if (dbInitialized) {
      console.log('✅ Database service: HEALTHY')
      const health = await dbService.healthCheck()
      console.log(`   Status: ${health.status}`)
      console.log(`   Connections: ${health.connections?.total || 0} total, ${health.connections?.idle || 0} idle`)
      await dbService.close()
    } else {
      console.log('📁 Database service: FILE-BASED FALLBACK')
      console.log('   PostgreSQL not available, using file storage')
    }

    // Check if server can start
    console.log('🚀 Checking server startup...')
    
    // Import and check if the server module loads correctly
    try {
      await import('./src/server.js')
      console.log('✅ Server module: LOADS CORRECTLY')
    } catch (error) {
      console.log('❌ Server module: ERROR')
      console.log(`   ${error.message}`)
      return
    }

    console.log('')
    console.log('🎉 Health check passed!')
    console.log('   Ready to start the server with: npm start')

  } catch (error) {
    console.error('❌ Health check failed:', error.message)
    console.log('')
    console.log('This may be temporary. Try again in a few seconds.')
  }
}

// Run health check if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  quickHealthCheck()
}
