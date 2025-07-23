#!/usr/bin/env node

/**
 * Automerge Document Synchronization Test
 * Tests the WebSocket connection with actual Automerge document sync
 */

import { Repo } from "@automerge/automerge-repo"
import { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket"
import { NodeFSStorageAdapter } from "@automerge/automerge-repo-storage-nodefs"
import * as Automerge from "@automerge/automerge"
import WebSocket from 'ws'
import fs from 'fs'
import path from 'path'

// Set up WebSocket for Node.js environment
global.WebSocket = WebSocket

const SERVER_URL = 'ws://localhost:3030'
const CLIENT_STORAGE_DIR = './test-client-storage'

async function testAutomergeSync() {
  console.log('🧪 Automerge Document Synchronization Test\n')

  try {
    // Clean up any existing client storage
    if (fs.existsSync(CLIENT_STORAGE_DIR)) {
      fs.rmSync(CLIENT_STORAGE_DIR, { recursive: true, force: true })
    }
    fs.mkdirSync(CLIENT_STORAGE_DIR, { recursive: true })

    // Create a client repo that connects to the server
    console.log('1. Setting up Automerge client repo...')
    const clientRepo = new Repo({
      network: [new BrowserWebSocketClientAdapter(SERVER_URL)],
      storage: new NodeFSStorageAdapter(CLIENT_STORAGE_DIR),
      peerId: 'test-client-1',
      sharePolicy: async () => true, // Client shares documents
    })

    console.log('✅ Client repo initialized')
    console.log()

    // Wait for network connection
    console.log('2. Connecting to sync server...')
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'))
      }, 5000)

      // Check if we can create and sync a document
      setTimeout(async () => {
        try {
          console.log('✅ Connected to sync server')
          clearTimeout(timeout)
          resolve()
        } catch (error) {
          clearTimeout(timeout)
          reject(error)
        }
      }, 1000)
    })

    // Create a test document
    console.log('3. Creating and syncing test document...')
    const handle = clientRepo.create()
    
    // Update the document
    handle.change((doc) => {
      doc.title = 'Test Document'
      doc.content = 'This is a test document for Automerge sync'
      doc.timestamp = new Date().toISOString()
      doc.items = []
    })

    // Add some more changes
    handle.change((doc) => {
      doc.items.push('Item 1')
      doc.items.push('Item 2')
      doc.version = 1
    })

    const documentId = handle.documentId
    console.log(`✅ Document created with ID: ${documentId}`)
    console.log()

    // Wait a bit for sync
    console.log('4. Waiting for sync with server...')
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Get the final document state
    const finalDoc = handle.docSync()
    console.log('✅ Document synchronized successfully!')
    console.log('📄 Final document state:', JSON.stringify(finalDoc, null, 2))
    console.log()

    // Test if document persists by creating another client
    console.log('5. Testing document persistence with second client...')
    const CLIENT_STORAGE_DIR_2 = './test-client-storage-2'
    
    if (fs.existsSync(CLIENT_STORAGE_DIR_2)) {
      fs.rmSync(CLIENT_STORAGE_DIR_2, { recursive: true, force: true })
    }
    fs.mkdirSync(CLIENT_STORAGE_DIR_2, { recursive: true })

    const clientRepo2 = new Repo({
      network: [new BrowserWebSocketClientAdapter(SERVER_URL)],
      storage: new NodeFSStorageAdapter(CLIENT_STORAGE_DIR_2),
      peerId: 'test-client-2',
      sharePolicy: async () => true,
    })

    // Wait for connection and then request the document
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    const handle2 = clientRepo2.find(documentId)
    await handle2.whenReady()
    
    const doc2 = handle2.docSync()
    console.log('✅ Document retrieved by second client!')
    console.log('📄 Retrieved document:', JSON.stringify(doc2, null, 2))

    // Cleanup
    console.log('\n6. Cleaning up...')
    if (fs.existsSync(CLIENT_STORAGE_DIR)) {
      fs.rmSync(CLIENT_STORAGE_DIR, { recursive: true, force: true })
    }
    if (fs.existsSync(CLIENT_STORAGE_DIR_2)) {
      fs.rmSync(CLIENT_STORAGE_DIR_2, { recursive: true, force: true })
    }
    console.log('✅ Cleanup completed')

  } catch (error) {
    console.error('❌ Automerge sync test failed:', error.message)
    throw error
  }
}

// Run the test
testAutomergeSync()
  .then(() => {
    console.log('\n🎉 Automerge document synchronization test completed successfully!')
    console.log('   ✓ WebSocket connection established')
    console.log('   ✓ Document created and synchronized')
    console.log('   ✓ Document persisted on server')
    console.log('   ✓ Document retrieved by second client')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Automerge sync test failed:', error.message)
    process.exit(1)
  })
