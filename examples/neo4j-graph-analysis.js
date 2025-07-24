#!/usr/bin/env node

/**
 * Neo4j Graph Analysis Example Client
 * 
 * This example demonstrates how to use the Neo4j graph analysis APIs
 * to analyze Automerge document structure and relationships.
 */

import fetch from 'node-fetch'

// Polyfill fetch for Node.js environments without built-in fetch
if (!globalThis.fetch) {
  globalThis.fetch = fetch
}

const BASE_URL = 'http://localhost:3030'

class GraphAnalysisExample {
  constructor() {
    this.token = null
  }

  async login() {
    console.log('🔐 Logging in...')
    
    const response = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        username: 'admin', 
        password: 'admin234' 
      })
    })

    if (!response.ok) {
      throw new Error(`Login failed: ${response.status}`)
    }

    const data = await response.json()
    this.token = data.accessToken
    console.log('✅ Logged in successfully')
  }

  async makeRequest(endpoint, options = {}) {
    if (!this.token) {
      await this.login()
    }

    const response = await fetch(`${BASE_URL}${endpoint}`, {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    })

    const data = await response.json()
    return { status: response.status, ok: response.ok, data }
  }

  async checkGraphServiceStatus() {
    console.log('\n📊 Checking graph database service status...')
    
    try {
      const response = await this.makeRequest('/api/graph/stats')
      
      if (response.status === 503) {
        console.log('⚠️  Neo4j service is not configured or unavailable')
        console.log('   To enable graph analysis:')
        console.log('   1. Install Neo4j: docker run -d --name neo4j -p 7474:7474 -p 7687:7687 -e NEO4J_AUTH=neo4j/password neo4j:latest')
        console.log('   2. Set environment variables:')
        console.log('      NEO4J_URI=bolt://localhost:7687')
        console.log('      NEO4J_USERNAME=neo4j') 
        console.log('      NEO4J_PASSWORD=password')
        console.log('   3. Restart the server')
        return false
      }

      if (!response.ok) {
        throw new Error(`Graph stats request failed: ${response.status}`)
      }

      const stats = response.data.data
      console.log('✅ Neo4j service is running')
      console.log(`   📄 Documents: ${stats.documentCount}`)
      console.log(`   🔗 Nodes: ${stats.totalNodes}`)
      console.log(`   🔀 Relationships: ${stats.totalRelationships}`)
      console.log(`   📝 Node Types: ${stats.allNodeTypes.join(', ')}`)
      
      return true

    } catch (error) {
      console.error('❌ Error checking graph service:', error.message)
      return false
    }
  }

  async demonstrateNodeSearch() {
    console.log('\n🔍 Demonstrating node content search...')
    
    try {
      const response = await this.makeRequest('/api/graph/nodes/search?searchTerm=test&limit=10')
      
      if (!response.ok) {
        console.log('⚠️  Node search failed:', response.data.error)
        return
      }

      const results = response.data.data
      console.log(`✅ Found ${results.length} nodes containing "test"`)
      
      results.slice(0, 3).forEach((node, index) => {
        console.log(`   ${index + 1}. ${node.nodeType} at "${node.path}": ${node.value.substring(0, 50)}${node.value.length > 50 ? '...' : ''}`)
      })

    } catch (error) {
      console.error('❌ Error in node search:', error.message)
    }
  }

  async demonstrateNodeTypes() {
    console.log('\n📊 Analyzing node type distribution...')
    
    try {
      const response = await this.makeRequest('/api/graph/nodes/types')
      
      if (!response.ok) {
        console.log('⚠️  Node types analysis failed:', response.data.error)
        return
      }

      const types = response.data.data
      console.log('✅ Node type distribution:')
      
      types.slice(0, 5).forEach(type => {
        console.log(`   ${type.nodeType}: ${type.count} nodes (avg size: ${Math.round(type.avgValueSize || 0)} chars)`)
      })

    } catch (error) {
      console.error('❌ Error in node types analysis:', error.message)
    }
  }

  async demonstrateRelationshipPatterns() {
    console.log('\n🔀 Analyzing relationship patterns...')
    
    try {
      const response = await this.makeRequest('/api/graph/relationships/patterns?limit=10')
      
      if (!response.ok) {
        console.log('⚠️  Relationship patterns analysis failed:', response.data.error)
        return
      }

      const patterns = response.data.data
      console.log('✅ Most common relationship patterns:')
      
      patterns.slice(0, 5).forEach(pattern => {
        console.log(`   ${pattern.sourceType} -[${pattern.relationshipType}]-> ${pattern.targetType}: ${pattern.frequency} times`)
      })

    } catch (error) {
      console.error('❌ Error in relationship analysis:', error.message)
    }
  }

  async demonstrateCustomQuery() {
    console.log('\n🔧 Executing custom Cypher query...')
    
    try {
      const query = {
        query: `
          MATCH (d:Document)
          OPTIONAL MATCH (d)-[:CONTAINS]->(n:AutomergeNode)
          RETURN d.title as title, 
                 d.documentId as id,
                 count(n) as nodeCount
          ORDER BY nodeCount DESC
          LIMIT 5
        `,
        parameters: {}
      }

      const response = await this.makeRequest('/api/graph/query', {
        method: 'POST',
        body: JSON.stringify(query)
      })
      
      if (!response.ok) {
        console.log('⚠️  Custom query failed:', response.data.error)
        return
      }

      const results = response.data.data
      console.log('✅ Documents by complexity:')
      
      results.forEach(doc => {
        console.log(`   "${doc.title || 'Untitled'}" (${doc.id.substring(0, 8)}...): ${doc.nodeCount} nodes`)
      })

    } catch (error) {
      console.error('❌ Error in custom query:', error.message)
    }
  }

  async demonstrateDocumentAnalysis() {
    console.log('\n📄 Analyzing specific document...')
    
    try {
      // First get a list of projects to find a document
      const projectsResponse = await this.makeRequest('/api/projects')
      
      if (!projectsResponse.ok || projectsResponse.data.length === 0) {
        console.log('⚠️  No projects found. Create a project with documents first.')
        return
      }

      // Find first document in any project
      let documentId = null
      for (const project of projectsResponse.data) {
        if (project.documents && project.documents.length > 0) {
          documentId = project.documents[0].documentId
          break
        }
      }

      if (!documentId) {
        console.log('⚠️  No documents found in projects. Add documents to analyze their structure.')
        return
      }

      console.log(`   Analyzing document: ${documentId.substring(0, 16)}...`)

      // Get document analysis
      const analysisResponse = await this.makeRequest(`/api/graph/document/${documentId}/analysis`)
      
      if (!analysisResponse.ok) {
        console.log(`⚠️  Document not found in graph database: ${analysisResponse.data.error}`)
        return
      }

      const analysis = analysisResponse.data.data
      console.log('✅ Document analysis:')
      console.log(`   📊 Nodes: ${analysis.nodeCount}`)
      console.log(`   🔗 Relationships: ${analysis.relationshipCount}`)
      console.log(`   📝 Node Types: ${analysis.nodeTypes?.join(', ') || 'None'}`)

      // Get similar documents
      const similarResponse = await this.makeRequest(`/api/graph/document/${documentId}/similar?limit=3`)
      
      if (similarResponse.ok && similarResponse.data.data.length > 0) {
        console.log('✅ Similar documents:')
        similarResponse.data.data.forEach(similar => {
          console.log(`   "${similar.title || 'Untitled'}" (similarity: ${(similar.similarity * 100).toFixed(1)}%)`)
        })
      } else {
        console.log('ℹ️  No similar documents found')
      }

    } catch (error) {
      console.error('❌ Error in document analysis:', error.message)
    }
  }

  async run() {
    console.log('🚀 Neo4j Graph Analysis Example')
    console.log('=====================================')

    try {
      // Check if graph service is available
      const serviceAvailable = await this.checkGraphServiceStatus()
      
      if (!serviceAvailable) {
        console.log('\n⚠️  Graph analysis examples require Neo4j to be configured.')
        console.log('   The server will work normally without it, but graph features will be disabled.')
        return
      }

      // Run demonstrations
      await this.demonstrateNodeTypes()
      await this.demonstrateRelationshipPatterns()
      await this.demonstrateNodeSearch()
      await this.demonstrateDocumentAnalysis()
      await this.demonstrateCustomQuery()

      console.log('\n🎉 Graph analysis examples completed!')
      console.log('\nNext steps:')
      console.log('- Create more documents to see richer analysis')
      console.log('- Open Neo4j Browser (http://localhost:7474) for visual exploration')
      console.log('- Use the API endpoints in your own applications')
      console.log('- Check the OpenAPI docs at http://localhost:3030/api-docs')

    } catch (error) {
      console.error('❌ Example failed:', error.message)
      process.exit(1)
    }
  }
}

// Run the example
const example = new GraphAnalysisExample()
example.run().catch(error => {
  console.error('❌ Fatal error:', error.message)
  process.exit(1)
})
