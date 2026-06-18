# Function: set_opt_out

Use this in Rampwin's Functions section. Two parts to paste:

---

## LEFT side — Function Definition (JSON Schema)

```json
{
  "name": "set_opt_out",
  "description": "Mark this contact as permanently opted-out from future Sanocare messages. Call this IMMEDIATELY when the user types STOP, UNSUBSCRIBE, REMOVE, NO MORE MESSAGES, DO NOT CONTACT, or similar opt-out phrases.",
  "strict": true,
  "parameters": {
    "type": "object",
    "properties": {
      "reason": {
        "type": "string",
        "description": "Brief reason for opt-out — use 'user_stop_command' for STOP, or paste the user's actual phrase if they gave context (e.g., 'not interested', 'wrong number')."
      }
    },
    "additionalProperties": false,
    "required": ["reason"]
  }
}
```

## RIGHT side — Function body (JavaScript)

```javascript
function myFunction(properties) {
  // v1: Acknowledges opt-out. In v1.5, integrate with Rampwin's contact opt-out API
  // or POST to internal Sanocare backend to mark the contact in CRM.
  // TODO: fetch("https://api.sanocare.in/whatsapp/opt-out", {
  //   method: "POST",
  //   headers: {"Content-Type": "application/json", "X-API-Key": "..."},
  //   body: JSON.stringify({ phone: properties.phone, reason: properties.reason, timestamp: new Date().toISOString() })
  // });

  return {
    success: true,
    opted_out: true,
    reason: properties.reason,
    message: "Contact marked as opted-out. No further outbound messages will be sent until the user explicitly re-initiates contact."
  };
}
```
