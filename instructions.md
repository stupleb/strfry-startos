# strfry

## Documentation

- [strfry README](https://github.com/hoytech/strfry/blob/release/README.md) — what strfry does, its sync and command-line tools

## What you get on StartOS

**Relay** is the websocket address you add to Nostr clients. Opened in a browser, the same address shows the relay's information page. While **Paid Access** is on, a second interface, **Sign-up Page**, is where people pay to publish.

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

Changes to the list of keys apply at once. **Blocked Public Keys** are refused in every mode, even if they are listed or paid. **Accept old events** lets the relay store notes older than 3 years, for example when a client republishes your history.

### Selling write access

**Paid Access** turns the relay into a paid one: anyone can read, and a public key can publish once someone has paid for it. Payments go to an LNbits wallet or a BTCPay Server store.

1. In **Write Access**, choose **Only the public keys below** or **The public keys below, and anyone tagging them**. Keys you list there never need to pay. In inbox mode, only those listed keys receive events from anyone who tags them. Paid members can publish their own events, but someone else's event that tags a paid member is refused unless that person has paid too: otherwise anyone could publish for free just by tagging a paid member.
2. Get a key that can only take payments:
   - **LNbits**: payments go into one wallet, in the LNbits account that owns it, so pick or create that wallet first. Open it and copy its **Invoice/read key** from the wallet's API info; **Configure Paid Access** calls it the **Invoice/Read Key of Destination Wallet** and, once saved, names the wallet it credits. The Admin key is refused, because it can spend.
   - **BTCPay Server**: in **Account > API Keys**, create a key with only **Create an invoice** and **View invoices** (not **Create invoices with internal lightning node** or **View invoices from internal lightning node**), using **Select specific stores** under each to limit it to your store, and note the store ID from the store's **General** settings. Whatever the store counts as paid buys access, so leave its payment tolerance at 0% unless you accept underpayments, and its speed policy above zero confirmations unless you accept unconfirmed payments.
3. Run **Configure Paid Access**, pick LNbits or BTCPay Server, and paste the key. Under **Where LNbits Runs** (or **Where BTCPay Server Runs**), choose **This server** if it's installed here: it stays private, since the sign-up page reaches it from inside your server. For one elsewhere, choose **Another server** and enter its address. For another StartOS, that's its HTTPS LAN address with the server's IP address in place of the `.local` name, plus that server's **Root CA** from **About this Server**. Set the price in sats and how long one payment lasts.
4. Add a public domain to the **Sign-up Page** interface, then check **Set Sign-up URL** has picked it. That address is what the relay gives clients that try to publish without paying, and what it lists as its payment page.
5. Share the sign-up page. A visitor enters their npub (or fills it from a browser extension), pays the invoice, and can publish within seconds. Paying again before access runs out adds to it. If your BTCPay store also takes on-chain payments, the page offers both, and an on-chain payment starts access once it confirms.

**Paid Members** lists who has paid and until when. To change a member's expiry date, remove them or ban them, copy their key from there and run **Edit Paid Member**. It also grants access to a key that hasn't paid, for example when you settle a late or underpaid BTCPay invoice by hand. A banned key goes into **Blocked Public Keys**, so it can neither publish nor pay again; to lift a ban, delete the key from that list in **Write Access**. Turning **Paid Access** off takes the page down; members keep what they paid for.

The page is in English. It shows the relay's name, description, icon, terms, privacy and contact links from **Relay Info**, so fill those in first.

### Relay URL

Some clients prove who they are to the relay before publishing certain events (NIP-42). That only works through the address chosen in **Set Relay URL**, so pick the one your clients use.

### Bringing in existing notes

- **Import from Public Key** copies one public key's events from any relay, such as your notes from a public relay you used before, or the notes of someone you follow. Turn on **Include mentions** to bring in replies, reactions and the zaps they sent or received too. Some relays only return part of a long history.
- **Import from Relay** copies everything another relay has that this one lacks, or only what a filter selects. It needs a relay that offers negentropy sync, such as another strfry relay of your own; most public relays turn it off. Use **Import from Public Key** for those.

Both skip events the relay already has, so running them again only fetches what is new. Events they import are stored whatever **Write Access** says.

These actions connect to the other relay from your server. If you publish strfry through a tunnel to keep your home IP private, send its outbound traffic through that tunnel too, or the relays you import from will see your home IP.

### Removing events

**Delete Events** removes events by public key (npub) or event ID (`note1`, `nevent1` or hex). It starts with **Preview only** on, which just counts what matches; turn it off to delete. An author who is still allowed to publish can send the same events again, so remove them from **Write Access** first.
