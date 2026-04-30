import { describe, it, expect } from "vitest";
import { tokenize, TOKEN } from "../lexer.js";

const types = (toks) => toks.map((t) => t.type);
const values = (toks) => toks.map((t) => t.value);

describe("tokenize", () => {
  it("emits EOF for an empty string", () => {
    const { tokens, errors } = tokenize("");
    expect(types(tokens)).toEqual([TOKEN.EOF]);
    expect(errors).toEqual([]);
  });

  it("ignores whitespace", () => {
    const { tokens } = tokenize("  A  \tAND\nB  ");
    expect(types(tokens)).toEqual([TOKEN.LETTER, TOKEN.AND, TOKEN.LETTER, TOKEN.EOF]);
  });

  it("normalizes letters to uppercase", () => {
    const { tokens } = tokenize("a and b");
    expect(types(tokens)).toEqual([TOKEN.LETTER, TOKEN.AND, TOKEN.LETTER, TOKEN.EOF]);
    expect(values(tokens.slice(0, 3))).toEqual(["A", "AND", "B"]);
  });

  it("uses maximal munch for letter sequences (AAND is one identifier, not 'A AND')", () => {
    const { tokens } = tokenize("AAND");
    expect(types(tokens)).toEqual([TOKEN.LETTER, TOKEN.EOF]);
    expect(tokens[0].value).toBe("AAND");
  });

  it("treats AA as an identifier (not 'A A')", () => {
    const { tokens } = tokenize("AA");
    expect(types(tokens)).toEqual([TOKEN.LETTER, TOKEN.EOF]);
    expect(tokens[0].value).toBe("AA");
  });

  it("recognizes parens", () => {
    const { tokens } = tokenize("(A)");
    expect(types(tokens)).toEqual([TOKEN.LPAREN, TOKEN.LETTER, TOKEN.RPAREN, TOKEN.EOF]);
  });

  it("records positions accurately", () => {
    const { tokens } = tokenize("  AB AND C");
    const ab = tokens[0];
    const and = tokens[1];
    const c = tokens[2];
    expect(ab).toMatchObject({ type: TOKEN.LETTER, value: "AB", pos: 2, len: 2 });
    expect(and).toMatchObject({ type: TOKEN.AND, value: "AND", pos: 5, len: 3 });
    expect(c).toMatchObject({ type: TOKEN.LETTER, value: "C", pos: 9, len: 1 });
  });

  it("reports unexpected characters with position", () => {
    const { tokens, errors } = tokenize("A & B");
    expect(types(tokens)).toEqual([TOKEN.LETTER, TOKEN.LETTER, TOKEN.EOF]);
    expect(errors).toEqual([
      { message: 'Unexpected character "&"', pos: 2, len: 1 },
    ]);
  });

  it("recognizes a complex expression", () => {
    const { tokens } = tokenize("(A AND B) OR C");
    expect(types(tokens)).toEqual([
      TOKEN.LPAREN,
      TOKEN.LETTER,
      TOKEN.AND,
      TOKEN.LETTER,
      TOKEN.RPAREN,
      TOKEN.OR,
      TOKEN.LETTER,
      TOKEN.EOF,
    ]);
  });
});
