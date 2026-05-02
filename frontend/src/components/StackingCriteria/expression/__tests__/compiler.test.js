import { describe, it, expect } from "vitest";
import { tokenize } from "../lexer.js";
import { parse } from "../parser.js";
import { compile } from "../compiler.js";

const compileStr = (input, criteria, compileRow) => {
  const { ast } = parse(tokenize(input).tokens);
  return compile(ast, criteria, compileRow);
};

const rowGroup = (id) => ({
  logic: "AND",
  conditions: [{ field: `f_${id}`, op: "equals", value: id }],
  groups: [],
});

const criteria = [
  { id: "A", filters: { foo: "a" } },
  { id: "B", filters: { foo: "b" } },
  { id: "C", filters: { foo: "c" } },
];

const compileRow = (row) => rowGroup(row.id);

describe("compile", () => {
  it("compiles a single letter to that row's FilterGroup", () => {
    const result = compileStr("A", criteria, compileRow);
    expect(result).toEqual(rowGroup("A"));
  });

  it("compiles A AND B as an AND of two row groups", () => {
    const result = compileStr("A AND B", criteria, compileRow);
    expect(result).toEqual({
      logic: "AND",
      conditions: [],
      groups: [rowGroup("A"), rowGroup("B")],
    });
  });

  it("compiles (A AND B) OR C as nested groups (the key backend round-trip case)", () => {
    const result = compileStr("(A AND B) OR C", criteria, compileRow);
    expect(result).toEqual({
      logic: "OR",
      conditions: [],
      groups: [
        {
          logic: "AND",
          conditions: [],
          groups: [rowGroup("A"), rowGroup("B")],
        },
        rowGroup("C"),
      ],
    });
  });

  it("compiles an empty expression as AND of every row", () => {
    const result = compileStr("", criteria, compileRow);
    expect(result).toEqual({
      logic: "AND",
      conditions: [],
      groups: [rowGroup("A"), rowGroup("B"), rowGroup("C")],
    });
  });

  it("returns the empty AND group when there are no criteria and no expression", () => {
    const result = compileStr("", [], compileRow);
    expect(result).toEqual({ logic: "AND", conditions: [], groups: [] });
  });

  it("collapses one-row empty expression to the row's group (no extra wrapping)", () => {
    const result = compileStr("", [criteria[0]], compileRow);
    expect(result).toEqual(rowGroup("A"));
  });

  it("skips letters whose row produces an empty FilterGroup", () => {
    const compileRowWithEmptyB = (row) =>
      row.id === "B"
        ? { logic: "AND", conditions: [], groups: [] }
        : rowGroup(row.id);
    const result = compileStr("A AND B", criteria, compileRowWithEmptyB);
    expect(result).toEqual(rowGroup("A"));
  });

  it("returns the empty AND group when an unknown letter is the only reference", () => {
    const result = compileStr("Q", criteria, compileRow);
    expect(result).toEqual({ logic: "AND", conditions: [], groups: [] });
  });

  it("preserves precedence: A OR B AND C compiles as A OR (B AND C)", () => {
    const result = compileStr("A OR B AND C", criteria, compileRow);
    expect(result).toEqual({
      logic: "OR",
      conditions: [],
      groups: [
        rowGroup("A"),
        {
          logic: "AND",
          conditions: [],
          groups: [rowGroup("B"), rowGroup("C")],
        },
      ],
    });
  });
});
