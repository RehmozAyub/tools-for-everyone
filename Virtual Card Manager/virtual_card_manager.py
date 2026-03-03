import streamlit as st
import random
import json
import csv
import io
import datetime
import hashlib
from pathlib import Path

# ─── Constants ───────────────────────────────────────────────────────
DATA_FILE = Path(__file__).parent / "cards.json"

CARD_PREFIXES = {
    "Visa (Test)": ["4539", "4556", "4916", "4532", "4929"],
    "Mastercard (Test)": ["5425", "5399", "5168", "5490", "5206"],
    "Amex (Test)": ["3742", "3782", "3714", "3787", "3764"],
    "Discover (Test)": ["6011", "6500", "6505", "6441", "6442"],
}

CARD_LENGTHS = {
    "Visa (Test)": 16,
    "Mastercard (Test)": 16,
    "Amex (Test)": 15,
    "Discover (Test)": 16,
}

# ─── Helpers ─────────────────────────────────────────────────────────

def luhn_checksum(card_number: str) -> int:
    digits = [int(d) for d in card_number]
    odd_digits = digits[-1::-2]
    even_digits = digits[-2::-2]
    total = sum(odd_digits)
    for d in even_digits:
        total += sum(divmod(d * 2, 10))
    return total % 10


def generate_card_number(network: str) -> str:
    prefix = random.choice(CARD_PREFIXES[network])
    length = CARD_LENGTHS[network]
    body = prefix + "".join([str(random.randint(0, 9)) for _ in range(length - len(prefix) - 1)])
    for check in range(10):
        candidate = body + str(check)
        if luhn_checksum(candidate) == 0:
            return candidate
    return body + "0"


def generate_cvv(network: str) -> str:
    if "Amex" in network:
        return "".join([str(random.randint(0, 9)) for _ in range(4)])
    return "".join([str(random.randint(0, 9)) for _ in range(3)])


def generate_expiry(months_valid: int) -> str:
    exp = datetime.date.today() + datetime.timedelta(days=months_valid * 30)
    return exp.strftime("%m/%y")


def format_card_number(num: str) -> str:
    if len(num) == 15:  # Amex
        return f"{num[:4]} {num[4:10]} {num[10:]}"
    return " ".join([num[i:i+4] for i in range(0, len(num), 4)])


def mask_card_number(num: str) -> str:
    return "•••• •••• •••• " + num[-4:]


def card_id(card: dict) -> str:
    raw = card["number"] + card["created"]
    return hashlib.sha256(raw.encode()).hexdigest()[:8]


# ─── Persistence ─────────────────────────────────────────────────────

def load_cards() -> list:
    if DATA_FILE.exists():
        with open(DATA_FILE, "r") as f:
            return json.load(f)
    return []


def save_cards(cards: list):
    with open(DATA_FILE, "w") as f:
        json.dump(cards, f, indent=2)


def export_csv(cards: list) -> str:
    buf = io.StringIO()
    writer = csv.DictWriter(
        buf,
        fieldnames=["nickname", "network", "masked_number", "expiry", "spending_cap", "spent", "remaining", "purpose", "status", "created"],
    )
    writer.writeheader()
    for c in cards:
        remaining = c["spending_cap"] - c.get("spent", 0)
        writer.writerow({
            "nickname": c.get("nickname", ""),
            "network": c["network"],
            "masked_number": mask_card_number(c["number"]),
            "expiry": c["expiry"],
            "spending_cap": f"{c['spending_cap']:.2f}",
            "spent": f"{c.get('spent', 0):.2f}",
            "remaining": f"{remaining:.2f}",
            "purpose": c.get("purpose", ""),
            "status": c.get("status", "active"),
            "created": c["created"],
        })
    return buf.getvalue()


# ─── Page Config ─────────────────────────────────────────────────────
st.set_page_config(page_title="Virtual Card Manager", page_icon="💳", layout="wide")

