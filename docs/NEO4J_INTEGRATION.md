# Neo4j Graph Database Integration

This document describes the Neo4j graph database integration for analyzing Automerge CRDT document structure and relationships.

## Overview

The Neo4j integration automatically watches Automerge documents for changes and mirrors their structure in a graph database. This enables powerful analysis capabilities including:

- Document structure visualization
- Relationship pattern analysis
- Similar document discovery
- Content search across document graphs
- Statistical analysis of document composition

## Features

### 🔄 Automatic Document Watching
- Monitors Automerge documents for changes in real-time
- Automatically syncs document structure to Neo4j
- Tracks node types, values, and relationships

### 📊 Graph Analysis APIs
- Document structure visualization
- Similar document detection
- Node type distribution analysis
- Relationship pattern discovery
- Full-text search across document content

### 🔍 Advanced Querying
- Custom Cypher query execution (admin only)
- Pre-built analysis endpoints
- GraphQL-style relationship traversal

## Configuration

### Environment Variables

Add these environment variables to enable Neo4j integration:

```bash
# Neo4j Connection (Required)
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your-neo4j-password

# Optional: Advanced Connection Settings
NEO4J_MAX_CONNECTION_LIFETIME=10800000  # 3 hours in milliseconds
NEO4J_MAX_CONNECTION_POOL_SIZE=50
NEO4J_CONNECTION_ACQUISITION_TIMEOUT=120000  # 2 minutes in milliseconds
```

### Neo4j Database Setup

1. **Install Neo4j**:
   ```bash
   # Docker (recommended for development)
   docker run -d \
     --name neo4j \
     -p 7474:7474 -p 7687:7687 \
     -e NEO4J_AUTH=neo4j/your-password \
     neo4j:latest
   
   # Or install locally
   # Follow instructions at https://neo4j.com/docs/operations-manual/current/installation/
   ```

2. **Access Neo4j Browser**: http://localhost:7474
   - Username: `neo4j`
   - Password: `your-password`

3. **Verify Connection**: The server will automatically create required indexes and constraints on startup.

## Data Model

### Node Types

The integration creates the following node types in Neo4j:

#### Document Nodes
```cypher
(:Document {
  documentId: string,      // Automerge document ID
  title: string,          // Document title
  description: string,    // Document description  
  projectId: string,      // Associated project ID
  lastUpdated: datetime,  // Last sync timestamp
  nodeCount: integer,     // Total nodes in document
  metadata: string        // JSON metadata
})
```

#### Automerge Structure Nodes
```cypher
(:AutomergeNode {
  nodeId: string,         // Unique node identifier
  documentId: string,     // Parent document ID
  nodeType: string,       // Type: Object, Array, String, Number, Boolean
  path: string,           // Path within document (e.g., "items.0.title")
  value: string,          // Node value (truncated for large objects)
  properties: string,     // JSON properties specific to node type
  createdAt: datetime     // Node creation timestamp
})
```

### Relationships

#### Document Containment
```cypher
(:Document)-[:CONTAINS]->(:AutomergeNode)
```

#### Structure Relationships
```cypher
(:AutomergeNode)-[:RELATES_TO {
  relType: string,        // HAS_PROPERTY, CONTAINS_ITEM
  properties: string,     // Relationship-specific metadata
  createdAt: datetime
}]->(:AutomergeNode)
```

## API Endpoints

All graph analysis endpoints require authentication and are documented in the OpenAPI specification.

### Basic Statistics
```http
GET /api/graph/stats
```
Returns overall graph database statistics.

### Document Analysis
```http
GET /api/graph/document/{documentId}/analysis
```
Get detailed analysis for a specific document.

### Similar Documents
```http
GET /api/graph/document/{documentId}/similar?limit=10
```
Find documents with similar structure.

### Document Structure
```http
GET /api/graph/document/{documentId}/structure?depth=2
```
Get graph structure for visualization.

### Node Operations
```http
GET /api/graph/nodes/types?projectId=uuid
GET /api/graph/nodes/search?searchTerm=content&nodeType=String&limit=50
```

### Relationship Analysis
```http
GET /api/graph/relationships/patterns?documentId=uuid&limit=20
```

### Custom Queries (Admin Only)
```http
POST /api/graph/query
Content-Type: application/json

{
  "query": "MATCH (n:Document) RETURN count(n)",
  "parameters": {}
}
```

## Usage Examples

### Finding Similar Documents

```javascript
// Find documents similar to a specific document
const response = await fetch('/api/graph/document/doc123/similar?limit=5', {
  headers: { 'Authorization': `Bearer ${token}` }
});

const similar = await response.json();
console.log('Similar documents:', similar.data);
```

### Analyzing Document Structure

```javascript
// Get document structure for visualization
const response = await fetch('/api/graph/document/doc123/structure?depth=3', {
  headers: { 'Authorization': `Bearer ${token}` }
});

const structure = await response.json();
const { nodes, edges } = structure.data;

// Use with visualization libraries like D3.js, Cytoscape.js, etc.
```

