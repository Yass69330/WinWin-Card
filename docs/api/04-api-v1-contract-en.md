# WinWin API v1 — integration contract for point-of-sale systems

**Version 1.0 — 22 October 2026.** Audience: the developer integrating a point-of-sale
(POS) system with WinWin loyalty cards (Apple Wallet / Google Wallet). This document describes
the API as it is live in production. French reference specification:
`03-contrat-api-v1.md`.

---

## 0. Golden rule: WinWin never blocks a sale

- A customer **without a card** is checked out normally (do not call WinWin, or ignore its `404`).
- If WinWin is **down, slow or unreachable**, the sale is completed anyway; queue the call and
  send it later (§9).
- **No WinWin response** (error, refusal, timeout) may prevent, delay beyond your timeout, or
  cancel a payment. Close the sale first (or in parallel); loyalty follows. WinWin's refusals
  only ever concern the loyalty credit.

## 1. Access

| | |
|---|---|
| Base URL | `https://app.winwin-card.com/api/v1` |
| Transport | HTTPS only |
| Format | JSON (`Content-Type: application/json`), UTF-8 |
| Authentication | `Authorization: Bearer <api key>` |

- **One API key per merchant**, issued by WinWin (`wwk_live_…` for production, `wwk_test_…` for
  the test merchant). It is shown **once**; WinWin only stores a fingerprint. Lost key → a new
  key is issued and the old one revoked. Revocation takes effect within **60 seconds**.
- Keep the key **server-side or in protected POS configuration**, never on a cashier screen.
  The same key works from every till or from a central server; the store is identified by the
  `boutique` field of each call.
- **Limits**: 600 requests per minute per key (`429` + `Retry-After` beyond). After 30
  authentication failures in 15 minutes, an IP address can no longer try new keys (`429`); a
  valid key already used from that address keeps working.
- Recommended client timeout: **10 seconds**.

**Check your key**: `GET /api/v1/ping` → `200 {"ok":true,"environnement":"live"}` (or
`"test"`). Invalid key → `401 {"error":"cle_invalide"}`; suspended merchant →
`403 {"error":"commercant_suspendu"}`.

## 2. Identifying the customer's card

Each WinWin card shows a **QR code** (content: the card ID, a 36-character UUID such as
`3f6d2a1e-8b4c-4f0a-9d2e-7c1b5a9e0f12`) and a **6-character backup code** printed under the QR
and on the back (`9E0F12`, the last 6 characters of the ID).

Send in the `carte` field **either** the raw QR content **or** the backup code typed by the
cashier (case and surrounding spaces ignored).

**Without the card**: send `telephone` instead of `carte`. If that number is linked to a WinWin
card of the merchant (linked by a previous sale, §3.3, or at sign-up), that card is used. **No
credit is ever given without a card**: unknown number → `404 carte_inconnue` with
`lien_installation`, the page where the customer gets their card.

- Backup code shared by two cards (rare) → `409 carte_ambigue`: scan the QR.
- Unknown card → `404 carte_inconnue` + `lien_installation`.

## 3. Credit a sale — `POST /api/v1/ventes`

```json
{
  "reference": "BT-DXB-014-20261021-000123",
  "carte": "3f6d2a1e-8b4c-4f0a-9d2e-7c1b5a9e0f12",
  "montant": 18500,
  "devise": "AED",
  "boutique": "DXB-014",
  "date_vente": "2026-10-21T14:32:05+04:00",
  "telephone": "+971 50 123 4567"
}
```

| Field | Required | Rule |
|---|---|---|
| `reference` | **yes** | Unique, **stable** sale ID (receipt/order number), 1–64 chars from `A-Z a-z 0-9 . _ - : /`. A resent sale always carries the same reference. |
| `carte` | yes, unless `telephone` identifies the customer | QR content or backup code (§2). |
| `montant` | **yes** | **Integer in fils** (1 AED = 100 fils), amount actually paid (VAT incl., discounts deducted), > 0. AED 185.00 → `18500`. |
| `devise` | no | `"AED"` only. |
| `boutique` | yes if the merchant has store codes | Store code as configured at WinWin. |
| `date_vente` | no | ISO 8601 with timezone. At most 7 days in the past, 5 minutes in the future (else `422 date_vente_invalide`). |
| `telephone` | no | Customer number from the POS customer record, any format. With `carte`: linked to the card (§3.3). Without `carte`: identifies the card (§2). |