st.markdown(
    """
    <style>
    .card-box {
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
        border-radius: 16px;
        padding: 24px;
        color: white;
        margin-bottom: 16px;
        font-family: 'Courier New', monospace;
        position: relative;
        overflow: hidden;
        min-height: 180px;
    }
    .card-box::before {
        content: '';
        position: absolute;
        top: -50%;
        right: -50%;
        width: 100%;
        height: 100%;
        background: radial-gradient(circle, rgba(255,255,255,0.05) 0%, transparent 60%);
    }
    .card-network { font-size: 12px; opacity: 0.7; text-transform: uppercase; letter-spacing: 2px; }
    .card-number { font-size: 22px; letter-spacing: 3px; margin: 16px 0; }
    .card-detail { font-size: 13px; opacity: 0.85; }
    .card-nickname { font-size: 16px; font-weight: bold; margin-bottom: 4px; }
    .cap-bar { background: rgba(255,255,255,0.15); border-radius: 8px; height: 8px; margin-top: 10px; overflow: hidden; }
    .cap-fill { height: 100%; border-radius: 8px; transition: width 0.3s; }
    .cap-fill-ok { background: #00d2ff; }
    .cap-fill-warn { background: #f39c12; }
    .cap-fill-danger { background: #e74c3c; }
    .frozen-badge { background: #e74c3c; padding: 2px 10px; border-radius: 12px; font-size: 11px; display: inline-block; margin-left: 8px; }
    .active-badge { background: #27ae60; padding: 2px 10px; border-radius: 12px; font-size: 11px; display: inline-block; margin-left: 8px; }
    .test-banner { background: #f39c12; color: #000; text-align: center; padding: 4px; font-size: 11px; border-radius: 8px 8px 0 0; margin-bottom: -8px; font-weight: bold; letter-spacing: 1px; }
    </style>
    """,
    unsafe_allow_html=True,
)

st.title("💳 Virtual Card Manager")
st.caption("Generate test card numbers with spending caps — everything stays on your machine.")

# ─── Load State ──────────────────────────────────────────────────────
if "cards" not in st.session_state:
    st.session_state.cards = load_cards()

# ─── Sidebar: Create Card ────────────────────────────────────────────
with st.sidebar:
    st.header("➕ Create New Card")

    nickname = st.text_input("Card Nickname", placeholder="e.g. Netflix Trial")
    network = st.selectbox("Card Network", list(CARD_PREFIXES.keys()))
    currency = st.selectbox("Currency", ["USD ($)", "EUR (€)", "GBP (£)", "INR (₹)", "JPY (¥)", "CAD (C$)", "AUD (A$)"])
    spending_cap = st.number_input("Spending Cap", min_value=1.0, max_value=100000.0, value=50.0, step=5.0)
    months_valid = st.slider("Valid For (months)", 1, 36, 12)
    purpose = st.text_input("Purpose / Notes", placeholder="e.g. Free trial signup")

    if st.button("🔐 Generate Card", use_container_width=True, type="primary"):
        card = {
            "nickname": nickname or f"Card #{len(st.session_state.cards) + 1}",
            "network": network,
            "number": generate_card_number(network),
            "cvv": generate_cvv(network),
            "expiry": generate_expiry(months_valid),
            "spending_cap": spending_cap,
            "currency": currency.split(" ")[0],
            "currency_symbol": currency.split("(")[1].rstrip(")") if "(" in currency else "$",
            "spent": 0.0,
            "purpose": purpose,
            "status": "active",
            "created": datetime.datetime.now().isoformat(),
        }
        st.session_state.cards.insert(0, card)
        save_cards(st.session_state.cards)
        st.success(f"✅ {card['nickname']} created!")
        st.rerun()

    st.divider()
    st.header("🔗 Real Virtual Card Providers")
    st.markdown(
        """
        These services let you create **real** virtual cards with actual spending caps:
        - [Privacy.com](https://privacy.com) — Free virtual cards (US)
        - [Revolut](https://revolut.com) — Disposable & virtual cards (EU/UK)
        - [Wise](https://wise.com) — Multi-currency virtual cards
        - [MySudo](https://mysudo.com) — Privacy-focused virtual cards
        - [Capital One Eno](https://eno.capitalone.com) — Free virtual numbers
        """
    )

    st.divider()
    st.header("📤 Export")
    if st.session_state.cards:
        csv_data = export_csv(st.session_state.cards)
        st.download_button(
            "⬇️ Download CSV",
            data=csv_data,
            file_name=f"virtual_cards_{datetime.date.today()}.csv",
            mime="text/csv",
            use_container_width=True,
        )

# ─── Main Area ───────────────────────────────────────────────────────
if not st.session_state.cards:
    st.info("No cards yet. Use the sidebar to generate your first virtual card.")
