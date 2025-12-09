import { useState, useRef, type DragEvent, type ChangeEvent } from 'react'
import { WalletClient } from '@bsv/sdk'
import {
  generateDataKey,
  createEncryptedPayload,
  type EncryptedPayload
} from '../utils/encryption'

interface PatientUploadProps {
  walletAddress: string
  wallet: WalletClient
}

type UploadedFile = {
  file: File
  preview: string
  id: string
}

export default function PatientUpload({ walletAddress, wallet }: PatientUploadProps) {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [doctorPublicKeys, setDoctorPublicKeys] = useState<string>('')
  const [bodyPart, setBodyPart] = useState('')
  const [notes, setNotes] = useState('')
  const [storageDuration, setStorageDuration] = useState<number>(90)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string>('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/jpg', 'application/dicom']
  const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)

    const files = Array.from(e.dataTransfer.files)
    processFiles(files)
  }

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files)
      processFiles(files)
    }
  }

  const processFiles = (files: File[]) => {
    files.forEach((file) => {
      // Validate file type
      if (!ALLOWED_TYPES.includes(file.type) && !file.name.toLowerCase().endsWith('.dcm')) {
        alert(`${file.name}: Only JPEG, PNG, and DICOM images are allowed`)
        return
      }

      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        alert(`${file.name}: File size exceeds 10MB limit`)
        return
      }

      // Create preview
      const reader = new FileReader()
      reader.onload = (e) => {
        const preview = e.target?.result as string
        const newFile: UploadedFile = {
          file,
          preview,
          id: Math.random().toString(36).substring(7)
        }
        setUploadedFiles((prev) => [...prev, newFile])
      }
      reader.readAsDataURL(file)
    })
  }

  const removeFile = (id: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.id !== id))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (uploadedFiles.length === 0) {
      alert('Please select at least one medical image')
      return
    }

    if (!doctorPublicKeys.trim()) {
      alert('Please enter at least one doctor\'s public key')
      return
    }

    // Parse comma-separated or newline-separated public keys
    const keys = doctorPublicKeys
      .split(/[,\n]+/)
      .map(k => k.trim())
      .filter(k => k.length > 0)
    
    if (keys.length === 0) {
      alert('Please enter valid doctor public keys')
      return
    }

    setIsUploading(true)
    setUploadStatus('Getting encryption key...')

    try {
      // Step 1: Get patient's public key
      const patientKeyResult = await wallet.getPublicKey({ identityKey: true })
      const patientPublicKey = patientKeyResult.publicKey

      setUploadStatus(`Encrypting for ${keys.length} doctor(s)...`)

      // Step 2: Generate random data key for image encryption
      const dataKey = generateDataKey()

      // Step 3: Encrypt each file and wrap keys for all doctors
      const encryptedPayloads: EncryptedPayload[] = []

      for (let i = 0; i < uploadedFiles.length; i++) {
        const uploadedFile = uploadedFiles[i]
        setUploadStatus(`Encrypting ${uploadedFile.file.name} (${i + 1}/${uploadedFiles.length})...`)

        const payload = await createEncryptedPayload(
          uploadedFile.file,
          dataKey,
          keys,
          wallet
        )

        encryptedPayloads.push(payload)
      }

      setUploadStatus('Recording transaction on blockchain...')

      // Step 4: Record upload on BSV blockchain
      const uploadMetadata = JSON.stringify({
        type: 'medical-image-upload',
        timestamp: new Date().toISOString(),
        fileCount: uploadedFiles.length,
        recipientCount: keys.length,
        senderKey: patientPublicKey,
        recipientKeys: keys,
        bodyPart: bodyPart || 'unspecified'
      })
      
      // Convert to hex using browser API
      const encoder = new TextEncoder()
      const metadataBytes = encoder.encode(uploadMetadata)
      const metadataHex = Array.from(metadataBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
      
      const blockchainRecord = await wallet.createAction({
        description: `Medical image upload: ${uploadedFiles.length} file(s) to ${keys.length} doctor(s)`,
        outputs: [{
          satoshis: 1,
          lockingScript: '006a' + metadataHex, // OP_FALSE OP_RETURN + hex data
          outputDescription: 'Medical image upload record'
        }]
      })

      const txid = blockchainRecord.txid
      console.log('✅ Blockchain transaction recorded:', txid)

      setUploadStatus('Uploading encrypted images to server...')

      // Step 5: Send to backend API with txid
      const response = await fetch('http://localhost:3000/api/medical-images/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          senderKey: patientPublicKey,
          senderAddress: walletAddress,
          recipientKeys: keys,
          encryptedPayloads,
          bodyPart,
          notes,
          uploadTxid: txid,
          storageDuration: storageDuration
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to upload encrypted images')
      }

      const result = await response.json()
      console.log('Upload result:', result)

      setUploadStatus('')
      
      // Show success with blockchain link
      const durationText = storageDuration === 1 ? '1 day' : 
                          storageDuration === 7 ? '7 days' :
                          storageDuration === 30 ? '30 days' :
                          storageDuration === 90 ? '90 days' :
                          storageDuration === 180 ? '6 months' :
                          storageDuration === 365 ? '1 year' :
                          storageDuration === 2555 ? '7 years (UHRP)' :
                          `${storageDuration} days`
      
      const message = `✅ Successfully encrypted and uploaded ${uploadedFiles.length} image(s) for ${keys.length} doctor(s)!\n\nStorage duration: ${durationText}\nExpires on: ${new Date(result.expiresAt).toLocaleDateString()}\n\n📋 Blockchain Transaction:\nhttps://whatsonchain.com/tx/${txid}`
      
      alert(message)
      
      // Also log the link
      console.log('🔗 View on blockchain: https://whatsonchain.com/tx/' + txid)
      
      // Reset form
      setUploadedFiles([])
      setDoctorPublicKeys('')
      setBodyPart('')
      setNotes('')
      setStorageDuration(90)
    } catch (error) {
      console.error('Upload failed:', error)
      setUploadStatus('')
      alert('❌ Failed to encrypt and upload images:\n\n' + 
            (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="patient-upload-container">
      <h2>Upload Medical Images</h2>
      <p className="muted">
        Securely share X-rays and medical images with your doctor. Files are encrypted
        before upload.
      </p>

      <form onSubmit={handleSubmit}>
        {/* File Upload Area */}
        <div
          className={`file-drop-zone ${isDragging ? 'dragging' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/jpg,.dcm,application/dicom"
            multiple
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          
          <div className="drop-zone-content">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="drop-zone-text">
              <strong>Drop medical images here</strong> or click to browse
            </p>
            <p className="drop-zone-hint">
              JPEG, PNG, DICOM • Maximum 10MB per file
            </p>
          </div>
        </div>

        {/* File Preview Grid */}
        {uploadedFiles.length > 0 && (
          <div className="file-preview-grid">
            {uploadedFiles.map((file) => (
              <div key={file.id} className="file-preview-card">
                <img src={file.preview} alt={file.file.name} className="file-preview-image" />
                <div className="file-preview-info">
                  <p className="file-name">{file.file.name}</p>
                  <p className="file-size">
                    {(file.file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                <button
                  type="button"
                  className="file-remove-btn"
                  onClick={() => removeFile(file.id)}
                  aria-label="Remove file"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Doctor Public Keys */}
        <div className="form-group">
          <label htmlFor="doctorKeys">
            Doctor Public Keys <span className="required">*</span>
          </label>
          <textarea
            id="doctorKeys"
            value={doctorPublicKeys}
            onChange={(e) => setDoctorPublicKeys(e.target.value)}
            placeholder="Enter one or more doctor public keys (comma or newline separated)&#10;03abc123...&#10;02def456..."
            className="form-textarea"
            rows={3}
            required
          />
          <p className="form-hint">
            Enter one or more doctor public keys separated by commas or new lines. Only doctors with these keys can decrypt the images.
          </p>
        </div>

        {/* Body Part */}
        <div className="form-group">
          <label htmlFor="bodyPart">Body Part / Scan Type</label>
          <select
            id="bodyPart"
            value={bodyPart}
            onChange={(e) => setBodyPart(e.target.value)}
            className="form-input"
          >
            <option value="">Select type...</option>
            <option value="chest-xray">Chest X-ray</option>
            <option value="skull-xray">Skull X-ray</option>
            <option value="spine-xray">Spine X-ray</option>
            <option value="arm-xray">Arm X-ray</option>
            <option value="leg-xray">Leg X-ray</option>
            <option value="ct-scan">CT Scan</option>
            <option value="mri">MRI</option>
            <option value="ultrasound">Ultrasound</option>
            <option value="other">Other</option>
          </select>
        </div>

        {/* Notes */}
        <div className="form-group">
          <label htmlFor="notes">Additional Notes</label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add any relevant information for the doctor..."
            className="form-textarea"
            rows={4}
          />
        </div>

        {/* Storage Duration */}
        <div className="form-group">
          <label htmlFor="storageDuration">
            Storage Duration <span className="required">*</span>
          </label>
          <select
            id="storageDuration"
            value={storageDuration}
            onChange={(e) => setStorageDuration(Number(e.target.value))}
            className="form-input"
            required
          >
            <option value={1}>1 day (temporary share)</option>
            <option value={7}>7 days (short-term)</option>
            <option value={30}>30 days (1 month)</option>
            <option value={90}>90 days (3 months) - Default</option>
            <option value={180}>180 days (6 months)</option>
            <option value={365}>365 days (1 year)</option>
            <option value={2555}>2555 days (7 years - Compliance)</option>
          </select>
          <p className="form-hint">
            Choose how long the encrypted images will be stored. After expiration, images will be automatically deleted.
          </p>
        </div>

        {/* Submit Button */}
        <div className="form-actions">
          {uploadStatus && (
            <div className="upload-status">
              <span className="spinner">⏳</span>
              {uploadStatus}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-large"
            disabled={isUploading || uploadedFiles.length === 0 || !doctorPublicKeys.trim()}
          >
            {isUploading ? (
              <>
                <span className="spinner">⏳</span>
                Encrypting & Uploading...
              </>
            ) : (
              <>
                🔐 Encrypt & Send to Doctor
              </>
            )}
          </button>
          
          {uploadedFiles.length > 0 && !isUploading && (
            <p className="form-hint" style={{ textAlign: 'center', marginTop: 12 }}>
              {uploadedFiles.length} file{uploadedFiles.length !== 1 ? 's' : ''} ready to encrypt
            </p>
          )}
        </div>
      </form>

      {/* Info Box */}
      <div className="info-box" style={{ marginTop: 24 }}>
        <h4>🔒 How it works</h4>
        <ol style={{ marginTop: 12, paddingLeft: 20 }}>
          <li>Your images are encrypted in your browser before upload</li>
          <li>Only the doctor with the correct key can decrypt them</li>
          <li>Images are stored temporarily in Message Box (90 days)</li>
          <li>All transfers are recorded on BSV blockchain</li>
        </ol>
      </div>
    </div>
  )
}
