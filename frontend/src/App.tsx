import { useState, useEffect } from 'react'
import { WalletClient, PublicKey } from '@bsv/sdk'
import PatientUpload from './components/PatientUpload'
import PatientHistory from './components/PatientHistory'
import DoctorInbox from './components/DoctorInbox'
import './App.css'

type WalletSession = {
  address?: string
  publicKey?: string
  role?: 'patient' | 'doctor'
  timestamp: number
}

const WALLET_SESSION_KEY = 'medical_wallet_session'

export default function App() {
  const [isLoading, setIsLoading] = useState(false)
  const [isWalletConnected, setIsWalletConnected] = useState(false)
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [wallet, setWallet] = useState<WalletClient | null>(null)
  const [userRole, setUserRole] = useState<'patient' | 'doctor' | null>(null)
  const [patientView, setPatientView] = useState<'upload' | 'history'>('upload')

  useEffect(() => {
    // Restore session if present
    const restoreSession = async () => {
      try {
        const raw = localStorage.getItem(WALLET_SESSION_KEY)
        if (raw) {
          const session: WalletSession = JSON.parse(raw)
          
          // Recreate wallet client
          const walletClient = new WalletClient()
          const authenticated = await walletClient.isAuthenticated()
          
          if (authenticated) {
            setWallet(walletClient)
            
            // Restore role
            if (session?.role) {
              setUserRole(session.role)
            }
            
            // Prefer the explicit address field if present
            if (session?.address) {
              setWalletAddress(session.address)
              setIsWalletConnected(true)
            } else if (session?.publicKey) {
              // Fallback: convert public key to address
              try {
                const pk = PublicKey.fromString(session.publicKey)
                const addr = pk.toAddress().toString()
                setWalletAddress(addr)
                setIsWalletConnected(true)
              } catch (err) {
                console.error('Failed to convert stored publicKey to address:', err)
              }
            }
          } else {
            // Session exists but wallet not authenticated - clear session
            localStorage.removeItem(WALLET_SESSION_KEY)
          }
        }
      } catch (e) {
        console.error('Failed to restore wallet session:', e)
        localStorage.removeItem(WALLET_SESSION_KEY)
      }
    }
    
    restoreSession()
  }, [])

  const handleConnectWallet = async (role: 'patient' | 'doctor') => {
    setIsLoading(true)
    setUserRole(role)
    try {
      const walletClient = new WalletClient()
      const authenticated = await walletClient.isAuthenticated()

      if (authenticated) {
        // Get the wallet's identity public key
        const result = await walletClient.getPublicKey({ identityKey: true })
        const publicKey = PublicKey.fromString(result.publicKey)

        // Convert public key to Bitcoin address
        const address = publicKey.toAddress().toString()
        console.log('Public Key:', publicKey.toString())
        console.log('Bitcoin Address:', address)

        setWallet(walletClient)
        setWalletAddress(address)
        setIsWalletConnected(true)

        // Save session to localStorage
        const session: WalletSession = {
          address,
          role,
          timestamp: Date.now(),
        }
        localStorage.setItem(WALLET_SESSION_KEY, JSON.stringify(session))
      } else {
        throw new Error(
          'Wallet is not authenticated. Please authenticate in BSV Desktop first.'
        )
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to connect wallet'
      console.error('Failed to connect to BSV Desktop wallet:', err, errorMessage)
      alert(
        'Please download and open BSV Desktop wallet to continue. Visit https://bitcoinassociation.net/bsv-desktop/ to download.'
      )
      setIsWalletConnected(false)
      setUserRole(null)
    } finally {
      setIsLoading(false)
    }
  }



  const handleSignOut = async () => {
    setIsLoading(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const maybe: any = wallet
      if (maybe?.disconnect && typeof maybe.disconnect === 'function') {
        await maybe.disconnect()
      } else if (maybe?.logout && typeof maybe.logout === 'function') {
        await maybe.logout()
      }
    } catch (e) {
      console.warn('Error while disconnecting wallet:', e)
    }
    localStorage.removeItem(WALLET_SESSION_KEY)
    setWallet(null)
    setWalletAddress(null)
    setUserRole(null)
    setIsWalletConnected(false)
    setIsLoading(false)
  }

  return (
    <>
      <header className="app-header">
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="app-brand">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect width="24" height="24" rx="5" fill="#0ea5a4" />
              <path 
                d="M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4" 
                stroke="#07203a" 
                strokeWidth="1.5" 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                fill="none" 
              />
            </svg>
            <div>
              Medical Data Sharing
              <div className="app-subtle" style={{ fontSize: 12 }}>
                Secure P2P medical image exchange on BSV
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {isWalletConnected && userRole && (
              <>
                <span className="role-badge">
                  {userRole === 'patient' ? '🤕 Patient' : '👨‍⚕️ Doctor'}
                </span>
                <button className="btn btn-ghost" onClick={handleSignOut} disabled={isLoading}>
                  Sign out
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        <div className="container">
          <h1 style={{ marginTop: 0, fontSize: 'clamp(24px, 5vw, 32px)' }}>
            Medical Data Sharing — Sign in with BSV Desktop
          </h1>

          <p className="muted">
            Use your BSV Desktop wallet to authenticate. Share encrypted medical images peer-to-peer
            with complete privacy and blockchain-verified audit trails.
          </p>

          {!isWalletConnected && !isLoading && (
            <div className="role-selector-card">
              <h2>Select Your Role</h2>
              <p className="muted">Choose how you'll use this application:</p>
              
              <div className="role-buttons">
                <button 
                  className="role-button"
                  onClick={() => handleConnectWallet('patient')}
                  disabled={isLoading}
                >
                  <span className="role-icon">🤕</span>
                  <span className="role-name">Patient</span>
                  <span className="role-description">
                    Upload and share medical images with doctors
                  </span>
                </button>

                <button 
                  className="role-button"
                  onClick={() => handleConnectWallet('doctor')}
                  disabled={isLoading}
                >
                  <span className="role-icon">👨‍⚕️</span>
                  <span className="role-name">Doctor</span>
                  <span className="role-description">
                    Receive and review patient medical images
                  </span>
                </button>
              </div>
            </div>
          )}

          {isWalletConnected && userRole === 'patient' ? (
            <>
              {/* Patient Navigation Tabs */}
              <div style={{
                display: 'flex',
                gap: 8,
                marginBottom: 24,
                borderBottom: '2px solid #e9ecef'
              }}>
                <button
                  onClick={() => setPatientView('upload')}
                  style={{
                    padding: '12px 24px',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontSize: 15,
                    fontWeight: 500,
                    color: patientView === 'upload' ? '#0ea5a4' : '#6c757d',
                    borderBottom: patientView === 'upload' ? '3px solid #0ea5a4' : '3px solid transparent',
                    marginBottom: -2,
                    transition: 'all 0.2s'
                  }}
                >
                  📎 Upload Images
                </button>
                <button
                  onClick={() => setPatientView('history')}
                  style={{
                    padding: '12px 24px',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontSize: 15,
                    fontWeight: 500,
                    color: patientView === 'history' ? '#0ea5a4' : '#6c757d',
                    borderBottom: patientView === 'history' ? '3px solid #0ea5a4' : '3px solid transparent',
                    marginBottom: -2,
                    transition: 'all 0.2s'
                  }}
                >
                  📋 My Images
                </button>
              </div>

              {/* Patient Views */}
              {patientView === 'upload' ? (
                <PatientUpload walletAddress={walletAddress!} wallet={wallet!} />
              ) : (
                <PatientHistory walletAddress={walletAddress!} wallet={wallet!} />
              )}
            </>
          ) : isWalletConnected && userRole === 'doctor' ? (
            <DoctorInbox wallet={wallet!} walletAddress={walletAddress!} />
          ) : null}


        </div>
      </main>
    </>
  )
}
