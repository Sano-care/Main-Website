# Function: escalate_to_ops

Use this in Rampwin's Functions section. Two parts to paste:

---

## LEFT side — Function Definition (JSON Schema)

```json
{
  "name": "escalate_to_ops",
  "description": "Escalate this conversation to the Sanocare ops team. Call when a lead is fully qualified (name + area + service + urgency captured), when user explicitly asks for a human, when an emergency is detected, when user reports a complaint, or when conversation has gone 10+ turns without progress.",
  "strict": true,
  "parameters": {
    "type": "object",
    "properties": {
      "escalation_type": {
        "type": "string",
        "enum": ["qualified_lead", "human_requested", "emergency", "complaint", "stalled_conversation"],
        "description": "Why this is being escalated to ops"
      },
      "service_intent": {
        "type": "string",
        "enum": ["doctor_visit", "nursing", "lab", "pharmacy", "other"],
        "description": "Which Sanocare service the lead is interested in"
      },
      "urgency": {
        "type": "string",
        "enum": ["emergency", "today", "this_week", "planned"],
        "description": "How urgent the request is"
      },
      "patient_name": {
        "type": "string",
        "description": "Patient name (may be different from the person on WhatsApp)"
      },
      "patient_age": {
        "type": "string",
        "description": "Patient age, as a string (handles 'unknown' or ranges like '60s')"
      },
      "patient_relationship": {
        "type": "string",
        "enum": ["self", "parent", "spouse", "child", "other", "unknown"],
        "description": "Relationship of the patient to the person on WhatsApp"
      },
      "area": {
        "type": "string",
        "description": "Patient location/area, e.g., 'Greater Kailash 1'"
      },
      "pincode": {
        "type": "string",
        "description": "Pincode if available, empty string if not"
      },
      "summary_for_ops": {
        "type": "string",
        "description": "One or two line summary for the ops coordinator picking up the lead"
      }
    },
    "additionalProperties": false,
    "required": ["escalation_type", "service_intent", "urgency", "patient_name", "patient_age", "patient_relationship", "area", "pincode", "summary_for_ops"]
  }
}
```

## RIGHT side — Function body (JavaScript)

```javascript
function myFunction(properties) {
  // v1: Just acknowledges escalation. Replace with Slack webhook POST when configured.
  // const SLACK_WEBHOOK_LEADS = "https://hooks.slack.com/services/XXX/YYY/ZZZ";
  // const SLACK_WEBHOOK_ALERTS = "https://hooks.slack.com/services/XXX/YYY/AAA";
  // const url = properties.escalation_type === "emergency" ? SLACK_WEBHOOK_ALERTS : SLACK_WEBHOOK_LEADS;
  // fetch(url, { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({
  //   text: `New ${properties.escalation_type}: ${properties.summary_for_ops}`,
  //   attachments: [{ fields: Object.entries(properties).map(([k,v]) => ({title: k, value: v, short: true})) }]
  // }) });

  return {
    success: true,
    escalation_id: "esc_" + Date.now(),
    message: "Escalation logged. Ops has been alerted via the live dashboard. The Medic or doctor reaches the patient per the service SLA (Medic 30 min / doctor 15 min). escalate_to_ops is an internal alert, NOT a coordinator call-back.",
    escalation_type: properties.escalation_type,
    service_intent: properties.service_intent,
    urgency: properties.urgency
  };
}
```
