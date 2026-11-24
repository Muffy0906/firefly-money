# Log Apple Pay purchases automatically

When you pay with Apple Pay on your iPhone, a Shortcuts automation sends the amount, merchant and card to Money, and Money adds the expense in Firefly III straight away. It takes about five minutes to set up.

iOS doesn't let apps read your bank's notifications, so this only covers **Apple Pay** taps (in stores, and in apps or websites that use Apple Pay). Card swipes, online card entry and bank transfers still need adding by hand or by importing.

## What you need

- iOS 17 or newer.
- Your iPhone must be able to reach Money **at the moment you pay**. On your home Wi-Fi that's the usual address, but in a shop it isn't, so use a VPN that's always on (Tailscale, WireGuard) or a reverse proxy with HTTPS (see the README). If Money can't be reached, the payment still goes through. It just isn't logged.
- In Firefly, an asset or liability account for each card. Money finds it from the card's name in Wallet: the same name, one name inside the other ("Chase Sapphire" matches "Chase Sapphire Preferred"), the card's last four digits at the end of the account number, or the words the names share, leaving out words like *card*, *credit* or *visa* ("Freedom Unlimited" matches "Chase Freedom"). When the names are too different, pick the account in **Settings → Apple Pay → Cards** (see below).

## 1. Copy the address and key

In Money, open **Settings → Apple Pay** and copy the **Address** (ends in `/api/money-ingest`) and the **Key**. Treat the key like a password: anyone with it can add expenses (but can't read anything). Changing `DASH_PASSWORD` or `FIREFLY_TOKEN` gives a new key, and you'll need to paste it into the Shortcut again.

## 2. Make the automation

### The quick way: add the ready-made shortcut

1. On your iPhone, open [**Log to Money**](https://www.icloud.com/shortcuts/0438843e50e74fb89c7fa20e4eda6ca0) and tap **Add Shortcut**. It asks for the **Address** and **Key** from step 1: paste them in.
2. Open **Shortcuts → Automation**, tap **+**, and pick **Transaction**. Choose the cards, leave **When I Tap** on, pick **Run Immediately**, and tap **Next**.
3. Pick **Run Shortcut**, choose **Log to Money**, and set its input to **Shortcut Input**.

That's it. Skip to step 3 below. To add the location, a category menu or a fixed account, edit **Log to Money** as described under *Optional extras*.

### Or build it yourself

1. Open **Shortcuts → Automation**, tap **+**, and pick **Transaction**.
2. Choose the cards to watch (or all of them), leave **When I Tap** on, and pick **Run Immediately** so it doesn't ask each time. Tap **Next**, then **New Blank Automation**.
3. Add the action **Get Contents of URL** and set it up:
   - **URL:** the address from Settings.
   - **Method:** POST.
   - **Headers:** add `Authorization` with the value `Bearer ` followed by the key (one space after `Bearer`).
   - **Request Body:** JSON, with three Text fields:
     - `amount` → tap and pick **Shortcut Input**, then tap it again and choose **Amount**.
     - `merchant` → **Shortcut Input → Merchant**.
     - `card` → **Shortcut Input → Card or Pass**.
4. Optional: add **Show Notification** with **Contents of URL** as the text. Money answers with a short line like `Logged 4.75 at Blue Bottle (Apple Card).`, or says what went wrong.

To always use one account whatever the card, add a fourth field `account` with that account's name in Firefly.

### Optional extras

- **Where you paid.** Before **Get Contents of URL**, add **Get Current Location**. Then add two more Text fields to the JSON: `latitude` → **Current Location → Latitude**, and `longitude` → **Current Location → Longitude**. Money saves coordinates in Firefly's location fields, separate from notes, and the purchase shows up as a pin on Money's **Map** page. The first time it runs, iOS asks to let Shortcuts use your location.
- **Pick a category as you pay.** Before **Get Contents of URL**, add **Choose from Menu** with your usual categories plus `Skip`. In each option add a **Text** action holding that category's name, then set a `category` field to the **Chosen Item** / menu result. Money uses it instead of last time's category, and `Skip` keeps last time's. You'll have to answer the menu at the register, so leave this out if you'd rather not.
- **Other currencies** need nothing extra: Wallet's amount carries its currency (`€8.00`). Money records what you paid as the foreign amount, and the account's amount using Firefly's latest exchange rate (Settings → Exchange rates), noting it's an estimate. With no rate in Firefly, it uses the same number and tags it **Check amount**, so you can fix it when the bank posts the charge.

## 3. Check the cards

A card Money can't place is refused with `Money doesn’t know which account the card "…" is`, and it then shows up under **Settings → Apple Pay → Cards** marked *Needs an account*. Pick its account there, and the next payment goes through. To set a card up before you pay with it, type its name exactly as Wallet shows it and pick the account. The choices are saved in Firefly, so every device sees them.

A test payment from a throwaway shortcut with `amount` `0.01`, `merchant` `Money test` and your card's name is a quick way to check, without spending anything.

## What gets logged

- A withdrawal from the card's account to the merchant (Firefly creates the payee if it's new), dated now. **Apple Pay** is added as a tag when enabled in Money → Settings → Apple Pay.
- The category, budget and tags from the merchant's most recent categorized/tagged movements. Your Firefly rules then run on it too, so they can rename or recategorize it.
- A negative amount (a refund) is logged as income from the merchant.
- With the extras: where you paid, the category you picked, and the foreign amount and currency.
- If the same payment is sent twice, Firefly spots the duplicate and Money answers `Already logged.`
- If a payment with the same merchant and amount is already in that account from the last 12 hours (a double tap, or two automations), Money does not log it again and answers `Not logged: … is already there`. To log it anyway, add `"force": true` to the request.

Apple runs the automation when you tap, before the bank approves the payment, so a declined payment is logged as well. Delete it in Money if that happens. To check everything logged this way, search for the tag `Apple Pay`.

## If it doesn't work

| Money says | Fix |
| --- | --- |
| `Wrong key` | Copy the key again from Settings, and check the header is `Bearer <key>` with one space. |
| `Money doesn’t know which account the card "…" is` | Pick its account in Settings → Apple Pay → Cards, then pay again. |
| `No account is called "…"` | The Shortcut's `account` field doesn't match a Firefly account name. The message lists your accounts. |
| `No amount` | The `amount` field isn't set to **Shortcut Input → Amount**. |
| Nothing at all / a timeout | Your iPhone can't reach Money from where you are (see *What you need*). |
