import { describe, expect, it } from "vitest";
import { invokeLLM } from "./_core/llm";

describe("Claude API key validation", () => {
  it("can call Claude with a simple prompt and get a response", async () => {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: "You are a helpful assistant. Respond with exactly one word." },
        { role: "user", content: "Say the word: cocktail" },
      ],
    });
    const content = response.choices[0]?.message?.content;
    expect(content).toBeTruthy();
    expect(typeof content).toBe("string");
    expect((content as string).length).toBeGreaterThan(0);
  }, 30000);
});
