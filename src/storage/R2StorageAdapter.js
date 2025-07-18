// @ts-check
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3"

/**
 * @typedef {import("@automerge/automerge-repo").StorageAdapterInterface} StorageAdapterInterface
 * @typedef {import("@automerge/automerge-repo").StorageKey} StorageKey
 * @typedef {import("@automerge/automerge-repo").Chunk} Chunk
 */

/**
 * Cloudflare R2 storage adapter for Automerge documents
 * @implements {StorageAdapterInterface}
 */
export class R2StorageAdapter {
  /** @type {S3Client} */
  #client

  /** @type {string} */
  #bucket

  /** @type {string} */
  #prefix

  /**
   * @param {object} config
   * @param {string} config.accountId - Cloudflare account ID
   * @param {string} config.accessKeyId - R2 access key ID
   * @param {string} config.secretAccessKey - R2 secret access key
   * @param {string} config.bucket - R2 bucket name
   * @param {string} [config.prefix] - Optional prefix for all keys
   */
  constructor({ accountId, accessKeyId, secretAccessKey, bucket, prefix = "" }) {
    this.#bucket = bucket
    this.#prefix = prefix

    this.#client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    })
  }

  /**
   * @param {StorageKey} key
   * @returns {string}
   */
  #getFullKey(key) {
    const keyString = key.join("/")
    return this.#prefix ? `${this.#prefix}/${keyString}` : keyString
  }

  /**
   * @param {string} fullKey
   * @returns {StorageKey}
   */
  #stripPrefix(fullKey) {
    let keyString = fullKey
    if (this.#prefix && fullKey.startsWith(this.#prefix + "/")) {
      keyString = fullKey.substring(this.#prefix.length + 1)
    }
    return keyString.split("/")
  }

  /**
   * @param {StorageKey} key
   * @returns {Promise<Uint8Array | undefined>}
   */
  async load(key) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.#bucket,
        Key: this.#getFullKey(key),
      })
      const response = await this.#client.send(command)
      
      if (response.Body) {
        // Convert stream to buffer
        const chunks = []
        
        if (response.Body instanceof Uint8Array) {
          return response.Body
        }
        
        // For Node.js streams - cast to readable stream
        const stream = /** @type {import('stream').Readable} */ (response.Body)
        
        return new Promise((resolve, reject) => {
          stream.on('data', (chunk) => chunks.push(chunk))
          stream.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))))
          stream.on('error', reject)
        })
      }
      return undefined
    } catch (error) {
      if (error.name === "NoSuchKey") {
        return undefined
      }
      console.error(`Error loading key ${key.join("/")}:`, error)
      return undefined
    }
  }

  /**
   * @param {StorageKey} key
   * @param {Uint8Array} data
   * @returns {Promise<void>}
   */
  async save(key, data) {
    try {
      const command = new PutObjectCommand({
        Bucket: this.#bucket,
        Key: this.#getFullKey(key),
        Body: data,
        ContentType: "application/octet-stream",
      })
      await this.#client.send(command)
    } catch (error) {
      console.error(`Error saving key ${key.join("/")}:`, error)
      throw error
    }
  }

  /**
   * @param {StorageKey} key
   * @returns {Promise<void>}
   */
  async remove(key) {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.#bucket,
        Key: this.#getFullKey(key),
      })
      await this.#client.send(command)
    } catch (error) {
      if (error.name !== "NoSuchKey") {
        console.error(`Error removing key ${key.join("/")}:`, error)
        throw error
      }
    }
  }

  /**
   * @param {StorageKey} keyPrefix
   * @returns {Promise<Chunk[]>}
   */
  async loadRange(keyPrefix) {
    const chunks = []
    const fullPrefix = this.#getFullKey(keyPrefix)
    
    let continuationToken = undefined
    
    do {
      try {
        const command = new ListObjectsV2Command({
          Bucket: this.#bucket,
          Prefix: fullPrefix,
          ContinuationToken: continuationToken,
        })
        
        const response = await this.#client.send(command)
        
        if (response.Contents) {
          for (const object of response.Contents) {
            if (object.Key) {
              const key = this.#stripPrefix(object.Key)
              const data = await this.load(key)
              chunks.push({ key, data })
            }
          }
        }
        
        // @ts-ignore - NextContinuationToken exists on ListObjectsV2CommandOutput
        continuationToken = response.NextContinuationToken
      } catch (error) {
        console.error(`Error loading range for prefix ${keyPrefix.join("/")}:`, error)
        break
      }
    } while (continuationToken)
    
    return chunks
  }

  /**
   * @param {StorageKey} keyPrefix
   * @returns {Promise<void>}
   */
  async removeRange(keyPrefix) {
    const fullPrefix = this.#getFullKey(keyPrefix)
    
    let continuationToken = undefined
    
    do {
      try {
        const command = new ListObjectsV2Command({
          Bucket: this.#bucket,
          Prefix: fullPrefix,
          ContinuationToken: continuationToken,
        })
        
        const response = await this.#client.send(command)
        
        if (response.Contents) {
          // Remove objects in batches
          await Promise.all(
            response.Contents.map(async (object) => {
              if (object.Key) {
                const key = this.#stripPrefix(object.Key)
                await this.remove(key)
              }
            })
          )
        }
        
        // @ts-ignore - NextContinuationToken exists on ListObjectsV2CommandOutput
        continuationToken = response.NextContinuationToken
      } catch (error) {
        console.error(`Error removing range for prefix ${keyPrefix.join("/")}:`, error)
        break
      }
    } while (continuationToken)
  }

  /**
   * Get all document IDs from R2 storage
   * @returns {Promise<string[]>}
   */
  async getAllDocumentIds() {
    const documentIds = new Set()
    let continuationToken = undefined

    do {
      try {
        const command = new ListObjectsV2Command({
          Bucket: this.#bucket,
          Prefix: this.#prefix,
          ContinuationToken: continuationToken,
        })
        
        const response = await this.#client.send(command)
        
        if (response.Contents) {
          for (const object of response.Contents) {
            if (object.Key) {
              const key = this.#stripPrefix(object.Key)
              
              // key is already an array from #stripPrefix
              if (Array.isArray(key) && key.length >= 2) {
                const documentId = key[0]
                documentIds.add(documentId)
              }
            }
          }
        }
        
        // @ts-ignore - NextContinuationToken exists on ListObjectsV2CommandOutput
        continuationToken = response.NextContinuationToken
      } catch (error) {
        console.error('Error getting document IDs from R2:', error)
        break
      }
    } while (continuationToken)

    return Array.from(documentIds)
  }
}
