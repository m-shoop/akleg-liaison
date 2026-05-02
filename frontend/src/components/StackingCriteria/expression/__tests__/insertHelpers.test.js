import { describe, it, expect } from "vitest";
import { insertLetter, insertOperator } from "../insertHelpers.js";

describe("insertLetter", () => {
  it("inserts into an empty expression with no padding", () => {
    expect(insertLetter("", 0, 0, "A")).toEqual({ expression: "A", caret: 1 });
  });

  it("auto-inserts AND on the left when adjacent to a letter", () => {
    expect(insertLetter("A", 1, 1, "B")).toEqual({
      expression: "A AND B",
      caret: 7,
    });
  });

  it("auto-inserts AND on the right when adjacent to a letter", () => {
    expect(insertLetter("B", 0, 0, "A")).toEqual({
      expression: "A AND B",
      caret: 1,
    });
  });

  it("auto-inserts AND on both sides when sandwiched between letters", () => {
    expect(insertLetter("A B", 1, 2, "C")).toEqual({
      expression: "A AND C AND B",
      caret: 7,
    });
  });

  it("does not add AND adjacent to AND/OR (operator already supplies the connective)", () => {
    expect(insertLetter("A AND ", 6, 6, "B")).toEqual({
      expression: "A AND B",
      caret: 7,
    });
  });

  it("auto-inserts AND when adjacent to a closing paren on the left", () => {
    expect(insertLetter("(A OR B)", 8, 8, "C")).toEqual({
      expression: "(A OR B) AND C",
      caret: 14,
    });
  });

  it("auto-inserts AND when adjacent to an opening paren on the right", () => {
    expect(insertLetter("(A OR B)", 0, 0, "C")).toEqual({
      expression: "C AND (A OR B)",
      caret: 1,
    });
  });

  it("snaps caret out of a token when the cursor is in the middle of one", () => {
    // Caret is in the middle of the AND token (position 4 of "A AND B")
    const result = insertLetter("A AND B", 4, 4, "C");
    expect(result.expression).toBe("A AND C AND B");
  });
});

describe("insertOperator", () => {
  it("inserts AND between two letters when nothing is adjacent", () => {
    expect(insertOperator("A B", 1, 2, "AND")).toEqual({
      expression: "A AND B",
      caret: 5,
    });
  });

  it("replaces an existing operator on the left rather than duplicating", () => {
    // Caret is just after the AND in "A AND B"
    const result = insertOperator("A AND B", 5, 5, "OR");
    expect(result).toEqual({ expression: "A OR B", caret: 4 });
  });

  it("replaces an existing operator on the right rather than duplicating", () => {
    // Caret is just before the AND in "A AND B"
    const result = insertOperator("A AND B", 2, 2, "OR");
    expect(result).toEqual({ expression: "A OR B", caret: 4 });
  });

  it("is idempotent when the same operator is already adjacent", () => {
    const result = insertOperator("A AND B", 5, 5, "AND");
    expect(result).toEqual({ expression: "A AND B", caret: 5 });
  });

  it("inserts at end of expression when nothing is to the right", () => {
    expect(insertOperator("A", 1, 1, "AND")).toEqual({
      expression: "A AND",
      caret: 5,
    });
  });

  it("snaps to surrounding operator when caret is in the middle of one", () => {
    // Caret inside the AND token of "A AND B"
    const result = insertOperator("A AND B", 4, 4, "OR");
    expect(result).toEqual({ expression: "A OR B", caret: 4 });
  });

  it("rejects unknown operators", () => {
    expect(() => insertOperator("A", 1, 1, "XOR")).toThrow();
  });
});
