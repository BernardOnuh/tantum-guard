import { createDAppKit } from "@mysten/dapp-kit-react";
import { SuiGraphQLClient } from "@mysten/sui/graphql";

// Every chain read the wallet flow needs (balances, coin selection, gas, simulation)
// goes through our /api/sui proxy to Tatum's Sui Mainnet GraphQL gateway.
export const dAppKit = createDAppKit({
  networks: ["mainnet"],
  createClient: (network) =>
    new SuiGraphQLClient({ network, url: `${window.location.origin}/api/sui` }),
});

declare module "@mysten/dapp-kit-react" {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}
