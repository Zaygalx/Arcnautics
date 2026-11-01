/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BOUNTY_ESCROW_ADDRESS: string
  readonly VITE_BOUNTY_ESCROW_DEPLOY_BLOCK: string
  /** Set both mainnet values to move the app to Arc mainnet. */
  readonly VITE_BOUNTY_ESCROW_ADDRESS_MAINNET?: string
  readonly VITE_BOUNTY_ESCROW_DEPLOY_BLOCK_MAINNET?: string
  /** Reown (WalletConnect) project ID. Enables the WalletConnect option. */
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
