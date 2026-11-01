/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 *
 * Wallets: every browser wallet that announces itself through EIP-6963 becomes a connector
 * automatically (wagmi's multi-injected discovery). `injected()` covers wallets that only set
 * window.ethereum. WalletConnect is added when VITE_WALLETCONNECT_PROJECT_ID is set.
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arc, arcTestnet } from 'viem/chains'
import { injected, walletConnect } from 'wagmi/connectors'
import { requireChain } from './onchain-facts'
import { registerChain } from './tracing'

const arcTestnetRpc = requireChain(arcTestnet.id).rpcUrls[0]
const arcMainnetRpc = requireChain(arc.id).rpcUrls[0]

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, arcTestnetRpc)
registerChain(arc.id, arcMainnetRpc)

export const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || undefined

export const config = createConfig({
  chains: [arcTestnet, arc, mainnet], // mainnet (Ethereum) needed for ENS resolution
  multiInjectedProviderDiscovery: true,
  connectors: [
    injected(),
    ...(walletConnectProjectId
      ? [
          walletConnect({
            projectId: walletConnectProjectId,
            showQrModal: false,
            metadata: {
              name: 'Agent bounties',
              description: 'USDC bounty escrow for AI agents on Arc',
              url: typeof window === 'undefined' ? 'https://studio.arc.io' : window.location.origin,
              icons: [],
            },
          }),
        ]
      : []),
  ],
  transports: {
    [arcTestnet.id]: http(arcTestnetRpc),
    [arc.id]: http(arcMainnetRpc),
    [mainnet.id]: http(), // ENS resolution uses Ethereum mainnet
  },
})
