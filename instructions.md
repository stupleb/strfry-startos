# strfry

## Documentation

- [strfry README](https://github.com/hoytech/strfry/blob/release/README.md) — what strfry does, its sync and command-line tools

## What you get on StartOS

One interface, **Relay**: the websocket address you add to Nostr clients. Opened in a browser, the same address shows the relay's information page.

Anyone who can reach the relay can read everything it stores. **Write Access** decides whose events it stores.

## Getting set up

1. Run **Write Access**. Leave **Who can publish** on **Only the public keys below**, add your own npub, and save. Until a key is listed, the relay accepts no events from clients.
2. Run **Relay Info** to give the relay a name, a description and your public key as its admin. Clients show these when they look the relay up.
3. To use the relay away from home, add a public domain to the **Relay** interface. Then run **Set Relay URL** and choose the `wss://` address on that domain.
4. Add the relay's address to your Nostr client's relay list.

## Using strfry

### Who can publish

**Write Access** has three modes:

- **Only the public keys below**: a personal or group relay. Events from anyone else are refused.
- **The public keys below, and anyone tagging them**: also stores replies, reactions and direct messages addressed to those keys, so the relay works as an inbox.
- **Anyone**: a public relay. Expect spam, and keep an eye on its disk use.

Changes to the list of keys apply at once. **Accept old events** lets the relay store notes older than 3 years, for example when a client republishes your history.

### Relay URL

Some clients prove who they are to the relay before publishing certain events (NIP-42). That only works through the address chosen in **Set Relay URL**, so pick the one your clients use.

### Bringing in existing notes

- **Import Public Key** copies one public key's events from any relay, such as your notes from a public relay you used before. Turn on **Include mentions** to bring in replies and reactions too. Some relays only return part of a long history.
- **Import from Relay** copies everything another relay has that this one lacks, or only what a filter selects. It needs a relay that offers negentropy sync, such as another strfry relay of your own; most public relays turn it off. Use **Import Public Key** for those.

Both skip events the relay already has, so running them again only fetches what is new. Events they import are stored whatever **Write Access** says.

These actions connect to the other relay from your server. If you publish strfry through a tunnel to keep your home IP private, send its outbound traffic through that tunnel too, or the relays you import from will see your home IP.

### Removing events

**Delete Events** removes events by public key (npub) or event ID (`note1`, `nevent1` or hex). It starts with **Preview only** on, which just counts what matches; turn it off to delete. An author who is still allowed to publish can send the same events again, so remove them from **Write Access** first.
