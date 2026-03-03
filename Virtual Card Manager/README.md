# 💳 Virtual Card Manager

A privacy-focused virtual/test card generator and spending tracker built with **Streamlit**.  
Everything runs locally — no data leaves your machine.

> ⚠️ **These are test card numbers only.** They pass Luhn validation but will NOT process real payments. For real virtual cards, see the provider links inside the app.

## Features

### Generate
| Feature | Description |
|---------|-------------|
| 🏦 Networks | Visa, Mastercard, Amex, Discover (test prefixes) |
| ✅ Luhn-valid | Numbers pass checksum validation — useful for testing checkout flows |
| 💰 Spending Cap | Set a max limit per card (1 – 100,000) |
| 💱 Multi-Currency | USD, EUR, GBP, INR, JPY, CAD, AUD |
| 📅 Expiry Control | Choose validity from 1–36 months |
| 🏷️ Nicknames & Notes | Label cards by purpose (e.g. "Netflix Trial", "Dev Testing") |

### Manage
- **Visual card UI** — styled credit-card display with network, number, CVV, expiry
- **Spending tracker** — log charges against each card and see remaining balance
- **Progress bar** — color-coded (blue → orange → red) as spending approaches the cap
- **Freeze / Unfreeze** — disable a card without deleting it
- **Reset spending** — zero out the spent amount
- **Delete** — permanently remove a card

### Export & Privacy
- **CSV export** — download all card data (masked numbers) as CSV
- **Local storage** — everything persists in `cards.json` beside the script
- **No server, no API calls** — fully offline, zero telemetry

### Real Provider Links
The sidebar includes links to services that issue **real** virtual cards with actual spending caps:
- [Privacy.com](https://privacy.com) — Free virtual cards (US)
- [Revolut](https://revolut.com) — Disposable & virtual cards (EU/UK)
- [Wise](https://wise.com) — Multi-currency virtual cards
- [MySudo](https://mysudo.com) — Privacy-focused virtual cards

## Installation

```bash
pip install -r requirements.txt
```

## Usage

```bash
cd "Virtual Card Manager"
streamlit run virtual_card_manager.py
```

Then open `http://localhost:8501` in your browser.

## Dependencies

- **Streamlit** — Web UI framework

## License

MIT — see [LICENSE](../LICENSE)
