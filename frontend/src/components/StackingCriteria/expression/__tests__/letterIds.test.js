import { describe, it, expect } from "vitest";
import { indexToLetter, letterToIndex } from "../letterIds.js";

describe("indexToLetter", () => {
  it("maps 0..25 to A..Z", () => {
    expect(indexToLetter(0)).toBe("A");
    expect(indexToLetter(1)).toBe("B");
    expect(indexToLetter(25)).toBe("Z");
  });

  it("rolls over to AA at 26", () => {
    expect(indexToLetter(26)).toBe("AA");
    expect(indexToLetter(27)).toBe("AB");
    expect(indexToLetter(51)).toBe("AZ");
    expect(indexToLetter(52)).toBe("BA");
  });

  it("handles ZZ boundary and rolls to AAA", () => {
    expect(indexToLetter(701)).toBe("ZZ");
    expect(indexToLetter(702)).toBe("AAA");
  });

  it("throws on negative or non-integer input", () => {
    expect(() => indexToLetter(-1)).toThrow();
    expect(() => indexToLetter(1.5)).toThrow();
    expect(() => indexToLetter("0")).toThrow();
  });
});

describe("letterToIndex", () => {
  it("inverts indexToLetter for the boundary cases", () => {
    expect(letterToIndex("A")).toBe(0);
    expect(letterToIndex("Z")).toBe(25);
    expect(letterToIndex("AA")).toBe(26);
    expect(letterToIndex("AZ")).toBe(51);
    expect(letterToIndex("BA")).toBe(52);
    expect(letterToIndex("ZZ")).toBe(701);
    expect(letterToIndex("AAA")).toBe(702);
  });

  it("round-trips through indexToLetter for a sweep", () => {
    for (let i = 0; i < 1000; i++) {
      expect(letterToIndex(indexToLetter(i))).toBe(i);
    }
  });

  it("throws on invalid input", () => {
    expect(() => letterToIndex("")).toThrow();
    expect(() => letterToIndex("a")).toThrow();
    expect(() => letterToIndex("A1")).toThrow();
    expect(() => letterToIndex(0)).toThrow();
  });
});
