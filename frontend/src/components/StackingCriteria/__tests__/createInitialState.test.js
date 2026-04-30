import { describe, it, expect } from "vitest";
import {
  createInitialState,
  addRow,
  removeRow,
  updateRowValue,
  setExpression,
} from "../createInitialState.js";

describe("createInitialState", () => {
  it("starts empty by default", () => {
    expect(createInitialState()).toEqual({
      criteria: [],
      expression: "",
      nextLetterIndex: 0,
    });
  });

  it("seeds rows starting at A and advances the counter past them", () => {
    const state = createInitialState({ seedRows: [{ a: 1 }, { b: 2 }] });
    expect(state.criteria).toEqual([
      { id: "A", value: { a: 1 } },
      { id: "B", value: { b: 2 } },
    ]);
    expect(state.nextLetterIndex).toBe(2);
  });
});

describe("monotonic counter behavior", () => {
  it("never reuses a letter after a delete", () => {
    let state = createInitialState();
    state = addRow(state, "row-A");
    state = addRow(state, "row-B");
    state = addRow(state, "row-C");
    state = removeRow(state, "B");
    state = addRow(state, "row-D");
    expect(state.criteria.map((c) => c.id)).toEqual(["A", "C", "D"]);
    expect(state.nextLetterIndex).toBe(4);
  });

  it("rolls over Z to AA at index 26", () => {
    let state = createInitialState();
    for (let i = 0; i < 27; i++) state = addRow(state, i);
    expect(state.criteria[25].id).toBe("Z");
    expect(state.criteria[26].id).toBe("AA");
  });
});

describe("updateRowValue and setExpression", () => {
  it("updates a row's value without touching its id", () => {
    const seed = createInitialState({ seedRows: ["x"] });
    const next = updateRowValue(seed, "A", "y");
    expect(next.criteria).toEqual([{ id: "A", value: "y" }]);
  });

  it("setExpression replaces the expression string only", () => {
    const seed = createInitialState({ seedRows: ["x"] });
    const next = setExpression(seed, "A");
    expect(next.expression).toBe("A");
    expect(next.criteria).toEqual(seed.criteria);
  });
});
