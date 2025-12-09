import express, { Request, Response } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { MongoClient, Db, ObjectId } from 'mongodb'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000

// Middleware
app.use(cors())
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true, limit: '50mb' }))

// Global variables
let db: Db

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017'
const DB_NAME = process.env.DB_NAME || 'medical_data_sharing'

async function initializeDatabase() {
  const client = await MongoClient.connect(MONGODB_URI)
  db = client.db(DB_NAME)
  
  // Create indexes for efficient querying
  await db.collection('encrypted_images').createIndex({ recipientKey: 1, createdAt: -1 })
  await db.collection('encrypted_images').createIndex({ senderKey: 1, createdAt: -1 })
  await db.collection('encrypted_images').createIndex({ expiresAt: 1 })
  
  console.log('✓ Connected to MongoDB')
  console.log('✓ Created indexes for encrypted_images collection')
  return db
}

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Store encrypted medical images
app.post('/api/medical-images/upload', async (req: Request, res: Response) => {
  try {
    const {
      senderKey,
      senderAddress,
      recipientKeys,
      encryptedPayloads,
      bodyPart,
      notes,
      uploadTxid,
      storageDuration
    } = req.body

    if (!senderKey || !recipientKeys || !Array.isArray(recipientKeys) || !encryptedPayloads || !Array.isArray(encryptedPayloads)) {
      return res.status(400).json({ 
        error: 'Missing required fields: senderKey, recipientKeys (array), encryptedPayloads' 
      })
    }

    const timestamp = new Date()
    // Use custom storage duration or default to 90 days
    const durationDays = storageDuration || 90
    const expiresAt = new Date(timestamp.getTime() + durationDays * 24 * 60 * 60 * 1000)

    // Store each encrypted image (one copy, but accessible by multiple doctors via wrapped keys)
    const insertedIds: string[] = []

    for (const payload of encryptedPayloads) {
      const document = {
        senderKey,
        senderAddress,
        recipientKeys, // Array of doctor public keys
        wrappedKeys: payload.wrappedKeys || [], // Array of wrapped keys (one per doctor)
        encryptedData: payload.encryptedData,
        iv: payload.iv,
        contentHash: payload.contentHash,
        fileName: payload.fileName,
        fileType: payload.fileType,
        fileSize: payload.fileSize,
        bodyPart: bodyPart || '',
        notes: notes || '',
        storageDuration: durationDays, // Store the chosen duration
        uploadTxid: uploadTxid || null, // Blockchain transaction ID for upload
        accessTxids: [], // Array of blockchain transaction IDs for each access
        createdAt: timestamp,
        expiresAt,
        viewedBy: [], // Track which doctors have viewed
        status: 'pending'
      }

      const result = await db.collection('encrypted_images').insertOne(document)
      insertedIds.push(result.insertedId.toString())
    }

    res.json({
      success: true,
      message: `Successfully stored ${encryptedPayloads.length} encrypted image(s) for ${recipientKeys.length} doctor(s)`,
      imageIds: insertedIds,
      expiresAt
    })
  } catch (error) {
    console.error('Error storing encrypted images:', error)
    res.status(500).json({ error: 'Failed to store encrypted images' })
  }
})

// Get encrypted images for a recipient (doctor's inbox)
app.get('/api/medical-images/inbox/:recipientKey', async (req: Request, res: Response) => {
  try {
    const { recipientKey } = req.params
    const { status } = req.query

    const query: Record<string, unknown> = {
      recipientKeys: recipientKey, // Check if doctor's key is in the array
      expiresAt: { $gt: new Date() } // Only non-expired images
    }

    if (status) {
      query.status = status
    }

    const images = await db.collection('encrypted_images')
      .find(query)
      .sort({ createdAt: -1 })
      .toArray()

    res.json({
      success: true,
      count: images.length,
      images: images.map(img => ({
        id: img._id.toString(),
        senderKey: img.senderKey,
        senderAddress: img.senderAddress,
        encryptedData: img.encryptedData,
        iv: img.iv,
        contentHash: img.contentHash,
        wrappedKeys: img.wrappedKeys, // Include all wrapped keys
        fileName: img.fileName,
        fileType: img.fileType,
        fileSize: img.fileSize,
        bodyPart: img.bodyPart,
        notes: img.notes,
        uploadTxid: img.uploadTxid,
        accessTxids: img.accessTxids || [],
        createdAt: img.createdAt,
        expiresAt: img.expiresAt,
        viewedBy: img.viewedBy || [],
        status: img.status
      }))
    })
  } catch (error) {
    console.error('Error fetching encrypted images:', error)
    res.status(500).json({ error: 'Failed to fetch encrypted images' })
  }
})

