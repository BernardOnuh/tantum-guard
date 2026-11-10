# Tantum Guard

A Sui wallet companion that remembers. You connect a wallet, then send or swap. Every action is checked against memory you own and simulated on Mainnet before you sign. Built for the Tatum × Walrus Memory "Total Recall" hackathon.

- **Send:** the recipient check covers addresses you blocked, lookalikes of addresses you trust (address poisoning), new or empty addresses, and object IDs. A Tatum simulation shows exactly what leaves your wallet. Successful sends are remembered, so the next check says "you've sent here N times".
- **Swap:** best route via Aftermath. The bought token is checked for tokens you blocked, fake tickers that copy a known token, missing metadata, and new packages. A Tatum simulation shows your real balance changes.
- **Check address:** a standalone lookup, plus a memory sidebar recalled live from Walrus.

- **Tatum** (Sui Mainnet GraphQL gateway, `sui-mainnet.gateway.tatum.io/graphql`): pulls the recipient's onchain history (sent and received txs, first seen, balance, wallet vs object).
- **Walrus Memory** (Mainnet): stores every trust or block decision you make, with a label and a reason. Every check recalls them, so the guard catches addresses you blocked and lookalike addresses that copy ones you trust (address poisoning), across sessions and devices.

## Run

```bash
cp .env.example .env.local   # fill in TATUM_API_KEY, MEMWAL_KEY, MEMWAL_ACCOUNT_ID
pnpm install
pnpm dev
```

Walrus Memory credentials come from https://memory.walrus.xyz (Mainnet).
