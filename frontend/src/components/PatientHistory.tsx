import { useState, useEffect } from 'react'
import { WalletClient } from '@bsv/sdk'

interface AccessRecord {
  doctorKey: string
  viewedAt: string
}

interface SentImage {
  id: string
  fileName: string
  fileType: string
  fileSize: number
  bodyPart: string
  notes: string
  recipientKeys: string[]
  uploadTxid?: string
  accessTxids?: string[]
  createdAt: string
  expiresAt: string
  viewedBy: AccessRecord[]
  status: string
}

interface PatientHistoryProps {
  wallet: WalletClient
  walletAddress: string
}

export default function PatientHistory({ wallet }: PatientHistoryProps) {
  const [images, setImages] = useState<SentImage[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [senderKey, setSenderKey] = useState<string>('')

  useEffect(() => {
    // Get patient's public key
    const fetchSenderKey = async () => {
      try {
        const result = await wallet.getPublicKey({ identityKey: true })
        setSenderKey(result.publicKey)
      } catch (err) {
        console.error('Failed to get sender key:', err)
        setError('Failed to get your identity key')
      }
    }
    
    fetchSenderKey()
  }, [wallet])

  useEffect(() => {
    if (senderKey) {
      fetchHistory()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [senderKey])

  const fetchHistory = async () => {
    setIsLoading(true)
    setError(null)
    
    try {
      const response = await fetch(
        `http://localhost:3000/api/medical-images/sent/${encodeURIComponent(senderKey)}`
      )
      
      if (!response.ok) {
        throw new Error('Failed to fetch history')
      }
      
      const data = await response.json()
      setImages(data.images || [])
    } catch (err) {
      console.error('Error fetching history:', err)
      setError(err instanceof Error ? err.message : 'Failed to load history')
    } finally {
      setIsLoading(false)
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'viewed': return '#28a745'
      case 'pending': return '#ffc107'
      default: return '#6c757d'
    }
  }

  if (isLoading) {
    return (
      <div className="patient-history">
        <h2>📋 My Medical Images</h2>
        <div className="loading">Loading your images...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="patient-history">
        <h2>📋 My Medical Images</h2>
        <div className="error-box">
          <strong>Error:</strong> {error}
          <button onClick={fetchHistory} className="btn btn-secondary" style={{ marginTop: 12 }}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="patient-history">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>📋 My Medical Images</h2>
        <button onClick={fetchHistory} className="btn btn-secondary">
          🔄 Refresh
        </button>
      </div>

      {images.length === 0 ? (
        <div className="empty-state">
          <p className="muted">You haven't uploaded any medical images yet.</p>
          <p className="muted" style={{ fontSize: 14, marginTop: 8 }}>
            Upload images from the "Upload" tab to share them with doctors.
          </p>
        </div>
      ) : (
        <div className="images-list">
          <p className="muted" style={{ marginBottom: 16 }}>
            {images.length} image{images.length !== 1 ? 's' : ''} uploaded
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
                  <span 
                    className="status-badge"
                    style={{ 
                      backgroundColor: getStatusColor(image.status),
                      color: 'white',
                      padding: '4px 12px',
                      borderRadius: 12,
                      fontSize: 12,
                      fontWeight: 500
                    }}
                  >
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
                  <span className="muted">Shared with:</span>
                  <span style={{ fontSize: 13 }}>
                    {image.recipientKeys.length} doctor{image.recipientKeys.length !== 1 ? 's' : ''}
                  </span>
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
              </div>

              {/* Access Log Section */}
              <div style={{ 
                marginTop: 16, 
                padding: 12, 
                backgroundColor: '#f8f9fa', 
                borderRadius: 6,
                border: '1px solid #dee2e6'
              }}>
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  marginBottom: 8 
                }}>
                  <strong style={{ fontSize: 14 }}>👁️ Access Log</strong>
                  <span style={{ 
                    fontSize: 12, 
                    color: '#6c757d',
                    backgroundColor: 'white',
                    padding: '2px 8px',
                    borderRadius: 10,
                    border: '1px solid #dee2e6'
                  }}>
                    {image.viewedBy.length} view{image.viewedBy.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {image.viewedBy.length === 0 ? (
                  <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                    Not yet viewed by any doctor
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {image.viewedBy.map((access, idx) => (
                      <div 
                        key={idx}
                        style={{ 
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: 8,
                          backgroundColor: 'white',
                          borderRadius: 4,
                          fontSize: 12
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 500, marginBottom: 2 }}>
                            Doctor: {access.doctorKey.slice(0, 16)}...
                          </div>
                          <div className="muted" style={{ fontSize: 11 }}>
                            {formatDate(access.viewedAt)}
                          </div>
                        </div>
                        {image.accessTxids && image.accessTxids[idx] && (
                          <a 
                            href={`https://whatsonchain.com/tx/${image.accessTxids[idx]}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ 
                              fontSize: 11, 
                              color: '#0066cc',
                              textDecoration: 'none',
                              padding: '4px 8px',
                              backgroundColor: '#f0f8ff',
                              borderRadius: 4
                            }}
                          >
                            📜 Tx
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recipients List */}
              <details style={{ marginTop: 12 }}>
                <summary style={{ 
                  cursor: 'pointer', 
                  fontSize: 13, 
                  fontWeight: 500,
                  color: '#495057'
                }}>
                  View Recipients ({image.recipientKeys.length})
                </summary>
                <div style={{ 
                  marginTop: 8, 
                  padding: 8, 
                  backgroundColor: '#f8f9fa',
                  borderRadius: 4,
                  fontSize: 12
                }}>
                  {image.recipientKeys.map((key, idx) => (
                    <div key={idx} style={{ 
                      marginBottom: 4,
                      wordBreak: 'break-all',
                      fontFamily: 'monospace'
                    }}>
                      {idx + 1}. {key}
                    </div>
                  ))}
                </div>
              </details>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