// Get sent images for a patient
app.get('/api/medical-images/sent/:senderKey', async (req: Request, res: Response) => {
  try {
    const { senderKey } = req.params

    const images = await db.collection('encrypted_images')
      .find({
        senderKey,
        expiresAt: { $gt: new Date() }
      })
      .sort({ createdAt: -1 })
      .toArray()

    res.json({
      success: true,
      count: images.length,
      images: images.map(img => ({
        id: img._id.toString(),
        fileName: img.fileName,
        fileType: img.fileType,
        fileSize: img.fileSize,
        bodyPart: img.bodyPart,
        notes: img.notes,
        recipientKeys: img.recipientKeys || [],
        uploadTxid: img.uploadTxid,
        accessTxids: img.accessTxids || [],
        createdAt: img.createdAt,
        expiresAt: img.expiresAt,
        viewedBy: img.viewedBy || [],
        status: img.status
      }))
    })
  } catch (error) {
    console.error('Error fetching sent images:', error)
    res.status(500).json({ error: 'Failed to fetch sent images' })
  }
})

// Mark image as viewed by a specific doctor
app.post('/api/medical-images/:imageId/mark-viewed', async (req: Request, res: Response) => {
  try {
    const { imageId } = req.params
    const { doctorKey, accessTxid } = req.body

    if (!doctorKey) {
      return res.status(400).json({ error: 'doctorKey is required' })
    }

    const updateOperations: Record<string, unknown> = {
      $addToSet: { viewedBy: { doctorKey, viewedAt: new Date() } },
      $set: { status: 'viewed' }
    }

    // Add accessTxid to array if provided
    if (accessTxid) {
      updateOperations.$push = { accessTxids: accessTxid }
    }

    const result = await db.collection('encrypted_images').updateOne(
      { _id: new ObjectId(imageId) },
      updateOperations
    )

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Image not found' })
    }

    res.json({ success: true, message: 'Image marked as viewed' })
  } catch (error) {
    console.error('Error marking image as viewed:', error)
    res.status(500).json({ error: 'Failed to mark image as viewed' })
  }
})

// Automatic cleanup function for expired images
async function cleanupExpiredImages() {
  try {
    const now = new Date()
    const result = await db.collection('encrypted_images').deleteMany({
      expiresAt: { $lt: now }
    })

    if (result.deletedCount > 0) {
      console.log(`🗑️  Cleaned up ${result.deletedCount} expired image(s) at ${now.toISOString()}`)
    }
    
    return result.deletedCount
  } catch (error) {
    console.error('Error in automatic cleanup:', error)
    return 0
  }
}

// Delete expired images (manual cleanup endpoint)
app.delete('/api/medical-images/cleanup', async (req: Request, res: Response) => {
  try {
    const deletedCount = await cleanupExpiredImages()

    res.json({
      success: true,
      message: `Deleted ${deletedCount} expired image(s)`,
      deletedCount
    })
  } catch (error) {
    console.error('Error cleaning up expired images:', error)
    res.status(500).json({ error: 'Failed to cleanup expired images' })
  }
})

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: unknown) => {
  console.error('Unhandled error:', err)
  res.status(500).json({ error: 'Internal server error' })
})

// Start server
async function startServer() {
  try {
    await initializeDatabase()
    
    // Start automatic cleanup job (runs every hour)
    const CLEANUP_INTERVAL_MS = 60 * 60 * 1000 // 1 hour
    console.log(`🔄 Starting automatic cleanup job (every ${CLEANUP_INTERVAL_MS / 1000 / 60} minutes)`)
    
    // Run cleanup immediately on startup
    cleanupExpiredImages()
    
    // Schedule periodic cleanup
    setInterval(() => {
      cleanupExpiredImages()
    }, CLEANUP_INTERVAL_MS)
    
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`)
      console.log(`📊 MongoDB connected to ${DB_NAME}`)
      console.log(`✅ Ready to accept encrypted medical images`)
    })
  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}

startServer()
