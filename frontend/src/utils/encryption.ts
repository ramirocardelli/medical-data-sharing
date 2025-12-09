import { WalletClient } from '@bsv/sdk'

/**
 * Encryption utilities for medical images
 * Uses ECIES encryption for key wrapping (multi-recipient support)
 * - Generate random symmetric key for image encryption
 * - Wrap symmetric key for each doctor using ECIES (wallet.encrypt)
 * - Each doctor unwraps with their private key (wallet.decrypt)
 */

/**
 * Generate a random symmetric encryption key
 */
export function generateDataKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32)) // 256-bit key
}

/**
 * Wrap (encrypt) a data key using wallet's encrypt method for a recipient's public key
 */
export async function wrapDataKey(
  dataKey: Uint8Array,
  recipientPublicKey: string,
  wallet: WalletClient
): Promise<number[]> {
  try {
    // Convert data key to array of bytes
    const dataKeyBytes = Array.from(dataKey)
    
    // Encrypt using wallet's encrypt method (ECIES)
    // Protocol names can only contain letters, numbers and spaces (no hyphens)
    const result = await wallet.encrypt({
      plaintext: dataKeyBytes,
      protocolID: [0, 'medical image encryption'],
      keyID: '1',
      counterparty: recipientPublicKey
    })
    
    return result.ciphertext
  } catch (error) {
    console.error('Failed to wrap data key:', error)
    throw new Error('Failed to wrap encryption key using ECIES')
  }
}

/**
 * Unwrap (decrypt) a wrapped data key using wallet's private key
 */
export async function unwrapDataKey(
  wrappedKey: number[],
  wallet: WalletClient,
  senderPublicKey: string
): Promise<Uint8Array> {
  try {
    // Decrypt using wallet's private key (ECIES)
    // Need to specify who encrypted it (the sender/patient)
    const result = await wallet.decrypt({
      ciphertext: wrappedKey,
      protocolID: [0, 'medical image encryption'],
      keyID: '1',
      counterparty: senderPublicKey
    })
    
    // result.plaintext is number[] (bytes) — return as Uint8Array directly
    return new Uint8Array(result.plaintext)
  } catch (error) {
    console.error('Failed to unwrap data key:', error)
    throw new Error('Failed to unwrap encryption key')
  }
}

/**
 * Encrypt a file using AES-256-GCM with a symmetric data key
 */
export async function encryptFile(
  file: File,
  dataKey: Uint8Array
): Promise<{
  encryptedData: ArrayBuffer
  iv: Uint8Array
  contentHash: string
}> {
  try {
    // Read file as ArrayBuffer
    const fileData = await file.arrayBuffer()

    // Ensure proper Uint8Array type
    const keyArray = new Uint8Array(dataKey)
    
    // Import data key as AES key
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyArray,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    )

    // Generate random IV (Initialization Vector)
    const iv = crypto.getRandomValues(new Uint8Array(12))

    // Encrypt with AES-256-GCM
    const encryptedData = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      cryptoKey,
      fileData
    )

    // Generate SHA-256 hash of encrypted data for verification
    const hashBuffer = await crypto.subtle.digest('SHA-256', encryptedData)
    const contentHash = arrayBufferToBase64(hashBuffer)

    return {
      encryptedData,
      iv,
      contentHash
    }
  } catch (error) {
    console.error('Encryption failed:', error)
    throw new Error('Failed to encrypt file')
  }
}

/**
 * Decrypt a file using AES-256-GCM with a symmetric data key
 */
export async function decryptFile(
  encryptedData: ArrayBuffer,
  iv: Uint8Array,
  dataKey: Uint8Array
): Promise<ArrayBuffer> {
  try {
    // Ensure proper Uint8Array types
    const keyArray = new Uint8Array(dataKey)
    const ivArray = new Uint8Array(iv)
    
    // Import data key as AES key
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyArray,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    )
    
    // Decrypt with AES-256-GCM
    const decryptedData = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: ivArray
      },
      cryptoKey,
      encryptedData
    )

    return decryptedData
  } catch (error) {
    console.error('Decryption failed:', error)
    throw new Error('Failed to decrypt file')
  }
}

/**
 * Generate SHA-256 hash of data
 */
export async function sha256(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return arrayBufferToBase64(hashBuffer)
}

// Helper functions for encoding/decoding

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

export function uint8ArrayToBase64(uint8: Uint8Array): string {
  const buffer = uint8.buffer instanceof ArrayBuffer ? uint8.buffer : new Uint8Array(uint8).buffer
  return arrayBufferToBase64(buffer)
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Wrapped key for a specific recipient (ECIES encrypted)
 */
export interface WrappedKey {
  recipientKey: string
  wrappedKey: number[] // ECIES ciphertext as byte array
}

/**
 * Create encrypted message payload with key wrapping for multiple recipients
 */
export interface EncryptedPayload {
  encryptedData: string // base64
  iv: string // base64
  contentHash: string
  fileName: string
  fileType: string
  fileSize: number
  wrappedKeys: WrappedKey[]
}

export async function createEncryptedPayload(
  file: File,
  dataKey: Uint8Array,
  doctorPublicKeys: string[],
  wallet: WalletClient
): Promise<EncryptedPayload> {
  const { encryptedData, iv, contentHash } = await encryptFile(file, dataKey)

  // Wrap the data key for each doctor using ECIES
  const wrappedKeys: WrappedKey[] = []
  
  for (const doctorPubKey of doctorPublicKeys) {
    const wrappedKey = await wrapDataKey(dataKey, doctorPubKey, wallet)
    
    wrappedKeys.push({
      recipientKey: doctorPubKey,
      wrappedKey: wrappedKey
    })
  }

  return {
    encryptedData: arrayBufferToBase64(encryptedData),
    iv: uint8ArrayToBase64(iv),
    contentHash,
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
    wrappedKeys
  }
}
