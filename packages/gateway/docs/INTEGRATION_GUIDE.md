# FluxPay // Developer Integration Guide

FluxPay is a high-performance, automated UPI payment gateway engine powered by Fluxbase. This guide walks you through integrating FluxPay into your web or mobile applications.

---

## 1. Base URL & Authentication

- **Production API URL**: `https://payments.fluxbasedb.me`
- **Local Dev URL**: `http://localhost:3001`

All API requests require your merchant API key passed via the `Authorization` header:

```http
Authorization: Bearer sec_live_YOUR_MERCHANT_KEY
Content-Type: application/json
```

> You can find or rotate your secret API key anytime inside your Merchant Dashboard at:
> `https://payments.fluxbasedb.me/dashboard/apikeys`

---

## 2. Create a Payment Order

When your customer clicks "Pay" or "Checkout", make a `POST` request to `/api/v1/orders`.

### Endpoint
`POST https://payments.fluxbasedb.me/api/v1/orders`

### Request Headers
| Header | Value | Description |
| :--- | :--- | :--- |
| `Authorization` | `Bearer sec_live_...` | Your secret live API key |
| `Content-Type` | `application/json` | Required |
| `idempotency-key` | `optional-unique-uuid` | Prevents double-charging if retried |

### Request Body
```json
{
  "amount": 499.00,
  "coupon_code": "SAVE20",
  "customer_name": "Rajesh Kumar",
  "customer_email": "rajesh@example.com",
  "customer_phone": "9876543210",
  "callback_url": "https://yourapp.com/checkout/success",
  "webhook_url": "https://yourapp.com/api/webhooks/fluxpay",
  "metadata": {
    "user_id": "usr_94812",
    "plan": "pro_monthly"
  }
}
```

### Success Response (`201 Created`)
```json
{
  "success": true,
  "order_id": "ord_8f921b7c",
  "order": {
    "id": "ord_8f921b7c",
    "amount": 499,
    "final_amount": 499.14,
    "vpa": "sumith0909@ibl",
    "status": "pending",
    "expires_at": "2026-09-09T01:30:00.000Z"
  },
  "checkout_url": "https://payments.fluxbasedb.me/pay/ord_8f921b7c"
}
```

### Next Action:
Redirect your user to `checkout_url`. The user will see a dynamic QR code and instant UPI intent buttons (GPay, PhonePe, Paytm, BHIM, Cred).

---

## 3. Implementation Code Examples

### A. Node.js / TypeScript (Next.js, Express)

```typescript
import axios from 'axios';

export async function createCheckoutSession(userId: string, amount: number) {
  const response = await axios.post(
    'https://payments.fluxbasedb.me/api/v1/orders',
    {
      amount,
      callback_url: 'https://yourapp.com/orders/success',
      webhook_url: 'https://yourapp.com/api/webhooks/fluxpay',
      metadata: { userId }
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.FLUXPAY_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  // Redirect the user to this checkout URL
  return response.data.checkout_url;
}
```

### B. Python (FastAPI / Django / Flask)

```python
import os
import requests

def create_checkout_session(user_id: str, amount: float) -> str:
    api_key = os.environ.get("FLUXPAY_API_KEY")
    
    payload = {
        "amount": amount,
        "callback_url": "https://yourapp.com/orders/success",
        "webhook_url": "https://yourapp.com/api/webhooks/fluxpay",
        "metadata": {"user_id": user_id}
    }
    
    res = requests.post(
        "https://payments.fluxbasedb.me/api/v1/orders",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        },
        json=payload
    )
    
    return res.json()["checkout_url"]
```

### C. cURL

```bash
curl -X POST https://payments.fluxbasedb.me/api/v1/orders \
  -H "Authorization: Bearer sec_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 299.00,
    "customer_name": "Sumith",
    "callback_url": "https://yourapp.com/success"
  }'
```

---

## 4. Webhook Notification & HMAC Signature Verification

When the customer makes the UPI payment and the bank SMS is reconciled, FluxPay immediately sends a `POST` request to your `webhook_url`.

### Webhook Event Payload (`payment.succeeded`)
```json
{
  "event": "payment.succeeded",
  "order_id": "ord_8f921b7c",
  "amount": 499.14,
  "base_amount": 499.00,
  "utr": "625374829102",
  "paid_at": "2026-09-09T01:25:34.000Z",
  "customer": {
    "name": "Rajesh Kumar",
    "email": "rajesh@example.com",
    "phone": "9876543210"
  },
  "metadata": {
    "user_id": "usr_94812"
  }
}
```

### Verifying HMAC Signature (Security Requirement)

FluxPay sends the `X-FluxPay-Signature` header with every webhook:
```http
X-FluxPay-Signature: t=1725839000,v1=9c23b4...
```

To verify the signature in Node.js:

```typescript
import crypto from 'crypto';

export function verifyFluxPayWebhook(
  rawBody: string,
  signatureHeader: string,
  secret: string
): boolean {
  // Parse header
  const parts = Object.fromEntries(
    signatureHeader.split(',').map(kv => kv.split('='))
  );
  
  const timestamp = parts['t'];
  const expectedSignature = parts['v1'];
  if (!timestamp || !expectedSignature) return false;

  // Compute expected HMAC SHA-256
  const payloadToSign = `${timestamp}.${rawBody}`;
  const computedSignature = crypto
    .createHmac('sha256', secret)
    .update(payloadToSign)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(computedSignature),
    Buffer.from(expectedSignature)
  );
}
```

---

## 5. Checking Order Status via API or Live SSE

If you want to check an order's status manually or show live progress in your own custom UI:

### A. Poll Order Status
`GET https://payments.fluxbasedb.me/api/v1/orders/{order_id}`

Response:
```json
{
  "id": "ord_8f921b7c",
  "status": "paid", // "pending" | "paid" | "expired"
  "amount": 499.00,
  "final_amount": 499.14,
  "utr": "625374829102",
  "paid_at": "2026-09-09T01:25:34.000Z"
}
```

### B. Real-Time Server-Sent Events (SSE) Stream
`GET https://payments.fluxbasedb.me/api/v1/orders/{order_id}/stream`

Subscribe using standard browser `EventSource`:
```javascript
const es = new EventSource('https://payments.fluxbasedb.me/api/v1/orders/ord_8f921b7c/stream');
es.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.status === 'paid') {
    alert('Payment Received via UTR: ' + data.utr);
    es.close();
  }
};
```

---

## 6. Summary of Key URLs

| Resource | URL |
| :--- | :--- |
| **Interactive Docs** | `https://payments.fluxbasedb.me/docs` |
| **Merchant Login** | `https://payments.fluxbasedb.me/login` |
| **API Keys Management** | `https://payments.fluxbasedb.me/dashboard/apikeys` |
| **Merchant Settings** | `https://payments.fluxbasedb.me/dashboard/settings` |
| **SMS Ingestion Endpoint** | `https://payments.fluxbasedb.me/api/v1/webhook/incoming` |
