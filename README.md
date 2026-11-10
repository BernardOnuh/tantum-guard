# Tantum Guard

Check a Sui recipient before you send, using memory you own. Built for the Tatum × Walrus Memory "Total Recall" hackathon.

- **Tatum** (Sui Mainnet RPC gateway): pulls the recipient's onchain history (sent and received txs, first seen, balance, wallet vs object).
- **Walrus Memory** (Mainnet): stores every trust or block decision you make, with a label and a reason. Every check recalls them, so the guard catches addresses you blocked and lookalike addresses that copy ones you trust (address poisoning), across sessions and devices.

## Run

```bash
cp .env.example .env.local   # fill in TATUM_API_KEY, MEMWAL_KEY, MEMWAL_ACCOUNT_ID
pnpm install
pnpm dev
```

Walrus Memory credentials come from https://memory.walrus.xyz (Mainnet).
