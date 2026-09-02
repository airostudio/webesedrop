import { describe, expect, it, vi } from "vitest";
import { ClaudeCopyProvider } from "./claudeProvider";
import { BEACH_FOOTPRINTS_VOICE } from "./rewriter";

function fakeAnthropicClient(responseText: string) {
  return { messages: { create: vi.fn().mockResolvedValue({ content: [{ type: "text", text: responseText }] }) } } as any;
}

const REQUEST = {
  rawTitle: "2026 Hot Sale Woven Straw Beach Bag Wholesale Free Shipping!!",
  rawDescriptionHtml: "<p>Made of natural straw, large capacity, perfect for beach summer holiday.</p>",
  voice: BEACH_FOOTPRINTS_VOICE,
};

describe("ClaudeCopyProvider", () => {
  it("parses a well-formed JSON response into onBrandName + a 4-section description", async () => {
    const client = fakeAnthropicClient(
      JSON.stringify({
        title: "Woven Straw Beach Tote",
        section1: "A relaxed straw tote built for salt-tangled hair and golden-hour light.",
        section2: "Roomy enough for a towel, sunscreen, and a paperback.",
        section3: "Natural straw. Spot clean only.",
        section4: "Ships from our supplier network; tracking sent by email.",
      }),
    );
    const provider = new ClaudeCopyProvider(client);

    const result = await provider.rewrite(REQUEST);

    expect(result.onBrandName).toBe("Woven Straw Beach Tote");
    expect(result.description.section3).toBe("Natural straw. Spot clean only.");
    expect(client.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-opus-5", system: expect.stringContaining("SEO-friendly") }),
    );
  });

  it("strips markdown code fences if the model wraps its JSON in them", async () => {
    const client = fakeAnthropicClient(
      "```json\n" +
        JSON.stringify({ title: "Woven Straw Beach Tote", section1: "a", section2: "b", section3: "c", section4: "d" }) +
        "\n```",
    );
    const provider = new ClaudeCopyProvider(client);

    const result = await provider.rewrite(REQUEST);
    expect(result.onBrandName).toBe("Woven Straw Beach Tote");
  });

  it("throws on malformed JSON, so rewriteProductCopy's fallback to the offline template kicks in", async () => {
    const client = fakeAnthropicClient("not json at all");
    const provider = new ClaudeCopyProvider(client);

    await expect(provider.rewrite(REQUEST)).rejects.toThrow();
  });

  it("throws when required fields are missing from an otherwise-valid JSON response", async () => {
    const client = fakeAnthropicClient(JSON.stringify({ title: "Woven Straw Beach Tote" }));
    const provider = new ClaudeCopyProvider(client);

    await expect(provider.rewrite(REQUEST)).rejects.toThrow();
  });

  it("includes the brand voice's descriptors and section labels in the prompt sent to Claude", async () => {
    const client = fakeAnthropicClient(JSON.stringify({ title: "t", section1: "a", section2: "b", section3: "c", section4: "d" }));
    const provider = new ClaudeCopyProvider(client);

    await provider.rewrite(REQUEST);

    const call = client.messages.create.mock.calls[0][0];
    const userMessage = call.messages[0].content as string;
    expect(userMessage).toContain(BEACH_FOOTPRINTS_VOICE.storeName);
    expect(userMessage).toContain(BEACH_FOOTPRINTS_VOICE.sectionLabels![0]);
    expect(userMessage).toContain(REQUEST.rawTitle);
  });
});
