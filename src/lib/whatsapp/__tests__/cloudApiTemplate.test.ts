// sendTemplateMessage payload shape — a zero-variable template must send NO body
// component (an empty parameters:[] still trips Meta's 132000 parameter-count
// check). Variable templates keep their body component (regression).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendTemplateMessage } from "@/lib/whatsapp/cloud-api";

function okFetch() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({ messages: [{ id: "wamid.test" }] }),
  });
}

function lastBody(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls.at(-1);
  return JSON.parse((call![1] as RequestInit).body as string);
}

describe("sendTemplateMessage — body component by param count", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = "pnid";
    process.env.WHATSAPP_ACCESS_TOKEN = "tok";
    fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
  });

  it("empty bodyParams (zero-variable template) → NO body component", async () => {
    await sendTemplateMessage({ to: "+919812345678", templateName: "lead_first_contact", bodyParams: [] });
    const components = lastBody(fetchMock).template.components as { type: string }[];
    expect(components.find((c) => c.type === "body")).toBeUndefined();
  });

  it("non-empty bodyParams → body component with the params (regression)", async () => {
    await sendTemplateMessage({ to: "+919812345678", templateName: "lead_follow_up", bodyParams: ["home nursing care"] });
    const components = lastBody(fetchMock).template.components as {
      type: string;
      parameters?: { type: string; text: string }[];
    }[];
    const body = components.find((c) => c.type === "body");
    expect(body).toBeDefined();
    expect(body!.parameters).toEqual([{ type: "text", text: "home nursing care" }]);
  });
});