**Conversion** (set per merchant at WinWin): points programme → `points = floor(montant /
fils_per_point)` (default 100 fils = 1 point); stamps programme → 1 stamp per sale whatever the
amount. Above the merchant's per-sale cap (default AED 50,000) → `422 montant_hors_plafond`,
nothing credited. A sale worth 0 points → `200` with `enregistree: false`.

### 3.1 Success — `200`

```json
{
  "ok": true, "reference": "BT-DXB-014-20261021-000123",
  "enregistree": true, "deja_enregistree": false,
  "programme": "points", "points_credites": 185, "solde": 640, "seuil": 500,
  "seuil_atteint": true, "recompense_a_remettre": false, "telephone": "rattache"
}
```

| Field | Meaning |
|---|---|
| `deja_enregistree` | `true`: this reference was already credited; this is the first response again, **nothing re-credited**. Treat as success. |
| `programme` | `"points"` or `"tampons"` (stamps). |
| `solde` / `seuil` | Balance after the sale / reward threshold. |
| `seuil_atteint` | The threshold has just been reached: reward earned, **given at the next visit**. |
| `recompense_a_remettre` | **This sale is the redemption**: the cashier hands over the reward now. Points: balance restarts from the surplus (530 → 530 − 500 + 50 = 80); stamps: back to 0 (no stamp on the redemption sale). |
| `telephone` | Outcome of the phone link (§3.3); `null` if none sent. |

No personal data is ever returned.

### 3.2 Errors — body `{"error":"<code>"}` (sometimes `champ`)

None of these concerns the payment (§0).

| Status | `error` | Action on the POS side |
|---|---|---|
| 400 | `corps_invalide` (+ `champ`) | Fix the integration; do **not** resend as is. |
| 401 | `cle_invalide` | Alert support; do not resend. |
| 403 | `commercant_suspendu` / `boutique_fermee` | Do not resend. |
| 404 | `carte_inconnue` (+ `lien_installation`) | Sale without loyalty; offer the link to the customer. |
| 409 | `carte_ambigue` | Scan the QR, then resend. |
| 409 | `reference_deja_utilisee` | Same reference already used with another card or amount; do not resend. |
| 409 | `vente_annulee` | This reference was credited then cancelled; never re-credited. |
| 422 | `boutique_inconnue` / `montant_hors_plafond` / `date_vente_invalide` | Do not resend; check the data. |
| 429 | `trop_de_requetes` | **Resend the same request** after `Retry-After`. |
| 503 | `service_indisponible` | **Resend the same request** after `Retry-After`. |
| — | no response / timeout | **Resend the same request**: never a double credit. |

### 3.3 Phone number (optional)

Purpose: find the card again if the customer changes phone (§5), and credit by phone number
when the card is not at hand (§2). WinWin normalises the number (local numbers read as UAE) and
enforces **one number = one card per merchant**. A linked number is **never replaced** through
the API.

| `telephone` in the response | Meaning |
|---|---|
| `rattache` | Number linked to the card. |
| `deja_rattache` | The card already had this number. |
| `ignore_autre_numero` | The card already has another number; unchanged. |
| `ignore_numero_pris` | Number already linked to another card of the merchant; unchanged. |
| `ignore_invalide` | Unreadable number; unchanged. |
| `non_traite` | Link temporarily impossible; the sale **is** credited. Resend the number with the next sale. |

Data protection: the merchant is the data controller and WinWin the processor; the legal basis
is the data processing agreement between them. WinWin sends no SMS or message to the number.

## 4. Cancel a sale — `POST /api/v1/ventes/{reference}/annulation`

