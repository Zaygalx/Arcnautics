# [App Name]

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

[Brief description of what the app does and its primary use case]

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## Share links

- Starter apps already ship `getShareBase`, `buildShareLink` and `installShareSync` in `src/lib/share.ts`; import them instead of rewriting them.
- Keep shareable state in the URL path or query, not in the `#fragment`.
- Never put a secret (private key, claim secret, seed phrase, session token, API key) in the URL path or query, encoded or not: every in-app path and query is mirrored to the visitor's studio.arc.io address bar and browser history and reaches servers. A bearer claim secret goes only in the `#fragment` appended to the share link (`` `${await buildShareLink('/claim')}#${secret}` ``) and is read from `location.hash` on load. A link to the app's own share URL shown inside the app must be copy-only or open in a new tab with `target="_blank" rel="noopener noreferrer"`.
- Build every link a user copies or sends with `buildShareLink()` from `src/lib/share.ts`.
- Keep the `installShareSync()` call in `src/main.tsx` when editing it; it keeps the Studio address bar in step with in-app navigation.
- Navigate inside the app with relative links.

## To Run

```bash
bun install
bun run dev
```

---

## Bounty Escrow (current app)

- What it does: USDC bounty escrow for AI agents. Client posts (description hash, reward, deadline, optional designated agent) and locks USDC; agent claims, submits a result hash; client accepts (pays) or rejects (reopens); client refunds after the deadline. A claim can be released by the agent anytime, or by the client after `CLAIM_WINDOW` (which also bars that agent from the bounty).
- Contract: `contracts/BountyEscrow.sol`, tests in `contracts/test/BountyEscrow.t.sol` (80 tests incl. invariants).
- Deployed on Arc Testnet: `0xebc966f9e90f0896d94e358eb37e1fdfeef3f9d3` (deploy block 70139578), constructor args: USDC `0x3600000000000000000000000000000000000000`, `claimWindow` 3600 seconds. Address and block are in `.env` as `VITE_BOUNTY_ESCROW_ADDRESS` / `VITE_BOUNTY_ESCROW_DEPLOY_BLOCK`.
- Known limits: open bounties are permissionless to claim, so use the designated agent for contested work. A Circle-blocklisted agent cannot be paid (client can reject or refund after the deadline).
- Frontend: `src/lib/escrow.ts` (ABI, errors, helpers), `src/hooks/` (reads, wallet actions, event scanning), `src/components/`. Readable task/result text is kept in localStorage (`src/lib/texts.ts`) because only hashes go onchain.
