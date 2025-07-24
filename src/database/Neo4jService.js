/**
 * Neo4j Graph Database Service for Automerge Document Analysis
 * 
 * This service watches Automerge CRDT documents and mirrors their structure
 * in a Neo4j graph database for analysis and querying.
 */

import neo4j from 'neo4j-driver'
import { getDatabaseService } from './DatabaseService.js'

export class Neo4jService {
  /** @type {neo4j.Driver} */
  #driver = null
  
  /** @type {Set<string>} */
  #trackedDocuments = new Set()
  
  /** @type {Map<string, any>} */
  #documentWatchers = new Map()
  
  constructor() {
    this.isEnabled = false
  }

  /**
   * Initialize Neo4j connection and create indexes
   * @returns {Promise<boolean>}
   */
  async initialize() {
    try {
      if (!process.env.NEO4J_URI) {
        console.log('Neo4j not configured - skipping graph database integration')
        return false
      }

      const uri = process.env.NEO4J_URI
      const username = process.env.NEO4J_USERNAME || 'neo4j'
      const password = process.env.NEO4J_PASSWORD

      if (!password) {
        console.error('NEO4J_PASSWORD environment variable is required')
        return false
      }

      this.#driver = neo4j.driver(
        uri,
        neo4j.auth.basic(username, password),
        {
          maxConnectionLifetime: 3 * 60 * 60 * 1000, // 3 hours
          maxConnectionPoolSize: 50,
          connectionAcquisitionTimeout: 2 * 60 * 1000, // 2 minutes
          disableLosslessIntegers: true
        }
      )

      // Test connection
      await this.#driver.verifyConnectivity()
      console.log('✅ Connected to Neo4j database')

      // Create indexes and constraints
      await this.createIndexes()
      
      this.isEnabled = true
      return true

    } catch (error) {
      console.error('Failed to initialize Neo4j:', error)
      return false
    }
  }

  /**
   * Create necessary indexes and constraints in Neo4j
   */
  async createIndexes() {
    const session = this.#driver.session()
    
    try {
      // Create constraints for unique identifiers
      await session.run(`
        CREATE CONSTRAINT document_id_unique IF NOT EXISTS
        FOR (d:Document) REQUIRE d.documentId IS UNIQUE
      `)

      await session.run(`
        CREATE CONSTRAINT node_id_unique IF NOT EXISTS
        FOR (n:AutomergeNode) REQUIRE n.nodeId IS UNIQUE
      `)

      // Create indexes for common queries
      await session.run(`
        CREATE INDEX document_project_idx IF NOT EXISTS
        FOR (d:Document) ON (d.projectId)
      `)

      await session.run(`
        CREATE INDEX node_type_idx IF NOT EXISTS
        FOR (n:AutomergeNode) ON (n.nodeType)
      `)

      await session.run(`
        CREATE INDEX relationship_type_idx IF NOT EXISTS
        FOR ()-[r]-() ON (r.relType)
      `)

      console.log('✅ Neo4j indexes and constraints created')

    } catch (error) {
      console.error('Error creating Neo4j indexes:', error)
    } finally {
      await session.close()
    }
  }

  /**
   * Watch an Automerge document for changes and sync to Neo4j
   * @param {string} documentId - Automerge document ID
   * @param {any} documentHandle - Automerge document handle
   * @param {string} [projectId] - Associated project ID
   */
  async watchDocument(documentId, documentHandle, projectId = null) {
    if (!this.isEnabled) {
      return
    }

    if (this.#trackedDocuments.has(documentId)) {
      console.log(`Document ${documentId} is already being tracked`)
      return
    }

    console.log(`📊 Starting to track document ${documentId} in Neo4j`)

    try {
      // Initial sync of the document
      await this.syncDocumentToGraph(documentId, documentHandle, projectId)

      // Set up change listener
      const unsubscribe = documentHandle.on('change', async () => {
        try {
          console.log(`📊 Document ${documentId} changed - syncing to Neo4j`)
          await this.syncDocumentToGraph(documentId, documentHandle, projectId)
        } catch (error) {
          console.error(`Error syncing document ${documentId} to Neo4j:`, error)
        }
      })

      this.#documentWatchers.set(documentId, unsubscribe)
      this.#trackedDocuments.add(documentId)

    } catch (error) {
      console.error(`Error setting up document watcher for ${documentId}:`, error)
    }
  }

  /**
   * Stop watching a document
   * @param {string} documentId - Document ID to stop watching
   */
  async unwatchDocument(documentId) {
    if (!this.#trackedDocuments.has(documentId)) {
      return
    }

    const unsubscribe = this.#documentWatchers.get(documentId)
    if (unsubscribe) {
      unsubscribe()
      this.#documentWatchers.delete(documentId)
    }

    this.#trackedDocuments.delete(documentId)
    console.log(`📊 Stopped tracking document ${documentId}`)
  }

  /**
   * Sync an Automerge document structure to Neo4j
   * @param {string} documentId - Document ID
   * @param {any} documentHandle - Document handle
   * @param {string} [projectId] - Project ID
   */
  async syncDocumentToGraph(documentId, documentHandle, projectId = null) {
    if (!this.isEnabled) {
      return
    }

    const session = this.#driver.session()

    try {
      const doc = documentHandle.docSync()
      if (!doc) {
        console.warn(`Document ${documentId} has no content to sync`)
        return
      }

      // Start transaction
      await session.executeWrite(async (tx) => {
        // Create or update document node
        await this.createDocumentNode(tx, documentId, doc, projectId)
        
        // Extract and create nodes from document structure
        await this.extractAndCreateNodes(tx, documentId, doc)
        
        // Extract and create relationships
        await this.extractAndCreateRelationships(tx, documentId, doc)
      })

      console.log(`✅ Synced document ${documentId} to Neo4j`)

    } catch (error) {
      console.error(`Error syncing document ${documentId} to Neo4j:`, error)
    } finally {
      await session.close()
    }
  }

  /**
   * Create or update the document node in Neo4j
   */
  async createDocumentNode(tx, documentId, doc, projectId) {
    const query = `
      MERGE (d:Document {documentId: $documentId})
      SET d.title = $title,
          d.description = $description,
          d.projectId = $projectId,
          d.lastUpdated = datetime(),
          d.nodeCount = $nodeCount,
          d.metadata = $metadata
      RETURN d
    `

    const nodeCount = this.countNodes(doc)
    
    await tx.run(query, {
      documentId,
      title: doc.title || doc.name || `Document ${documentId.substring(0, 8)}`,
      description: doc.description || null,
      projectId,
      nodeCount,
      metadata: JSON.stringify(this.extractMetadata(doc))
    })
  }

  /**
   * Extract and create nodes from document structure
   */
  async extractAndCreateNodes(tx, documentId, doc, parentPath = []) {
    const nodes = this.extractNodes(doc, parentPath)
    
    // Remove existing nodes for this document first
    await tx.run(`
      MATCH (n:AutomergeNode {documentId: $documentId})
      DETACH DELETE n
    `, { documentId })

    // Create new nodes
    for (const node of nodes) {
      const query = `
        CREATE (n:AutomergeNode {
          nodeId: $nodeId,
          documentId: $documentId,
          nodeType: $nodeType,
          path: $path,
          value: $value,
          properties: $properties,
          createdAt: datetime()
        })
        RETURN n
      `

      await tx.run(query, {
        nodeId: `${documentId}:${node.path.join('.')}`,
        documentId,
        nodeType: node.type,
        path: node.path.join('.'),
        value: node.value,
        properties: JSON.stringify(node.properties)
      })
    }

    // Connect document to its root nodes
    await tx.run(`
      MATCH (d:Document {documentId: $documentId})
      MATCH (n:AutomergeNode {documentId: $documentId})
      WHERE n.path = '' OR n.path STARTS WITH 'root'
      CREATE (d)-[:CONTAINS]->(n)
    `, { documentId })
  }

  /**
   * Extract and create relationships from document structure
   */
  async extractAndCreateRelationships(tx, documentId, doc) {
    const relationships = this.extractRelationships(doc)

    // Remove existing relationships
    await tx.run(`
      MATCH (a:AutomergeNode {documentId: $documentId})-[r:RELATES_TO]-(b:AutomergeNode {documentId: $documentId})
      DELETE r
    `, { documentId })

    // Create new relationships
    for (const rel of relationships) {
      const query = `
        MATCH (a:AutomergeNode {documentId: $documentId, path: $fromPath})
        MATCH (b:AutomergeNode {documentId: $documentId, path: $toPath})
        CREATE (a)-[r:RELATES_TO {
          relType: $relType,
          properties: $properties,
          createdAt: datetime()
        }]->(b)
        RETURN r
      `

      await tx.run(query, {
        documentId,
        fromPath: rel.from,
        toPath: rel.to,
        relType: rel.type,
        properties: JSON.stringify(rel.properties)
      })
    }
  }

  /**
   * Extract nodes from document structure
   */
  extractNodes(obj, path = [], nodes = []) {
    if (obj === null || obj === undefined) {
      return nodes
    }

    const currentPath = path.join('.')
    
    if (Array.isArray(obj)) {
      // Array node
      nodes.push({
        path: [...path],
        type: 'Array',
        value: `Array[${obj.length}]`,
        properties: { length: obj.length }
      })

      // Array items
      obj.forEach((item, index) => {
        this.extractNodes(item, [...path, index.toString()], nodes)
      })

    } else if (typeof obj === 'object') {
      // Object node
      const keys = Object.keys(obj)
      nodes.push({
        path: [...path],
        type: 'Object',
        value: `Object{${keys.length}}`,
        properties: { 
          keyCount: keys.length,
          keys: keys.slice(0, 10) // Limit for performance
        }
      })

      // Object properties
      for (const [key, value] of Object.entries(obj)) {
        this.extractNodes(value, [...path, key], nodes)
      }

    } else {
      // Primitive value node
      const type = typeof obj
      nodes.push({
        path: [...path],
        type: this.capitalizeFirst(type),
        value: obj?.toString() || 'null',
        properties: { 
          primitiveType: type,
          length: obj?.toString()?.length || 0
        }
      })
    }

    return nodes
  }

  /**
   * Extract relationships from document structure
   */
  extractRelationships(obj, path = [], relationships = []) {
    if (!obj || typeof obj !== 'object') {
      return relationships
    }

    if (Array.isArray(obj)) {
      // Array relationships
      for (let i = 0; i < obj.length; i++) {
        const itemPath = [...path, i.toString()].join('.')
        const arrayPath = path.join('.')
        
        relationships.push({
          from: arrayPath,
          to: itemPath,
          type: 'CONTAINS_ITEM',
          properties: { index: i }
        })

        // Recursive relationships within items
        this.extractRelationships(obj[i], [...path, i.toString()], relationships)
      }

    } else {
      // Object relationships
      for (const [key, value] of Object.entries(obj)) {
        const valuePath = [...path, key].join('.')
        const objectPath = path.join('.')
        
        relationships.push({
          from: objectPath,
          to: valuePath,
          type: 'HAS_PROPERTY',
          properties: { propertyName: key }
        })

        // Recursive relationships within values
        this.extractRelationships(value, [...path, key], relationships)
      }
    }

    return relationships
  }

  /**
   * Count total nodes in document
   */
  countNodes(obj, count = 0) {
    if (obj === null || obj === undefined) {
      return count + 1
    }

    if (Array.isArray(obj)) {
      count += 1 // for the array itself
      return obj.reduce((acc, item) => this.countNodes(item, acc), count)
    }

    if (typeof obj === 'object') {
      count += 1 // for the object itself
      return Object.values(obj).reduce((acc, value) => this.countNodes(value, acc), count)
    }

    return count + 1 // for primitive values
  }

  /**
   * Extract metadata from document
   */
  extractMetadata(doc) {
    return {
      hasTitle: !!doc.title,
      hasDescription: !!doc.description,
      hasTimestamp: !!doc.timestamp,
      hasItems: !!doc.items,
      topLevelKeys: Object.keys(doc || {}).slice(0, 20),
      estimatedSize: JSON.stringify(doc || {}).length
    }
  }

  /**
   * Query the graph database
   * @param {string} cypherQuery - Cypher query
   * @param {Object} parameters - Query parameters
   * @returns {Promise<Array>}
   */
  async query(cypherQuery, parameters = {}) {
    if (!this.isEnabled) {
      throw new Error('Neo4j service is not enabled')
    }

    const session = this.#driver.session()
    
    try {
      const result = await session.run(cypherQuery, parameters)
      return result.records.map(record => record.toObject())
    } finally {
      await session.close()
    }
  }

  /**
   * Get document analysis
   * @param {string} documentId - Document ID
   * @returns {Promise<Object>}
   */
  async getDocumentAnalysis(documentId) {
    const query = `
      MATCH (d:Document {documentId: $documentId})
      OPTIONAL MATCH (d)-[:CONTAINS]->(n:AutomergeNode)
      OPTIONAL MATCH (n)-[r:RELATES_TO]->()
      RETURN d,
             count(DISTINCT n) as nodeCount,
             count(DISTINCT r) as relationshipCount,
             collect(DISTINCT n.nodeType) as nodeTypes
    `

    const results = await this.query(query, { documentId })
    return results[0] || null
  }

  /**
   * Get graph statistics for all documents
   * @returns {Promise<Object>}
   */
  async getGraphStatistics() {
    const query = `
      MATCH (d:Document)
      OPTIONAL MATCH (d)-[:CONTAINS]->(n:AutomergeNode)
      OPTIONAL MATCH (n)-[r:RELATES_TO]->()
      RETURN count(DISTINCT d) as documentCount,
             count(DISTINCT n) as totalNodes,
             count(DISTINCT r) as totalRelationships,
             collect(DISTINCT n.nodeType) as allNodeTypes
    `

    const results = await this.query(query)
    return results[0] || {
      documentCount: 0,
      totalNodes: 0,
      totalRelationships: 0,
      allNodeTypes: []
    }
  }

  /**
   * Find similar documents based on structure
   * @param {string} documentId - Reference document ID
   * @param {number} limit - Number of results
   * @returns {Promise<Array>}
   */
  async findSimilarDocuments(documentId, limit = 10) {
    const query = `
      MATCH (ref:Document {documentId: $documentId})-[:CONTAINS]->(refNode:AutomergeNode)
      WITH ref, collect(DISTINCT refNode.nodeType) as refTypes
      
      MATCH (other:Document)-[:CONTAINS]->(otherNode:AutomergeNode)
      WHERE other.documentId <> $documentId
      WITH ref, refTypes, other, collect(DISTINCT otherNode.nodeType) as otherTypes
      
      WITH ref, other, 
           size([x IN refTypes WHERE x IN otherTypes]) as commonTypes,
           size(refTypes + otherTypes) as totalTypes
      
      WHERE commonTypes > 0
      RETURN other.documentId as documentId,
             other.title as title,
             commonTypes,
             totalTypes,
             toFloat(commonTypes) / totalTypes as similarity
      ORDER BY similarity DESC
      LIMIT $limit
    `

    return await this.query(query, { documentId, limit })
  }

  /**
   * Utility function to capitalize first letter
   */
  capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1)
  }

  /**
   * Close Neo4j connection
   */
  async close() {
    if (this.#driver) {
      await this.#driver.close()
      console.log('Neo4j connection closed')
    }
  }
}

// Singleton instance
let neo4jServiceInstance = null

/**
 * Get the Neo4j service instance
 * @returns {Neo4jService}
 */
export function getNeo4jService() {
  if (!neo4jServiceInstance) {
    neo4jServiceInstance = new Neo4jService()
  }
  return neo4jServiceInstance
}