else:
    # Stats row
    active = [c for c in st.session_state.cards if c.get("status") == "active"]
    frozen = [c for c in st.session_state.cards if c.get("status") == "frozen"]
    total_cap = sum(c["spending_cap"] for c in st.session_state.cards)
    total_spent = sum(c.get("spent", 0) for c in st.session_state.cards)

    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Total Cards", len(st.session_state.cards))
    col2.metric("Active", len(active))
    col3.metric("Frozen", len(frozen))
    col4.metric("Total Cap", f"${total_cap:,.2f}")

    st.divider()

    # Display cards
    for idx, card in enumerate(st.session_state.cards):
        spent = card.get("spent", 0)
        cap = card["spending_cap"]
        remaining = cap - spent
        pct = (spent / cap * 100) if cap > 0 else 0
        sym = card.get("currency_symbol", "$")

        if pct > 90:
            fill_class = "cap-fill-danger"
        elif pct > 60:
            fill_class = "cap-fill-warn"
        else:
            fill_class = "cap-fill-ok"

        status_badge = (
            '<span class="frozen-badge">FROZEN</span>'
            if card.get("status") == "frozen"
            else '<span class="active-badge">ACTIVE</span>'
        )

        st.markdown(
            f"""
            <div class="test-banner">⚠️ TEST CARD — NOT A REAL PAYMENT METHOD</div>
            <div class="card-box">
                <div class="card-nickname">{card.get('nickname', 'Card')} {status_badge}</div>
                <div class="card-network">{card['network']}</div>
                <div class="card-number">{format_card_number(card['number'])}</div>
                <div style="display:flex; gap:40px;">
                    <div class="card-detail">EXP: {card['expiry']}</div>
                    <div class="card-detail">CVV: {card['cvv']}</div>
                    <div class="card-detail">CAP: {sym}{cap:,.2f}</div>
                    <div class="card-detail">SPENT: {sym}{spent:,.2f}</div>
                    <div class="card-detail">LEFT: {sym}{remaining:,.2f}</div>
                </div>
                <div class="cap-bar"><div class="cap-fill {fill_class}" style="width:{min(pct,100):.1f}%"></div></div>
            </div>
            """,
            unsafe_allow_html=True,
        )

        # Action buttons
        bcol1, bcol2, bcol3, bcol4, bcol5 = st.columns(5)

        with bcol1:
            add_amount = st.number_input(
                "Add charge",
                min_value=0.0,
                max_value=remaining if remaining > 0 else 0.01,
                value=0.0,
                step=1.0,
                key=f"charge_{idx}",
                label_visibility="collapsed",
            )
        with bcol2:
            if st.button("💰 Log Charge", key=f"log_{idx}", disabled=card.get("status") == "frozen"):
                if add_amount > 0:
                    st.session_state.cards[idx]["spent"] = spent + add_amount
                    save_cards(st.session_state.cards)
                    st.rerun()
        with bcol3:
            if card.get("status") == "active":
                if st.button("🧊 Freeze", key=f"freeze_{idx}"):
                    st.session_state.cards[idx]["status"] = "frozen"
                    save_cards(st.session_state.cards)
                    st.rerun()
            else:
                if st.button("☀️ Unfreeze", key=f"unfreeze_{idx}"):
                    st.session_state.cards[idx]["status"] = "active"
                    save_cards(st.session_state.cards)
                    st.rerun()
        with bcol4:
            if st.button("🔄 Reset Spend", key=f"reset_{idx}"):
                st.session_state.cards[idx]["spent"] = 0.0
                save_cards(st.session_state.cards)
                st.rerun()
        with bcol5:
            if st.button("🗑️ Delete", key=f"del_{idx}"):
                st.session_state.cards.pop(idx)
                save_cards(st.session_state.cards)
                st.rerun()

        if card.get("purpose"):
            st.caption(f"📝 {card['purpose']}")

        st.markdown("---")

# ─── Footer ──────────────────────────────────────────────────────────
st.markdown(
    """
    ---
    <div style="text-align:center; opacity:0.5; font-size:13px;">
    ⚠️ These are <b>test/virtual numbers only</b> — they will NOT process real payments.<br>
    For real virtual cards, use services like <a href="https://privacy.com">Privacy.com</a>,
    <a href="https://revolut.com">Revolut</a>, or <a href="https://wise.com">Wise</a>.<br>
    All data is stored locally in <code>cards.json</code> — nothing leaves your machine.
    </div>
    """,
    unsafe_allow_html=True,
)
