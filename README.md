# Medical Data Sharing

A proof of concept for **patient-controlled sharing of medical images** (X-rays) with doctors. Images are encrypted in the patient's browser, only the chosen doctors can decrypt them, and every upload and every access is recorded on the BSV blockchain as a public audit trail.

Built during my internship at the BSV Association as part of a set of proof-of-concept apps on the BSV SDK. Started from the [p2ppsr full-stack project template](https://github.com/p2ppsr/full-stack-project-template).

> **Status:** proof of concept. The end-to-end flow (encrypt → share → decrypt → audit) works locally. Several pieces of the original design are not built yet; see [What's not built yet](#whats-not-built-yet).

## The problem

Medical images are usually shared through centralized systems: a hospital portal, an email attachment, a CD. The patient has little control over who sees them, and there is no reliable record of who accessed what and when.

The goal of this PoC is to show a different model:

- **The patient decides** who can see each image.
- **Nobody in between can read it**, not even the server that stores it.
- **Every access leaves a trace** that cannot be edited afterwards.

## How it works

Users sign in with their **BSV wallet** (Metanet / BSV Desktop) and pick a role, **Patient** or **Doctor**. The wallet's identity key is the user's identity: there are no passwords or accounts.

### Patient: upload and share

1. Drag and drop one or more images (JPEG, PNG or DICOM, up to 10 MB each), choose the body part and how long they should be kept (1 day to 7 years).
2. Enter the identity keys of the doctors who should have access.
3. In the browser:
   - a random **256-bit data key** is generated and the image is encrypted with **AES-256-GCM** (Web Crypto API);
   - the data key is **wrapped separately for each doctor** with the wallet's `encrypt()` (ECIES-style, using the doctor's public key as counterparty);
   - a **SHA-256 hash** of the encrypted image is computed for tamper detection.
4. An **upload record** is written on-chain (an `OP_RETURN` output via `wallet.createAction()`) and its txid is stored with the image.
5. Only the encrypted payload, the wrapped keys and the hash are sent to the backend.

### Doctor: receive and view

1. The inbox lists the images shared with the doctor's identity key.
2. Opening one:
   - unwraps the data key with the doctor's wallet (`decrypt()`);
   - verifies the SHA-256 hash, rejecting the image if it was modified;
   - decrypts the image in the browser;
   - writes an **access record** on-chain.
3. Each image shows its full access history, with links to every transaction on WhatsOnChain.

### Patient: history

The patient sees everything they have shared, with recipients, expiry dates and which doctors have opened each image.

```
Patient browser                          Backend (Express + MongoDB)         BSV blockchain
───────────────                          ───────────────────────────         ──────────────
image ─AES-256-GCM─► ciphertext ───────► stores ciphertext + wrapped keys
data key ─wallet.encrypt()─► per doctor   (cannot decrypt anything)
upload record ─────────────────────────────────────────────────────────────► OP_RETURN tx

Doctor browser
──────────────
wrapped key ─wallet.decrypt()─► data key
ciphertext ─verify hash─► AES-256-GCM decrypt ─► image
access record ─────────────────────────────────────────────────────────────► OP_RETURN tx
```

## Design choices

| Choice | Why |
| --- | --- |
| **Envelope encryption**: one symmetric key per image, wrapped per doctor | The image is encrypted once, no matter how many doctors receive it. Adding a doctor only means wrapping one more 32-byte key. |
| **Encryption happens in the browser** | The backend only ever sees ciphertext. A database leak exposes nothing readable. |
| **The wallet is the identity** | No passwords, no user table. Keys never leave the wallet: the app asks it to encrypt and decrypt. |
| **The audit trail is on-chain, the files are not** | Files can be large and need to expire. The blockchain holds the small, permanent part: who uploaded what, and who accessed it. |
| **Expiry enforced by the server** | MongoDB stores an `expiresAt` per image and a job deletes expired images every hour. |

## Tech stack

- **Frontend:** React 19, TypeScript, Vite, `@bsv/sdk` (`WalletClient`), Web Crypto API
- **Backend:** Node.js, Express 5, MongoDB
- **Blockchain:** BSV, BRC-100 wallet interface, `OP_RETURN` records, LARS for local development

| Path | What it does |
| --- | --- |
| `frontend/src/App.tsx` | Wallet connection, role selection, session persistence |
| `frontend/src/components/PatientUpload.tsx` | Upload, encryption, sharing and the on-chain upload record |
| `frontend/src/components/PatientHistory.tsx` | Everything the patient has shared, with access status |
| `frontend/src/components/DoctorInbox.tsx` | Inbox, decryption, integrity check and the on-chain access record |
| `frontend/src/utils/encryption.ts` | Data keys, AES-GCM, key wrapping, hashing |
| `backend/src/server.ts` | Upload, inbox, sent, mark-viewed and cleanup endpoints; expiry job |
| `context.txt` | Original case study and functional spec |

## Running it locally

Requirements: Node.js 18+, Docker (for MongoDB), a [BSV Desktop wallet](https://desktop.bsvb.tech/) and LARS.

```bash
# MongoDB
docker run -d -p 27017:27017 --name medical-mongo mongo

# Backend (http://localhost:3000)
cd backend
npm install
npm run dev

# Frontend (http://localhost:5173)
cd ../frontend
npm install
npm run dev
```

Open the frontend with the BSV Desktop wallet running. To try the full flow you need two identities: one as Patient and one as Doctor.

Optional backend settings (`backend/.env`): `MONGODB_URI`, `DB_NAME`, `PORT`.

## What's not built yet

The original spec (`context.txt`) goes further than this PoC. Being explicit about the gap:

- **Message Box and UHRP:** the spec stores files in a Message Box server (short term) and UHRP (long term). This PoC uses an Express + MongoDB backend in their place. The "7 years" option is only an expiry date for now.
- **Overlay service:** the template's topic manager and lookup service are still the placeholders. Audit records are written on-chain but not indexed or queried through an overlay.
- **Backend authentication:** endpoints are not protected yet. The data stays encrypted, but anyone could list the metadata for a given identity key. The next step is BRC-103/104 mutual authentication (`@bsv/auth-express-middleware`).
- **Privacy of the on-chain records:** the `OP_RETURN` records currently include identity keys, file names and body part in plain text, which is too much to publish for medical data. A production version should record only hashes or commitments, or encrypt that metadata.
- **No tests yet.**