Empty body. Cancels the credit of a sale **only while it is the card's last movement** (no
sale, counter visit or adjustment since). No partial or late refund: a sale refunded after
another visit stays credited; the merchant corrects it from their WinWin dashboard.

| Status | Body | Meaning |
|---|---|---|
| 200 | `{"ok":true,"reference":"…","solde":455,"deja_annulee":false}` | Cancelled; balance restored. |
| 200 | `{"ok":true,"reference":"…","solde":455,"deja_annulee":true}` | Already cancelled (resend): treat as success. |
| 404 | `{"error":"vente_inconnue"}` | No credited sale under this reference (including a 0-point sale). |
| 409 | `{"error":"pas_le_dernier_mouvement"}` | The card has moved since: not cancellable through the API. |
| 409 | `{"error":"solde_modifie"}` | Balance no longer matches: not cancellable through the API. |

A cancelled reference can **never** be credited again (`409 vente_annulee`).

## 5. Card recovery — `POST /api/v1/recuperations`

The customer is **in store**, on a new phone, and the POS knows their number.

```json
{ "telephone": "+971 50 123 4567", "boutique": "DXB-014" }
```

`201`: `{"url":"https://app.winwin-card.com/r/…","expire_le":"…","qrcode_png":"data:image/png;base64,…","solde":455}`

Show the QR (customer display, receipt) **or** send the link to the customer by your own means.
Opened on the new phone, it installs **the same card with the same balance** (Apple Wallet or
Google Wallet); the old card stays valid. Valid **10 minutes**; every request is logged. The
cashier checks the person is the customer of the POS record (WinWin returns no name).
Errors: `404 telephone_inconnu`, `400 corps_invalide`, `429` (30 requests per 15 min per store).

## 6. Migrating existing points — `POST /api/v1/migrations`

Points already accumulated by the POS under the customer's number can be transferred **once**
to their WinWin card (typically right after a sale answered `"telephone":"rattache"`).

```json
{ "carte": "3f6d2a1e-8b4c-4f0a-9d2e-7c1b5a9e0f12", "points": 320, "boutique": "DXB-014" }
```

- `points`: integer **already converted by the merchant** (1 to 100,000); WinWin applies no rate.
  `telephone` may replace `carte` (§2).
- **Once per card**: same number resent → `200` with `deja_migree: true`, nothing re-credited;
  another number → `409 migration_deja_faite`.
- Card with a pending reward (balance at threshold) → `409 recompense_en_attente`: migrate after
  the redemption. Stamps programme: balance after migration at most the threshold, else
  `422 points_hors_bornes`.
- Not counted as a visit; no review request, no referral bonus. Corrections: through WinWin.

`200`: `{"ok":true,"deja_migree":false,"points_credites":320,"solde":320,"seuil":500,"seuil_atteint":false}`

## 7. Not available in v1.0

`GET /api/v1/cartes/{carte}` (read a balance **before** a sale) is not available yet; the sale
response already returns the balance after the sale. It can be added without breaking anything.

## 8. Testing

A **test key** (`wwk_test_…`) attached to a **test merchant** with test stores and test cards,
on the production URL; same rules and errors, real customers untouched. Acceptance checklist:
simple sale; same sale resent (`deja_enregistree`); card by backup code; unknown card; amount
above cap; 0-point sale; threshold then redemption; cancellation then resent cancellation;
cancellation refused after another sale; sale with phone then sale by phone only; card recovery;
points migration then resent migration; simulated network cut (resend); **WinWin unreachable:
the sale is still completed and the call is sent later**.

## 9. Resends: the rule

**Any request without a clear answer is resent unchanged.** It is safe: the sale reference
prevents any double credit, a resent cancellation answers `deja_annulee`, a resent migration
answers `deja_migree`. Suggested: 3 attempts at 2 s, 10 s and 60 s, then keep the sale in a queue
and resend within **7 days** (with `date_vente`). Never change a sale's reference to resend it.

## 10. Versioning

Compatible additions (new response field, new route, new error code) keep `/v1`; ignore fields
you do not know. Breaking change → `/v2`, the old version kept at least 6 months.
