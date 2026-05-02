import { describe, it, expect } from "vitest";
import { validate, unusedCriteriaIds } from "../validate.js";

const criteria = [{ id: "A" }, { id: "B" }, { id: "C" }];

describe("validate", () => {
  it("treats an empty expression as valid (means AND-everything)", () => {
    const result = validate("", criteria);
    expect(result.errors).toEqual([]);
    expect(result.ast).toBeNull();
    expect(result.referencedIds).toEqual(new Set());
  });

  it("flags references to undefined criteria", () => {
    const result = validate("A AND Q", criteria);
    expect(result.errors).toEqual([
      expect.objectContaining({ message: 'Unknown criterion "Q"', pos: 6 }),
    ]);
  });

  it("collects every referenced id, even when undefined", () => {
    const result = validate("A OR Q OR (B AND C)", criteria);
    expect(result.referencedIds).toEqual(new Set(["A", "Q", "B", "C"]));
  });

  it("propagates lex errors", () => {
    const result = validate("A & B", criteria);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: 'Unexpected character "&"' }),
      ]),
    );
  });

  it("propagates parse errors", () => {
    const result = validate("(A AND B", criteria);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: "Unmatched parenthesis" }),
      ]),
    );
  });
});

describe("unusedCriteriaIds", () => {
  it("returns the ids of criteria not referenced by the expression", () => {
    const { referencedIds } = validate("A", criteria);
    expect(unusedCriteriaIds(criteria, referencedIds)).toEqual(["B", "C"]);
  });

  it("returns an empty array when all are referenced", () => {
    const { referencedIds } = validate("A AND B AND C", criteria);
    expect(unusedCriteriaIds(criteria, referencedIds)).toEqual([]);
  });
});
