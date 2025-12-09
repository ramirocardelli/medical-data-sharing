import { useState, useEffect } from 'react'
import { WalletClient } from '@bsv/sdk'
import { 
  unwrapDataKey, 
  decryptFile, 
  base64ToArrayBuffer, 
  base64ToUint8Array,
  sha256
} from '../utils/encryption'

interface WrappedKey {
  recipientKey: string
  wrappedKey: number[] // ECIES ciphertext as byte array
}

interface EncryptedImage {
  id: string
  senderKey: string
  senderAddress: string
  encryptedData: string
  iv: string
  contentHash: string
  wrappedKeys: WrappedKey[]
  fileName: string
  fileType: string
  fileSize: number
  bodyPart: string
  notes: string
  uploadTxid?: string
  accessTxids?: string[]
  createdAt: string
  expiresAt: string
  storageDuration?: number
  viewedBy: Array<{ doctorKey: string; viewedAt: string }>
  status: string
}

interface DecryptedImage extends EncryptedImage {
  decryptedUrl?: string
  isDecrypting?: boolean
  decryptionError?: string
}

interface DoctorInboxProps {
  wallet: WalletClient
  walletAddress: string
}

export default function DoctorInbox({ wallet }: DoctorInboxProps) {
  const [images, setImages] = useState<DecryptedImage[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recipientKey, setRecipientKey] = useState<string>('')
  const [selectedImage, setSelectedImage] = useState<DecryptedImage | null>(null)

  useEffect(() => {
    // Get doctor's public key
    const fetchRecipientKey = async () => {
      try {
        const result = await wallet.getPublicKey({ identityKey: true })
        setRecipientKey(result.publicKey)
      } catch (err) {
        console.error('Failed to get recipient key:', err)
        setError('Failed to get your identity key')
      }
    }
    
    fetchRecipientKey()
  }, [wallet])

  useEffect(() => {
    if (recipientKey) {
      fetchInbox()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipientKey])

  const fetchInbox = async () => {
    setIsLoading(true)
    setError(null)
    
    try {
      const response = await fetch(
        `http://localhost:3000/api/medical-images/inbox/${encodeURIComponent(recipientKey)}`
      )
      
      if (!response.ok) {
        throw new Error('Failed to fetch inbox')
      }
      
      const data = await response.json()
      setImages(data.images || [])
    } catch (err) {
      console.error('Error fetching inbox:', err)
      setError(err instanceof Error ? err.message : 'Failed to load inbox')
    } finally {
      setIsLoading(false)
    }
  }

  const handleDecryptImage = async (image: DecryptedImage) => {
    // Mark as decrypting
    setImages(prev => prev.map(img => 
      img.id === image.id ? { ...img, isDecrypting: true, decryptionError: undefined } : img
    ))

    try {
      // Step 1: Find our wrapped key
      const myWrappedKey = image.wrappedKeys?.find(wk => wk.recipientKey === recipientKey)
      
      if (!myWrappedKey) {
        throw new Error('No wrapped key found for your identity')
      }

      // Step 2: Unwrap (decrypt) the data key using wallet's private key (ECIES)
      // Pass the sender's public key as counterparty
      const dataKey = await unwrapDataKey(myWrappedKey.wrappedKey, wallet, image.senderKey)
      
      // Step 3: Convert base64 encrypted image to ArrayBuffer
      const encryptedData = base64ToArrayBuffer(image.encryptedData)
      const iv = base64ToUint8Array(image.iv)
      
      // Step 4: Decrypt the image with the data key
      const decryptedData = await decryptFile(encryptedData, iv, dataKey)
      
      // Step 5: Verify content hash (hash of ENCRYPTED data for tamper detection)
      const computedHash = await sha256(encryptedData)
      if (computedHash !== image.contentHash) {
        throw new Error('Content hash mismatch - image may have been tampered with')
      }
      
      console.log('✅ Content hash verified - image integrity confirmed')
      
      // Step 6: Record access on BSV blockchain
      const accessMetadata = JSON.stringify({
        type: 'medical-image-access',
        timestamp: new Date().toISOString(),
        imageId: image.id,
        fileName: image.fileName,
        doctorKey: recipientKey,
        patientKey: image.senderKey
      })
      
      // Convert to hex using browser API
      const encoder = new TextEncoder()
      const metadataBytes = encoder.encode(accessMetadata)
      const metadataHex = Array.from(metadataBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
      
      const accessRecord = await wallet.createAction({
        description: `Medical image access: ${image.fileName}`,
        outputs: [{
          satoshis: 1,
          lockingScript: '006a' + metadataHex, // OP_FALSE OP_RETURN + hex data
          outputDescription: 'Medical image access record'
        }]
      })

      const accessTxid = accessRecord.txid
      console.log('✅ Blockchain access recorded:', accessTxid)
      
      // Step 7: Create blob URL for display
      const blob = new Blob([decryptedData], { type: image.fileType })
      const decryptedUrl = URL.createObjectURL(blob)
      
      // Update image with decrypted data
      setImages(prev => prev.map(img => 
        img.id === image.id 
          ? { ...img, decryptedUrl, isDecrypting: false } 
          : img
      ))
      
      // Mark as viewed on backend with blockchain txid
      await fetch(`http://localhost:3000/api/medical-images/${image.id}/mark-viewed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          doctorKey: recipientKey,
          accessTxid: accessTxid
        })
      })
      
      // Open in viewer
      setSelectedImage({ ...image, decryptedUrl })
      
    } catch (err) {
      console.error('Decryption failed:', err)
      setImages(prev => prev.map(img => 
        img.id === image.id 
          ? { 
              ...img, 
              isDecrypting: false, 
              decryptionError: err instanceof Error ? err.message : 'Decryption failed' 
            } 
          : img
      ))
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString()
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  const formatStorageDuration = (days?: number) => {
    if (!days) return '90 days (default)'
    if (days === 1) return '1 day'
    if (days === 7) return '7 days'
    if (days === 30) return '30 days (1 month)'
    if (days === 90) return '90 days (3 months)'
    if (days === 180) return '180 days (6 months)'
    if (days === 365) return '1 year'
    if (days === 2555) return '7 years (compliance)'
    return `${days} days`
  }

  if (isLoading) {
    return (
      <div className="doctor-inbox">
        <h2>📥 Message Box</h2>
        <div className="loading">Loading encrypted images...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="doctor-inbox">
        <h2>📥 Message Box</h2>
        <div className="error-box">
          <strong>Error:</strong> {error}
          <button onClick={fetchInbox} className="btn btn-secondary" style={{ marginTop: 12 }}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="doctor-inbox">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>📥 Message Box</h2>
        <button onClick={fetchInbox} className="btn btn-secondary">
          🔄 Refresh
        </button>
      </div>

      {images.length === 0 ? (
        <div className="empty-state">
          <p className="muted">No encrypted images received yet.</p>
          <p className="muted" style={{ fontSize: 14 }}>
            Share your public key with patients so they can send you medical images:
          </p>
          <code style={{ display: 'block', padding: 12, background: '#f5f5f5', borderRadius: 4, marginTop: 8, wordBreak: 'break-all' }}>
            {recipientKey}
          </code>
        </div>
      ) : (
        <div className="images-list">
          <p className="muted" style={{ marginBottom: 16 }}>
            {images.length} encrypted image{images.length !== 1 ? 's' : ''} received
          </p>

          {images.map((image) => (
            <div key={image.id} className="image-card">
              <div className="image-header">
                <div>
                  <strong>{image.fileName}</strong>
                  <div className="muted" style={{ fontSize: 14 }}>
                    {image.bodyPart && `${image.bodyPart} • `}
                    {formatFileSize(image.fileSize)}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className={`status-badge status-${image.status}`}>
                    {image.status}
                  </span>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {formatDate(image.createdAt)}
                  </div>
                </div>
              </div>

              {image.notes && (
                <div className="image-notes">
                  <strong>Notes:</strong> {image.notes}
                </div>
              )}

              <div className="image-metadata">
                <div className="metadata-row">
                  <span className="muted">From:</span>
                  <code style={{ fontSize: 12 }}>{image.senderAddress || image.senderKey.slice(0, 20) + '...'}</code>
                </div>
                <div className="metadata-row">
                  <span className="muted">Storage Duration:</span>
                  <span>{formatStorageDuration(image.storageDuration)}</span>
                </div>
                <div className="metadata-row">
                  <span className="muted">Expires:</span>
                  <span>{formatDate(image.expiresAt)}</span>
                </div>
                {image.uploadTxid && (
                  <div className="metadata-row">
                    <span className="muted">📜 Upload Tx:</span>
                    <a 
                      href={`https://whatsonchain.com/tx/${image.uploadTxid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 12, color: '#0066cc' }}
                    >
                      {image.uploadTxid.slice(0, 12)}...
                    </a>
                  </div>
                )}
                {image.accessTxids && image.accessTxids.length > 0 && (
                  <div className="metadata-row">
                    <span className="muted">👁️ Access Tx:</span>
                    <a 
                      href={`https://whatsonchain.com/tx/${image.accessTxids[image.accessTxids.length - 1]}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 12, color: '#0066cc' }}
                    >
                      {image.accessTxids[image.accessTxids.length - 1].slice(0, 12)}...
                    </a>
                  </div>
                )}
              </div>

              <div className="image-actions">
                {image.decryptedUrl ? (
                  <button 
                    onClick={() => setSelectedImage(image)} 
                    className="btn btn-primary"
                  >
                    👁️ View Image
                  </button>
                ) : (
                  <button 
                    onClick={() => handleDecryptImage(image)}
                    disabled={image.isDecrypting}
                    className="btn btn-primary"
                  >
                    {image.isDecrypting ? '🔓 Decrypting...' : '🔓 Decrypt & View'}
                  </button>
                )}

                {image.decryptionError && (
                  <span className="error-text" style={{ fontSize: 14 }}>
                    ❌ {image.decryptionError}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Image Viewer Modal */}
      {selectedImage && selectedImage.decryptedUrl && (
        <div className="modal-overlay" onClick={() => setSelectedImage(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{selectedImage.fileName}</h3>
              <button 
                onClick={() => setSelectedImage(null)}
                className="btn btn-ghost"
                style={{ fontSize: 24, padding: '4px 12px' }}
              >
                ×
              </button>
            </div>
            
            <div className="modal-body">
              <img 
                src={selectedImage.decryptedUrl} 
                alt={selectedImage.fileName}
                style={{ 
                  maxWidth: '100%', 
                  maxHeight: '70vh', 
                  objectFit: 'contain',
                  borderRadius: 8
                }}
              />
              
              <div style={{ marginTop: 16, padding: 16, background: '#f9f9f9', borderRadius: 8 }}>
                <div className="metadata-row">
                  <strong>Body Part:</strong> {selectedImage.bodyPart || 'Not specified'}
                </div>
                {selectedImage.notes && (
                  <div className="metadata-row">
                    <strong>Notes:</strong> {selectedImage.notes}
                  </div>
                )}
                <div className="metadata-row">
                  <strong>From:</strong> 
                  <code style={{ fontSize: 12 }}>
                    {selectedImage.senderAddress || selectedImage.senderKey.slice(0, 40) + '...'}
                  </code>
                </div>
                <div className="metadata-row">
                  <strong>Received:</strong> {formatDate(selectedImage.createdAt)}
                </div>
                
                {/* Blockchain Transaction Links */}
                {selectedImage.uploadTxid && (
                  <div className="metadata-row">
                    <strong>📜 Upload Transaction:</strong>
                    <a 
                      href={`https://whatsonchain.com/tx/${selectedImage.uploadTxid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#0066cc', textDecoration: 'none' }}
                    >
                      View on WhatsOnChain →
                    </a>
                  </div>
                )}
                {selectedImage.accessTxids && selectedImage.accessTxids.length > 0 && (
                  <div className="metadata-row">
                    <strong>👁️ Access Transactions ({selectedImage.accessTxids.length}):</strong>
                    <div style={{ fontSize: 12, marginTop: 4 }}>
                      {selectedImage.accessTxids.map((txid, idx) => (
                        <div key={txid} style={{ marginBottom: 4 }}>
                          <a 
                            href={`https://whatsonchain.com/tx/${txid}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#0066cc', textDecoration: 'none' }}
                          >
                            Access #{idx + 1}: {txid.slice(0, 16)}...
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
