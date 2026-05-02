import { describe, it, expect } from "vitest";
import { tokenize } from "../lexer.js";
import { parse } from "../parser.js";

const parseStr = (s) => parse(tokenize(s).tokens);

describe("parse", () => {
  it("parses a single letter", () => {
    const { ast, errors } = parseStr("A");
    expect(errors).toEqual([]);
    expect(ast).toMatchObject({ type: "LETTER", value: "A" });
  });

  it("parses A AND B as left-associative AND", () => {
    const { ast, errors } = parseStr("A AND B");
    expect(errors).toEqual([]);
    expect(ast).toMatchObject({
      type: "AND",
      left: { type: "LETTER", value: "A" },
      right: { type: "LETTER", value: "B" },
    });
  });

  it("gives AND higher precedence than OR (A AND B OR C → (A AND B) OR C)", () => {
    const { ast, errors } = parseStr("A AND B OR C");
    expect(errors).toEqual([]);
    expect(ast).toMatchObject({
      type: "OR",
      left: {
        type: "AND",
        left: { type: "LETTER", value: "A" },
        right: { type: "LETTER", value: "B" },
      },
      right: { type: "LETTER", value: "C" },
    });
  });

  it("parses A OR B AND C as A OR (B AND C)", () => {
    const { ast, errors } = parseStr("A OR B AND C");
    expect(errors).toEqual([]);
    expect(ast).toMatchObject({
      type: "OR",
      left: { type: "LETTER", value: "A" },
      right: {
        type: "AND",
        left: { type: "LETTER", value: "B" },
        right: { type: "LETTER", value: "C" },
      },
    });
  });

  it("respects parentheses (A AND (B OR C))", () => {
    const { ast, errors } = parseStr("A AND (B OR C)");
    expect(errors).toEqual([]);
    expect(ast).toMatchObject({
      type: "AND",
      left: { type: "LETTER", value: "A" },
      right: {
        type: "GROUP",
        child: {
          type: "OR",
          left: { type: "LETTER", value: "B" },
          right: { type: "LETTER", value: "C" },
        },
      },
    });
  });

  it("flags missing operand after AND", () => {
    const { errors } = parseStr("A AND");
    expect(errors).toEqual([
      expect.objectContaining({ message: "Missing operand after 'AND'" }),
    ]);
  });

  it("flags missing operand after OR", () => {
    const { errors } = parseStr("A OR");
    expect(errors).toEqual([
      expect.objectContaining({ message: "Missing operand after 'OR'" }),
    ]);
  });

  it("flags missing operator between adjacent letters (A B)", () => {
    const { errors } = parseStr("A B");
    expect(errors).toEqual([
      expect.objectContaining({ message: 'Missing operator before "B"', pos: 2 }),
    ]);
  });

  it("flags unmatched opening parenthesis", () => {
    const { errors } = parseStr("(A");
    expect(errors).toEqual([
      expect.objectContaining({ message: "Unmatched parenthesis", pos: 0 }),
    ]);
  });

  it("flags unmatched closing parenthesis", () => {
    const { errors } = parseStr("A)");
    expect(errors).toEqual([
      expect.objectContaining({ message: "Unmatched closing parenthesis", pos: 1 }),
    ]);
  });

  it("flags empty parenthesis group", () => {
    const { errors } = parseStr("()");
    expect(errors).toEqual([
      expect.objectContaining({ message: "Empty parenthesis group" }),
    ]);
  });

  it("flags an unexpected leading operator", () => {
    const { errors } = parseStr("AND A");
    expect(errors).toEqual([
      expect.objectContaining({ message: 'Unexpected operator "AND"' }),
    ]);
  });

  it("returns null AST for an empty token stream", () => {
    const { ast, errors } = parseStr("");
    expect(ast).toBeNull();
    expect(errors).toEqual([]);
  });
});