### Content Search

```javascript
// Search for nodes containing specific content
const response = await fetch('/api/graph/nodes/search?searchTerm=important&limit=20', {
  headers: { 'Authorization': `Bearer ${token}` }
});

const results = await response.json();
console.log('Found nodes:', results.data);
```

### Custom Analysis

```javascript
// Execute custom Cypher query (admin only)
const response = await fetch('/api/graph/query', {
  method: 'POST',
  headers: { 
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    query: `
      MATCH (d:Document)-[:CONTAINS]->(n:AutomergeNode)
      WHERE n.nodeType = $nodeType
      RETURN d.title, count(n) as nodeCount
      ORDER BY nodeCount DESC
      LIMIT 10
    `,
    parameters: { nodeType: 'Array' }
  })
});

const results = await response.json();
```

## Document Watching

The system automatically watches Automerge documents for changes:

1. **New Documents**: Automatically detected and added to graph
2. **Document Changes**: Structure changes trigger graph updates
3. **Project Association**: Documents are linked to projects when available

### Manual Sync

You can manually trigger document synchronization:

```javascript
// Server-side method (internal use)
await server.syncDocumentToNeo4j(documentId);
```

## Performance Considerations

### Indexing
The system automatically creates these indexes:
- Document ID uniqueness constraint
- Node ID uniqueness constraint  
- Project ID index for documents
- Node type index for filtering
- Relationship type index

### Optimization Tips

1. **Limit Query Results**: All endpoints have built-in limits
2. **Use Specific Filters**: Filter by project, node type, etc.
3. **Monitor Memory**: Large documents create many nodes
4. **Regular Maintenance**: Consider periodic cleanup of old data

### Resource Usage

- **Memory**: Proportional to document complexity
- **Storage**: ~1KB per document node on average
- **CPU**: Minimal impact on document operations

## Testing

Run Neo4j integration tests:

```bash
# Run all graph tests
npm run test:graph

# Run specific graph category
node test-suite.js graph

# Run with verbose output
node test-suite.js graph --verbose
```

The tests will automatically skip if Neo4j is not configured.

## Troubleshooting

### Common Issues

1. **Connection Failed**
   ```
   Error: Could not establish connection to Neo4j
   ```
   - Check `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`
   - Ensure Neo4j server is running
   - Verify network connectivity

2. **Authentication Failed**
   ```
   Error: Neo4j authentication failed
   ```
   - Verify username/password
   - Check if default password was changed

3. **Memory Issues**
   ```
   Error: Java heap space
   ```
   - Increase Neo4j memory: `NEO4J_dbms_memory_heap_max__size=2G`
   - Limit document watching scope

4. **Performance Issues**
   - Check index creation in logs
   - Monitor query execution times
   - Consider document complexity reduction

### Debug Mode

Enable debug logging:

```bash
NODE_ENV=development npm start
```

The server logs will include detailed Neo4j operations.

### Health Checks

Check graph database health:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3030/api/graph/stats
```

## Security Considerations

1. **Authentication Required**: All endpoints require valid JWT tokens
2. **Read-Only Queries**: Custom queries are limited to read operations
3. **Admin Restrictions**: Custom query endpoint requires admin permissions
4. **Result Limits**: All queries have maximum result limits
5. **Parameter Validation**: Query parameters are validated and sanitized

## Advanced Configuration

### Custom Node Extraction

The system can be extended to extract custom node types by modifying the `Neo4jService.extractNodes()` method.

### Custom Relationships

Add custom relationship extraction logic in `Neo4jService.extractRelationships()`.

### Event Hooks

Hook into document events for custom processing:

```javascript
// Add custom document processing
neo4jService.on('documentSynced', (documentId) => {
  // Custom logic after document sync
});
```

## Integration with Client Applications

### Visualization Libraries

The graph structure endpoint provides data in a format compatible with:

- **D3.js**: Force-directed graphs
- **Cytoscape.js**: Network visualization
- **Vis.js**: Interactive networks
- **Sigma.js**: Large graph rendering

### Example Integration

```javascript
// Fetch and visualize document structure
async function visualizeDocument(documentId) {
  const response = await fetch(`/api/graph/document/${documentId}/structure`);
  const { nodes, edges } = await response.json();
  
  // Initialize visualization library
  const cy = cytoscape({
    container: document.getElementById('graph'),
    elements: {
      nodes: nodes.map(n => ({ data: n })),
      edges: edges.map(e => ({ data: e }))
    },
    style: [/* styling rules */],
    layout: { name: 'force' }
  });
}
```

## Future Enhancements

Planned improvements include:

- **Real-time Updates**: WebSocket-based graph updates
- **Advanced Analytics**: Machine learning integration
- **Query Builder**: Visual query construction interface
- **Performance Optimization**: Incremental sync strategies
- **Custom Schemas**: User-defined document schemas
- **Export Formats**: GraphML, GEXF export support
